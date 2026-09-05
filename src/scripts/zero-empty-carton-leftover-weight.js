#!/usr/bin/env node

/**
 * Zero leftover YarnBox.boxWeight when the carton is empty
 * (non-vendor YarnCone count >= expected numberOfCones).
 *
 * Dry-run by default. --apply persists boxWeight=0, unsets storageLocation,
 * storedStatus=false, conesIssued=true, then resyncs yarn inventory.
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/zero-empty-carton-leftover-weight.js
 *   NODE_ENV=development node src/scripts/zero-empty-carton-leftover-weight.js --apply
 *   NODE_ENV=development node src/scripts/zero-empty-carton-leftover-weight.js --po=PO-2026-1280 --apply
 *   NODE_ENV=development node src/scripts/zero-empty-carton-leftover-weight.js --box-barcode=6a745e2cd97f52232854809f
 *   NODE_ENV=development node src/scripts/zero-empty-carton-leftover-weight.js --apply --skip-inventory
 *   NODE_ENV=development node src/scripts/zero-empty-carton-leftover-weight.js --apply --sync-concurrency=2
 */

import './lib/mongoUrlParsePatch.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnCone } from '../models/index.js';
import { activeYarnBoxMatch, activeYarnConeMatch } from '../services/yarnManagement/yarnStockActiveFilters.js';
import { expectedYarnBoxConeCount } from '../services/yarnManagement/yarnBoxLtRemaining.helper.js';
import { syncInventoriesFromStorageForCatalogIds } from '../services/yarnManagement/yarnInventory.service.js';
import { isLongTermStorageLocation, num } from './lib/yarnLtStAuditHelpers.js';

/**
 * @param {string} prefix
 * @returns {string|null}
 */
function getArg(prefix) {
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) return null;
  return found.slice(prefix.length).trim() || null;
}

/**
 * @param {string} prefix
 * @param {number} fallback
 * @returns {number}
 */
function getPositiveIntArg(prefix, fallback) {
  const raw = getArg(prefix);
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const PO_FILTER = getArg('--po=');
const OUT_DIR_ARG = getArg('--out-dir=');
const APPLY = process.argv.includes('--apply');
const SKIP_INVENTORY = process.argv.includes('--skip-inventory');
const MONGO_URL = getArg('--mongo-url=');
const BOX_BARCODE = getArg('--box-barcode=');
/** Atlas-friendly: one catalog at a time unless overridden. */
const SYNC_CONCURRENCY = getPositiveIntArg('--sync-concurrency=', 1);
const BULK_CHUNK = getPositiveIntArg('--bulk-chunk=', 250);

/**
 * @param {string} rawUrl
 * @returns {string}
 */
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

/**
 * @returns {{ url: string, source: string }}
 */
function resolveMongoConnectionString() {
  const cli = sanitizeMongoUrl(MONGO_URL || '');
  if (cli) return { url: cli, source: '--mongo-url' };
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) return { url: cfg, source: 'config.mongoose.url' };
  const env = sanitizeMongoUrl(String(process.env.MONGODB_URL || process.env.ATLAS_MONGODB_URL || ''));
  return { url: env, source: 'process.env' };
}

/**
 * Finds leftover-weight boxes whose cone docs already cover expected count.
 * @returns {Promise<object[]>}
 */
