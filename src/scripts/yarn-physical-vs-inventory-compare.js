#!/usr/bin/env node

/**
 * Live comparison of:
 * 1. **cron/snapshot kg** — `computePhysicalKgMap` Σ (what YarnDailyClosingSnapshot rows store when job runs).
 * 2. **inventory dashboard kg** — `getYarnInventoriesSummary` (LT barcodes + ST barcodes + unallocated; excludes LT boxes fully peeled to cones).
 * 3. **latest snapshot key in DB** — Σ `closingKg` for max `snapshotDate` (persisted nightly labels).
 *
 * Why numbers differ / look “wrong”:
 * Snapshot math adds **every** heavy YarnBox(net) plus **every** in-storage cone(net). Inventory **drops LT boxes**
 * whose cones already account for ≥ box weight (see `yarnInventory.service.js` ~381–387). If `YarnBox.boxWeight`
 * is not reduced when cones move, nightly snapshot **double-counts** that yarn (~box + cones).
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/yarn-physical-vs-inventory-compare.js
 *   NODE_ENV=development node src/scripts/yarn-physical-vs-inventory-compare.js --json
 */

import url from 'url';

const _origUrlParse = url.parse;
url.parse = function patchedParse(urlStr, ...args) {
  try {
    return _origUrlParse.call(this, urlStr, ...args);
  } catch {
    const firstHost = String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2');
    return _origUrlParse.call(this, firstHost, ...args);
  }
};

import mongoose from 'mongoose';
import config from '../config/config.js';
import { YarnBox, YarnCatalog, YarnDailyClosingSnapshot } from '../models/index.js';
import {
  computePhysicalKgMap,
  getYarnIdsWithPhysicalStock,
} from '../services/yarnManagement/physicalKgPerYarn.js';
import { getYarnInventoriesSummary } from '../services/yarnManagement/yarnInventory.service.js';

/** @type {mongoose.ConnectOptions & Record<string, unknown>} */
const MONGO_SCRIPT_OPTIONS = {
  ...config.mongoose.options,
  serverSelectionTimeoutMS: 60000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 120000,
};

