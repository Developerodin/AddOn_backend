#!/usr/bin/env node
/**
 * Report POs/boxes where yarn was already stored (LT rack or ST cones) and DATAAUDIT sync
 * overwrote weights / cone counts again — e.g. 13 cones on record → sync set 15.
 *
 * Sources:
 *   1. sync-update-report.csv (before/after from dataaudit apply)
 *   2. Live MongoDB cross-check (ST cone count vs box.numberOfCones / coneData)
 *
 * Usage (from AddOn_backend):
 *   NODE_ENV=development node src/scripts/report-yarn-st-resync-overwrites.js
 *   NODE_ENV=development node src/scripts/report-yarn-st-resync-overwrites.js --sync-csv=./reports/dataaudit-sync-29062026-apply/sync-update-report.csv
 *   NODE_ENV=development node src/scripts/report-yarn-st-resync-overwrites.js --po=PO-2026-997
 *   NODE_ENV=development node src/scripts/report-yarn-st-resync-overwrites.js --out=./reports/st-resync-overwrites.xlsx
 *
 * Flags:
 *   --sync-csv=PATH   sync-update-report.csv (default: newest under ./reports)
 *   --po=PO-NUMBER    Filter to one PO
 *   --out=PATH        Output .xlsx path
 *   --mongo-url=      Override Mongo connection string
 *   --skip-live       Only parse sync CSV, skip DB enrichment
 */

import './lib/mongoUrlParsePatch.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import config from '../config/config.js';
import logger from '../config/logger.js';

const WEIGHT_EPS = 1e-9;

/**
 * Reads `--prefix=value` CLI args.
 * @param {string} prefix
 * @returns {string|null}
 */
function getArg(prefix) {
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) return null;
  return found.slice(prefix.length).trim() || null;
}

const PO_FILTER = getArg('--po=');
const OUT_PATH = getArg('--out=');
const MONGO_URL = getArg('--mongo-url=');
const SYNC_CSV_ARG = getArg('--sync-csv=');
const SKIP_LIVE = process.argv.includes('--skip-live');

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
 * Resolves MongoDB connection string.
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
 * Parses a single CSV line respecting quoted fields.
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Reads sync-update-report.csv into row objects.
 * @param {string} filePath
 * @returns {Record<string, string>[]}
 */
function readSyncCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').trim();
  const lines = text.split('\n').filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    /** @type {Record<string, string>} */
    const row = {};
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? '';
    });
    return row;
  });
}

/**
 * Finds the newest sync-update-report.csv under ./reports.
 * @returns {string|null}
 */
function findLatestSyncCsv() {
  const reportsDir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) return null;

  /** @type {{ mtime: number, file: string }[]} */
  const found = [];

  /**
   * @param {string} dir
   */
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name === 'sync-update-report.csv') {
        found.push({ mtime: fs.statSync(full).mtimeMs, file: full });
      }
    }
  }
  walk(reportsDir);
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0]?.file ?? null;
}

/**
 * @param {unknown} v
 * @returns {number}
 */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * True when sync row shows data was already stored and sync changed something material.
 * @param {Record<string, string>} row
 * @returns {boolean}
 */
function isStoredResyncOverwrite(row) {
  if (row.entityType !== 'box' || row.status !== 'updated') return false;
  if (!String(row.beforeLocation || '').trim()) return false;

  const bc = num(row.beforeNumberOfCones);
  const ac = num(row.afterNumberOfCones);
  const coneCountChanged = bc > 0 && bc !== ac;
  const grossChanged = Math.abs(num(row.beforeWeight) - num(row.afterWeight)) > WEIGHT_EPS;
  const netChanged = Math.abs(num(row.beforeNetWeight) - num(row.afterNetWeight)) > WEIGHT_EPS;
  const locChanged =
    String(row.beforeLocation || '').trim() !== String(row.afterLocation || '').trim();

  return coneCountChanged || grossChanged || netChanged || locChanged;
}

/**
 * Builds human-readable change flags for a sync box row.
 * @param {Record<string, string>} row
 * @returns {string}
 */