async function findEmptyCartonLeftoverBoxes() {
  /** @type {Record<string, unknown>} */
  const boxQuery = {
    boxWeight: { $gt: 0 },
    ...activeYarnBoxMatch,
  };
  if (PO_FILTER) boxQuery.poNumber = PO_FILTER;
  if (BOX_BARCODE) boxQuery.barcode = BOX_BARCODE;

  const scanStarted = Date.now();
  logger.info('[zero-empty-carton] Scanning YarnBox (boxWeight > 0)…');
  const boxes = await YarnBox.find(boxQuery)
    .select(
      '_id barcode boxId poNumber yarnName yarnCatalogId lotNumber boxWeight initialBoxWeight numberOfCones storageLocation storedStatus coneData'
    )
    .lean();
  logger.info(`[zero-empty-carton] Loaded ${boxes.length} live boxes with leftover kg (${Date.now() - scanStarted}ms)`);

  const boxIds = boxes.map((b) => String(b.boxId || '')).filter(Boolean);
  if (!boxIds.length) return [];

  const aggStarted = Date.now();
  logger.info(`[zero-empty-carton] Counting YarnCone docs for ${boxIds.length} boxId(s)…`);
  const movedAgg = await YarnCone.aggregate([
    { $match: { boxId: { $in: boxIds }, ...activeYarnConeMatch } },
    { $group: { _id: '$boxId', movedCount: { $sum: 1 } } },
  ]).allowDiskUse(true);
  logger.info(`[zero-empty-carton] Cone counts ready (${movedAgg.length} boxIds with cones, ${Date.now() - aggStarted}ms)`);
  const movedByBoxId = new Map(movedAgg.map((row) => [String(row._id || ''), Number(row.movedCount || 0)]));

  const rows = [];
  for (const box of boxes) {
    const boxId = String(box.boxId || '');
    const expected = expectedYarnBoxConeCount(box);
    const movedConeCount = movedByBoxId.get(boxId) || 0;
    if (expected <= 0 || movedConeCount < expected) continue;

    const loc = box.storageLocation != null ? String(box.storageLocation).trim() : '';
    const headerCones = Number(box.numberOfCones ?? 0);
    const coneDataCones = Number(box.coneData?.numberOfCones ?? 0);
    rows.push({
      box,
      boxId,
      barcode: box.barcode ?? '',
      poNumber: box.poNumber ?? '',
      yarnName: box.yarnName ?? '',
      yarnCatalogId: box.yarnCatalogId ? String(box.yarnCatalogId) : '',
      lotNumber: box.lotNumber ?? '',
      boxWeight: num(box.boxWeight),
      initialBoxWeight: num(box.initialBoxWeight),
      expectedCones: expected,
      headerNumberOfCones: Number.isFinite(headerCones) ? headerCones : 0,
      coneDataNumberOfCones: Number.isFinite(coneDataCones) ? coneDataCones : 0,
      coneCountMismatch: headerCones > 0 && coneDataCones > 0 && headerCones !== coneDataCones,
      movedConeCount,
      storageLocation: loc,
      storedStatus: box.storedStatus === true,
      currentlyLt: Boolean(loc && isLongTermStorageLocation(loc) && box.storedStatus === true),
      currentlyUnallocated: !loc,
    });
  }
  return rows;
}

/**
 * Split an array into fixed-size chunks.
 * @template T
 * @param {T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Mongo bulk op that zeros leftover weight and detaches the carton slot.
 * @param {object} row
 * @param {Date} issuedAt
 * @returns {{ updateOne: object }}
 */
function buildEmptyCartonBulkOp(row, issuedAt) {
  const existing = row.box.coneData && typeof row.box.coneData === 'object' ? row.box.coneData : {};
  return {
    updateOne: {
      filter: { _id: row.box._id },
      update: {
        $set: {
          boxWeight: 0,
          storedStatus: false,
          coneData: {
            ...existing,
            conesIssued: true,
            numberOfCones: row.expectedCones,
            coneIssueDate: existing.coneIssueDate || issuedAt,
          },
        },
        $unset: { storageLocation: '' },
      },
    },
  };
}

/**
 * Persist empty-carton rows via chunked bulkWrite (avoids 1 RTT per box).
 * @param {object[]} rows
 * @returns {Promise<number>} modifiedCount sum
 */
async function persistEmptyCartonRows(rows) {
  const issuedAt = new Date();
  const chunks = chunkArray(rows, BULK_CHUNK);
  let modified = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const ops = chunks[i].map((row) => buildEmptyCartonBulkOp(row, issuedAt));
    const t0 = Date.now();
    // eslint-disable-next-line no-await-in-loop -- sequential chunks keep Atlas load bounded
    const result = await YarnBox.bulkWrite(ops, { ordered: false });
    modified += Number(result.modifiedCount || 0);
    const done = Math.min((i + 1) * BULK_CHUNK, rows.length);
    logger.info(
      `[zero-empty-carton] bulkWrite ${i + 1}/${chunks.length} (${done}/${rows.length} boxes, ${Date.now() - t0}ms)`
    );
  }
  return modified;
}

/**
 * Recalc YarnInventory one catalog at a time (or small pool) with progress logs.
 * @param {string[]} catalogIds
 * @returns {Promise<{ synced: number, failed: number }>}
 */
async function syncCatalogsWithProgress(catalogIds) {
  const ids = [...catalogIds];
  if (!ids.length) return { synced: 0, failed: 0 };

  logger.info(
    `[zero-empty-carton] Inventory sync starting (${ids.length} catalogs, concurrency=${SYNC_CONCURRENCY})`
  );
  let done = 0;
  let failed = 0;
  const queue = ids.slice();
  const t0 = Date.now();

  /**
   * Worker that drains the catalog queue.
   * @returns {Promise<void>}
   */
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      try {
        // eslint-disable-next-line no-await-in-loop -- bounded concurrency via worker pool
        await syncInventoriesFromStorageForCatalogIds([id]);
      } catch (err) {
        failed += 1;
        logger.error(`[zero-empty-carton] inventory sync failed catalog=${id}: ${err?.message || err}`);
      }
      done += 1;
      if (done % 5 === 0 || done === ids.length) {
        const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
        logger.info(`[zero-empty-carton] inventory ${done}/${ids.length} (${elapsedSec}s, failed=${failed})`);
      }
    }
  }

  const pool = Math.min(SYNC_CONCURRENCY, ids.length);
  await Promise.all(Array.from({ length: pool }, () => worker()));
  return { synced: ids.length - failed, failed };
}