/** @param {string} rawUrl @returns {string} */
function sanitizeMongoUrl(rawUrl) {
  let u = String(rawUrl || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  if (u.endsWith('>')) u = u.slice(0, -1);
  return u;
}

/** @returns {string} */
function resolveMongoUrl() {
  const cliArg = process.argv.find((a) => a.startsWith('--mongo-url='));
  if (cliArg) {
    const v = sanitizeMongoUrl(cliArg.slice('--mongo-url='.length));
    if (v) return v;
  }
  return sanitizeMongoUrl(String(config?.mongoose?.url || ''));
}

/**
 * Boxes with weight&gt;0 whose yarnName does not map to any YarnCatalog (never hits snapshot kg map).
 *
 * @returns {Promise<{ orphanBoxCount: number, orphanBoxNetKg: number }>}
 */
async function orphanHeavyBoxesKg() {
  const [catalogNames, boxes] = await Promise.all([
    YarnCatalog.distinct('yarnName'),
    YarnBox.find({ boxWeight: { $gt: 0 } }).select('yarnName boxWeight tearweight').lean(),
  ]);
  const nameHas = new Set(
    catalogNames.filter(Boolean).map((n) => String(n).trim().toLowerCase())
  );
  let orphanBoxCount = 0;
  let orphanBoxNetKg = 0;
  const toNum = (v) => Number(v ?? 0);
  for (const b of boxes) {
    const key = (b.yarnName || '').trim().toLowerCase();
    if (key && nameHas.has(key)) continue;
    const net = Math.max(0, toNum(b.boxWeight) - toNum(b.tearweight));
    if (net <= 0) continue;
    orphanBoxCount += 1;
    orphanBoxNetKg += net;
  }
  return { orphanBoxCount, orphanBoxNetKg: Math.round(orphanBoxNetKg * 1000) / 1000 };
}

/**
 * Live Σ closingKg exactly like snapshot cron (`computePhysicalKgMap`), plus yarn row count.
 *
 * @returns {Promise<{ totalKg: number, yarnSkuWithPositiveKg: number }>}
 */
async function liveCronStylePhysicalTotals() {
  const physicalIds = await getYarnIdsWithPhysicalStock();
  const yarnIds = [...physicalIds];
  if (!yarnIds.length) {
    return { totalKg: 0, yarnSkuWithPositiveKg: 0 };
  }
  const catalogs = await YarnCatalog.find({
    _id: { $in: yarnIds.map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .select('_id yarnName')
    .lean();
  const catalogMap = new Map(catalogs.map((c) => [c._id.toString(), c]));
  const kgMap = await computePhysicalKgMap(yarnIds, catalogMap);
  let totalKg = 0;
  let yarnSkuWithPositiveKg = 0;
  for (const v of kgMap.values()) {
    if (v > 0) yarnSkuWithPositiveKg += 1;
    totalKg += Math.max(0, Number(v) || 0);
  }
  return {
    totalKg: Math.round(totalKg * 1000) / 1000,
    yarnSkuWithPositiveKg,
  };
}

/**
 * Latest calendar key in YarnDailyClosingSnapshot and Σ closingKg that day (persisted “last night” totals).
 *
 * @returns {Promise<{ snapshotDate: string | null, rowCount: number, totalClosingKg: number }>}
 */
async function latestPersistedSnapshotDayTotals() {
  const agg = await YarnDailyClosingSnapshot.aggregate([
    { $group: { _id: '$snapshotDate', totalClosingKg: { $sum: '$closingKg' }, rowCount: { $sum: 1 } } },
    { $sort: { _id: -1 } },
    { $limit: 1 },
  ]).exec();
  const row = agg[0];
  if (!row || !row._id) {
    return { snapshotDate: null, rowCount: 0, totalClosingKg: 0 };
  }
  return {
    snapshotDate: row._id,
    rowCount: row.rowCount,
    totalClosingKg: Math.round(Number(row.totalClosingKg) * 1000) / 1000,
  };
}

async function main() {
  const mongoUrl = resolveMongoUrl();
  if (!mongoUrl) {
    console.error('Missing mongo URL — set MONGODB_URL or --mongo-url=');
    process.exit(2);
    return;
  }

  const jsonMode = process.argv.includes('--json');
  await mongoose.connect(mongoUrl, MONGO_SCRIPT_OPTIONS);

  try {
    const [livePhysical, inventorySum, persistedLatest, orphans] = await Promise.all([
      liveCronStylePhysicalTotals(),
      getYarnInventoriesSummary({}),
      latestPersistedSnapshotDayTotals(),
      orphanHeavyBoxesKg(),
    ]);

    const driftVsInventory = Math.round((livePhysical.totalKg - inventorySum.totals.grandNetKgAllBuckets) * 1000) / 1000;
    const driftVsPersistedSnap =
      persistedLatest.snapshotDate == null
        ? null
        : Math.round((livePhysical.totalKg - persistedLatest.totalClosingKg) * 1000) / 1000;

    const payload = {
      generatedAtIso: new Date().toISOString(),
      interpretation: [
        'liveCronStylePhysicalTotals = YarnDailyClosingSnapshot job formula right now.',
        'inventory grandNetKgAllBuckets = LT(slot list) + ST(slot list) + unallocated — skips LT boxes fully represented by peeled cones.',
        'If cron total >> inventory LT+ST+unalloc OR >> old snapshot unexpectedly, inspect YarnBox rows still carrying full kg while YarnCone siblings exist.',
      ],
      liveCronStylePhysicalTotals: livePhysical,
      inventoryTotals: inventorySum.totals,
      inventorySkuCount: inventorySum.skuCount,
      latestPersistedSnapshotDay: persistedLatest,
      orphanHeavyBoxesKg: orphans,
      driftKg: {
        livePhysical_minus_inventoryGrand: driftVsInventory,
        livePhysical_minus_latestPersistedSnapshot:
          driftVsPersistedSnap === null ? undefined : driftVsPersistedSnap,
      },
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log('YARN — live physical (cron formula) vs inventory vs persisted snapshot');
    console.log('='.repeat(64));
    console.log(`Computed at:           ${payload.generatedAtIso}`);
    console.log('');
    console.log('A) LIVE “closing” (cron / computePhysicalKgMap Σ)');
    console.log(`    totalKg:            ${livePhysical.totalKg.toLocaleString('en-IN')} kg`);
    console.log(`    yarns (positive kg): ${livePhysical.yarnSkuWithPositiveKg}`);
    console.log('');
    console.log('B) INVENTORY SUMMARY (dashboard /yarn-inventories/summary)');
    console.log(`    skuCount:            ${inventorySum.skuCount}`);
    console.log(
      `    LT+ST kg:           ${inventorySum.totals.ltPlusShortKg.toLocaleString('en-IN')} kg`
    );
    console.log(`    unallocated kg:       ${inventorySum.totals.unallocatedKg.toLocaleString('en-IN')} kg`);
    console.log(
      `    grand (LT+ST+UA):    ${inventorySum.totals.grandNetKgAllBuckets.toLocaleString('en-IN')} kg`
    );
    console.log(`    blocked (issued):    ${inventorySum.totals.blockedKg.toLocaleString('en-IN')} kg`);
    console.log('');
    console.log('C) LATEST persisted YarnDailyClosingSnapshot day (Σ that key)');
    if (persistedLatest.snapshotDate) {
      console.log(`    snapshotDate:        ${persistedLatest.snapshotDate}`);
      console.log(`    rowCount:            ${persistedLatest.rowCount}`);
      console.log(
        `    totalClosingKg (Σ):  ${persistedLatest.totalClosingKg.toLocaleString('en-IN')} kg`
      );
    } else {
      console.log('    (none)');
    }
    console.log('');
    console.log('D) ORPHAN heavy boxes (yarnName not in YarnCatalog)');
    console.log(
      `    count / netKg:       ${orphans.orphanBoxCount} / ${orphans.orphanBoxNetKg.toLocaleString('en-IN')} kg`
    );
    console.log('');
    console.log(`Δ (A − inventory grand):  ${driftVsInventory.toLocaleString('en-IN')} kg`);
    if (driftVsPersistedSnap !== null) {
      console.log(`Δ (A − latest snapshot): ${driftVsPersistedSnap.toLocaleString('en-IN')} kg`);
    }
    console.log('');
    console.log('Note: Cron-style (A) can exceed inventory if LT boxes retain full kg while cones moved.');
    console.log('      Use --json for machine-readable blob.');
    console.log('='.repeat(64));
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