function buildChangeFlags(row) {
  /** @type {string[]} */
  const flags = [];
  const bc = num(row.beforeNumberOfCones);
  const ac = num(row.afterNumberOfCones);
  if (bc > 0 && bc !== ac) flags.push(`cone_count_${bc}_to_${ac}`);
  if (Math.abs(num(row.beforeWeight) - num(row.afterWeight)) > WEIGHT_EPS) flags.push('gross_weight_changed');
  if (Math.abs(num(row.beforeNetWeight) - num(row.afterNetWeight)) > WEIGHT_EPS) flags.push('net_weight_changed');
  if (String(row.beforeLocation || '').trim() !== String(row.afterLocation || '').trim()) {
    flags.push('location_changed');
  }
  return flags.join(', ');
}

/**
 * Loads live DB stats keyed by boxId.
 * @param {string} url
 * @param {string[]|null} boxIds
 * @returns {Promise<Map<string, Record<string, unknown>>>}
 */
async function loadLiveBoxStats(url, boxIds) {
  /** @type {Map<string, Record<string, unknown>>} */
  const map = new Map();
  if (!url) return map;

  await mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });
  const db = mongoose.connection.db;

  /** @type {Record<string, unknown>} */
  const boxQuery = { returnedToVendorAt: null };
  if (PO_FILTER) boxQuery.poNumber = PO_FILTER;
  if (boxIds?.length) boxQuery.boxId = { $in: boxIds };

  const boxes = await db.collection('yarnboxes').find(boxQuery).toArray();
  const ids = boxes.map((b) => String(b.boxId)).filter(Boolean);

  /** @type {Record<string, unknown>} */
  const coneQuery = { returnedToVendorAt: null };
  if (PO_FILTER) coneQuery.poNumber = PO_FILTER;
  if (ids.length) coneQuery.boxId = { $in: ids };

  const cones = await db.collection('yarncones').find(coneQuery).toArray();

  /** @type {Map<string, Record<string, unknown>[]>} */
  const conesByBox = new Map();
  for (const c of cones) {
    const k = String(c.boxId || '');
    if (!conesByBox.has(k)) conesByBox.set(k, []);
    conesByBox.get(k).push(c);
  }

  for (const box of boxes) {
    const boxId = String(box.boxId || '');
    const boxCones = conesByBox.get(boxId) || [];
    const stCones = boxCones.filter(
      (c) => c.coneStorageId != null && String(c.coneStorageId).trim() !== ''
    );
    const dbNumberOfCones = num(box.numberOfCones);
    const coneDataCount = num(box.coneData?.numberOfCones);

    map.set(boxId, {
      dbBoxWeight: num(box.boxWeight),
      dbGrossWeight: num(box.grossWeight),
      dbNumberOfCones,
      dbConeDataNumberOfCones: coneDataCount,
      dbStorageLocation: box.storageLocation ?? '',
      dbStoredStatus: Boolean(box.storedStatus),
      dbConesIssued: Boolean(box.coneData?.conesIssued),
      actualConeCount: boxCones.length,
      stConeCount: stCones.length,
      stConeWeightSum: stCones.reduce((s, c) => s + num(c.coneWeight), 0),
      conesOnStMismatch:
        stCones.length > 0 &&
        (dbNumberOfCones !== stCones.length ||
          (coneDataCount > 0 && coneDataCount !== stCones.length)),
    });
  }

  await mongoose.disconnect();
  return map;
}