/**
 * @param {object[]} rows
 * @param {string} outDir
 * @param {object} summary
 * @returns {void}
 */
function writeReport(rows, outDir, summary) {
  fs.mkdirSync(outDir, { recursive: true });
  const exportRows = rows.map((r) => ({
    boxId: r.boxId,
    barcode: r.barcode,
    poNumber: r.poNumber,
    yarnName: r.yarnName,
    lotNumber: r.lotNumber,
    boxWeight: r.boxWeight,
    initialBoxWeight: r.initialBoxWeight,
    expectedCones: r.expectedCones,
    movedConeCount: r.movedConeCount,
    coneCountMismatch: r.coneCountMismatch,
    storageLocation: r.storageLocation,
    storedStatus: r.storedStatus,
    currentlyLt: r.currentlyLt,
    currentlyUnallocated: r.currentlyUnallocated,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(exportRows.length ? exportRows : [{ note: 'No rows' }]),
    'EmptyCartonLeftover'
  );
  XLSX.writeFile(wb, path.join(outDir, 'empty-carton-leftover.xlsx'));
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const { url, source } = resolveMongoConnectionString();
  if (!url) throw new Error('MongoDB URL missing. Set MONGODB_URL or pass --mongo-url=');

  logger.info(`[zero-empty-carton] Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} (${source})`);
  logger.info(
    `[zero-empty-carton] flags skipInventory=${SKIP_INVENTORY} syncConcurrency=${SYNC_CONCURRENCY} bulkChunk=${BULK_CHUNK}`
  );
  await mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    const rows = await findEmptyCartonLeftoverBoxes();
    logger.info(`Found ${rows.length} empty-carton leftover box(es)`);

    /** @type {Set<string>} */
    const catalogIds = new Set();
    for (const row of rows) {
      if (row.yarnCatalogId) catalogIds.add(row.yarnCatalogId);
    }

    let applied = 0;
    let inventorySynced = 0;
    let inventoryFailed = 0;
    if (APPLY && rows.length) {
      const persistStarted = Date.now();
      applied = await persistEmptyCartonRows(rows);
      logger.info(`[zero-empty-carton] Box writes done: modified=${applied} (${Date.now() - persistStarted}ms)`);

      if (SKIP_INVENTORY) {
        logger.warn('[zero-empty-carton] --skip-inventory: YarnInventory not recalculated');
      } else if (catalogIds.size) {
        const syncResult = await syncCatalogsWithProgress([...catalogIds]);
        inventorySynced = syncResult.synced;
        inventoryFailed = syncResult.failed;
      }
    }

    const leftoverKg = rows.reduce((s, r) => s + r.boxWeight, 0);
    const summary = {
      mode: APPLY ? 'apply' : 'dry-run',
      candidates: rows.length,
      applied,
      leftoverKgTotal: Math.round(leftoverKg * 1000) / 1000,
      currentlyLt: rows.filter((r) => r.currentlyLt).length,
      currentlyUnallocated: rows.filter((r) => r.currentlyUnallocated).length,
      coneCountMismatch: rows.filter((r) => r.coneCountMismatch).length,
      poFilter: PO_FILTER || null,
      boxBarcodeFilter: BOX_BARCODE || null,
      catalogIdsSynced: inventorySynced,
      inventoryFailed,
      skipInventory: APPLY ? SKIP_INVENTORY : false,
    };

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outDir = OUT_DIR_ARG
      ? path.resolve(process.cwd(), OUT_DIR_ARG)
      : path.resolve(process.cwd(), `reports/empty-carton-leftover-${ts}`);
    writeReport(rows, outDir, summary);

    // eslint-disable-next-line no-console
    console.log('\n=== Empty carton leftover weight ===');
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
    // eslint-disable-next-line no-console
    console.log('\nReport:', outDir);

    if (!APPLY) {
      logger.warn('DRY RUN — no DB writes. Re-run with --apply to commit.');
    } else if (inventoryFailed > 0) {
      logger.warn(`[zero-empty-carton] Finished with ${inventoryFailed} inventory sync failure(s)`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