/**
 * Scans live DB for boxes with ST cones but count mismatch (no sync CSV needed).
 * @param {string} url
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function scanLiveStMismatches(url) {
  if (!url) return [];
  await mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });
  const db = mongoose.connection.db;

  /** @type {Record<string, unknown>} */
  const boxQuery = { returnedToVendorAt: null };
  if (PO_FILTER) boxQuery.poNumber = PO_FILTER;

  const boxes = await db.collection('yarnboxes').find(boxQuery).toArray();
  const allCones = await db
    .collection('yarncones')
    .find(PO_FILTER ? { poNumber: PO_FILTER, returnedToVendorAt: null } : { returnedToVendorAt: null })
    .toArray();

  /** @type {Map<string, Record<string, unknown>[]>} */
  const conesByBox = new Map();
  for (const c of allCones) {
    const k = String(c.boxId || '');
    if (!conesByBox.has(k)) conesByBox.set(k, []);
    conesByBox.get(k).push(c);
  }

  /** @type {Record<string, unknown>[]} */
  const rows = [];

  for (const box of boxes) {
    const boxId = String(box.boxId || '');
    const boxCones = conesByBox.get(boxId) || [];
    const stCones = boxCones.filter(
      (c) => c.coneStorageId != null && String(c.coneStorageId).trim() !== ''
    );
    if (stCones.length === 0) continue;

    const dbNumberOfCones = num(box.numberOfCones);
    const coneDataCount = num(box.coneData?.numberOfCones);
    const mismatch =
      (dbNumberOfCones > 0 && dbNumberOfCones !== stCones.length) ||
      (coneDataCount > 0 && coneDataCount !== stCones.length) ||
      (dbNumberOfCones > 0 && dbNumberOfCones !== boxCones.length);

    if (!mismatch) continue;

    rows.push({
      source: 'live_db_st_mismatch',
      poNumber: box.poNumber ?? '',
      boxBarcode: box.barcode ?? '',
      boxMongoId: String(box._id ?? ''),
      boxId,
      yarnName: box.yarnName ?? '',
      lotNumber: box.lotNumber ?? '',
      dbBoxWeightKg: num(box.boxWeight),
      dbStorageLocation: box.storageLocation ?? '',
      dbStoredStatus: Boolean(box.storedStatus),
      dbNumberOfCones,
      dbConeDataNumberOfCones: coneDataCount,
      actualConeCount: boxCones.length,
      stConeCount: stCones.length,
      stConeWeightSumKg: stCones.reduce((s, c) => s + num(c.coneWeight), 0),
      mismatchDetail:
        dbNumberOfCones !== stCones.length
          ? `box.numberOfCones(${dbNumberOfCones}) vs stCones(${stCones.length})`
          : `coneData(${coneDataCount}) vs stCones(${stCones.length})`,
    });
  }

  await mongoose.disconnect();
  return rows;
}

/**
 * Writes multi-sheet Excel workbook.
 * @param {string} filePath
 * @param {object} sheets
 */
function writeXlsx(filePath, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: 'No rows' }]),
      name.slice(0, 31)
    );
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  XLSX.writeFile(wb, filePath);
}

/**
 * Builds PO summary from box rows.
 * @param {Record<string, unknown>[]} boxRows
 * @returns {Record<string, unknown>[]}
 */
function buildPoSummary(boxRows) {
  /** @type {Map<string, { poNumber: string, boxCount: number, coneCountChanges: number, weightChanges: number, locationChanges: number }>} */
  const byPo = new Map();

  for (const row of boxRows) {
    const po = String(row.poNumber || '');
    if (!byPo.has(po)) {
      byPo.set(po, { poNumber: po, boxCount: 0, coneCountChanges: 0, weightChanges: 0, locationChanges: 0 });
    }
    const agg = byPo.get(po);
    agg.boxCount += 1;
    if (String(row.changeFlags || '').includes('cone_count')) agg.coneCountChanges += 1;
    if (String(row.changeFlags || '').includes('weight_changed')) agg.weightChanges += 1;
    if (String(row.changeFlags || '').includes('location_changed')) agg.locationChanges += 1;
  }

  return [...byPo.values()].sort((a, b) => a.poNumber.localeCompare(b.poNumber));
}

/**
 * Main entry.
 * @returns {Promise<void>}
 */
async function main() {
  const syncCsv = SYNC_CSV_ARG ? path.resolve(process.cwd(), SYNC_CSV_ARG) : findLatestSyncCsv();
  if (!syncCsv || !fs.existsSync(syncCsv)) {
    throw new Error('sync-update-report.csv not found. Pass --sync-csv=PATH or run dataaudit sync first.');
  }

  logger.info(`[report-yarn-st-resync-overwrites] reading ${syncCsv}`);
  let records = readSyncCsv(syncCsv);
  if (PO_FILTER) records = records.filter((r) => r.poNumber === PO_FILTER);

  const syncBoxRows = records.filter(isStoredResyncOverwrite);

  /** @type {Record<string, unknown>[]} */
  const boxRows = syncBoxRows.map((row) => ({
    source: 'sync_csv_resync',
    changeFlags: buildChangeFlags(row),
    poNumber: row.poNumber ?? '',
    boxBarcode: row.barcode ?? '',
    boxMongoId: row.docId ?? '',
    boxId: row.boxId ?? '',
    yarnName: row.yarnName ?? '',
    syncStatus: row.status ?? '',
    syncRackIssue: row.rackIssue ?? '',
    syncMessage: row.message ?? '',
    beforeGrossWeightKg: num(row.beforeWeight),
    beforeNetWeightKg: num(row.beforeNetWeight),
    beforeLocation: row.beforeLocation ?? '',
    beforeNumberOfCones: num(row.beforeNumberOfCones),
    afterGrossWeightKg: num(row.afterWeight),
    afterNetWeightKg: num(row.afterNetWeight),
    afterLocation: row.afterLocation ?? '',
    afterNumberOfCones: num(row.afterNumberOfCones),
    coneCountDelta: num(row.afterNumberOfCones) - num(row.beforeNumberOfCones),
    netWeightDelta: num(row.afterNetWeight) - num(row.beforeNetWeight),
    grossWeightDelta: num(row.afterWeight) - num(row.beforeWeight),
  }));

  boxRows.sort(
    (a, b) =>
      String(a.poNumber).localeCompare(String(b.poNumber)) ||
      String(a.boxId).localeCompare(String(b.boxId))
  );

  /** @type {Record<string, unknown>[]} */
  let liveMismatchRows = [];
  const { url, source } = resolveMongoConnectionString();

  if (!SKIP_LIVE && url) {
    logger.info(`[report-yarn-st-resync-overwrites] enriching from ${source}`);
    const liveStats = await loadLiveBoxStats(
      url,
      boxRows.map((r) => String(r.boxId || '')).filter(Boolean)
    );

    for (const row of boxRows) {
      const live = liveStats.get(String(row.boxId || ''));
      if (!live) continue;
      Object.assign(row, {
        liveDbBoxWeightKg: live.dbBoxWeight,
        liveDbGrossWeightKg: live.dbGrossWeight,
        liveDbNumberOfCones: live.dbNumberOfCones,
        liveDbConeDataNumberOfCones: live.dbConeDataNumberOfCones,
        liveDbStorageLocation: live.dbStorageLocation,
        liveDbStoredStatus: live.dbStoredStatus,
        liveActualConeCount: live.actualConeCount,
        liveStConeCount: live.stConeCount,
        liveStConeWeightSumKg: live.stConeWeightSum,
        liveStCountMismatch: live.conesOnStMismatch ? 'yes' : 'no',
      });
    }

    liveMismatchRows = await scanLiveStMismatches(url);
    liveMismatchRows.sort((a, b) => String(a.poNumber).localeCompare(String(b.poNumber)));
  }

  const poSummary = buildPoSummary(boxRows);
  const coneCountChangeRows = boxRows.filter((r) => num(r.coneCountDelta) !== 0);

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.resolve(process.cwd(), OUT_PATH || `./reports/yarn-st-resync-overwrites-${ts}.xlsx`);

  writeXlsx(outPath, {
    Summary: [
      { metric: 'syncCsvPath', value: syncCsv },
      { metric: 'poFilter', value: PO_FILTER || '(all)' },
      { metric: 'syncBoxResyncRows', value: boxRows.length },
      { metric: 'syncConeCountChangedRows', value: coneCountChangeRows.length },
      { metric: 'uniquePOs', value: poSummary.length },
      { metric: 'liveStMismatchRows', value: liveMismatchRows.length },
      { metric: 'mongoSource', value: SKIP_LIVE ? 'skipped' : source },
    ],
    POSummary: poSummary,
    SyncResyncBoxes: boxRows,
    SyncConeCountChanges: coneCountChangeRows,
    LiveStConeMismatch: liveMismatchRows,
  });

  console.log('\n=== ST / stored data resync overwrite report ===');
  console.log(`Sync CSV: ${syncCsv}`);
  console.log(`Output:   ${outPath}`);
  console.log(`Boxes already stored & re-updated by sync: ${boxRows.length}`);
  console.log(`  cone count changed (e.g. 13→15): ${coneCountChangeRows.length}`);
  console.log(`  unique POs: ${poSummary.length}`);
  console.log(`Live ST cone count mismatches: ${liveMismatchRows.length}`);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
