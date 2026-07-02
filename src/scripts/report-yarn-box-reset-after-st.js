#!/usr/bin/env node
/**
 * Report boxes where cones were ALREADY on short-term (ST) racks but a sync/update
 * reset the box document back to a "new / LT stored box" state — e.g. restored
 * boxWeight, storageLocation, storedStatus, and changed numberOfCones (13 → 15)
 * even though ST cones already existed.
 *
 * Match rules (live DB):
 *   - stConeCount > 0  (≥1 cone with coneStorageId on ST rack)
 *   - AND at least one reset signal:
 *       BOX_BACK_ON_LT_RACK      storedStatus + boxWeight>0 + storageLocation on box
 *       BOX_CONE_COUNT_NE_ST     box.numberOfCones ≠ stConeCount
 *       CONEDATA_COUNT_NE_ST     box.coneData.numberOfCones ≠ stConeCount
 *       CONES_ISSUED_FALSE       coneData.conesIssued is false while ST cones exist
 *
 * Optional sync CSV enrichment: before/after cone counts & weights from dataaudit apply.
 *
 * Usage (from AddOn_backend):
 *   NODE_ENV=development node src/scripts/report-yarn-box-reset-after-st.js
 *   NODE_ENV=development node src/scripts/report-yarn-box-reset-after-st.js --po=PO-2026-997
 *   NODE_ENV=development node src/scripts/report-yarn-box-reset-after-st.js --out=./reports/st-box-reset.xlsx
 *
 * Flags:
 *   --po=PO-NUMBER
 *   --out=PATH
 *   --mongo-url=
 *   --sync-csv=PATH     Optional sync-update-report.csv for before/after columns
 *   --strict            Only BOX_BACK_ON_LT_RACK (box physically back on LT rack)
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
const STRICT = process.argv.includes('--strict');

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
 * @param {unknown} v
 * @returns {number}
 */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
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
 * @param {string} filePath
 * @returns {Map<string, Record<string, string>>}
 */
function loadSyncByBoxId(filePath) {
  /** @type {Map<string, Record<string, string>>} */
  const map = new Map();
  if (!filePath || !fs.existsSync(filePath)) return map;

  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  for (const line of lines.slice(1)) {
    const vals = parseCsvLine(line);
    /** @type {Record<string, string>} */
    const row = {};
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? '';
    });
    if (row.entityType === 'box' && row.status === 'updated' && row.boxId) {
      map.set(String(row.boxId), row);
    }
  }
  return map;
}

/**
 * Finds newest sync-update-report.csv under ./reports.
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
 * Classifies whether a box was reset after ST transfer.
 * @param {Record<string, unknown>} box
 * @param {Record<string, unknown>[]} allCones
 * @returns {{ match: boolean, problems: string[], stCones: Record<string, unknown>[] }|null}
 */
function classifyBoxResetAfterSt(box, allCones) {
  const stCones = allCones.filter(
    (c) => c.coneStorageId != null && String(c.coneStorageId).trim() !== ''
  );
  if (stCones.length === 0) return null;

  const stCount = stCones.length;
  const docCones = num(box.numberOfCones);
  const coneDataCount = num(box.coneData?.numberOfCones);
  const backOnLt =
    Boolean(box.storedStatus) &&
    num(box.boxWeight) > WEIGHT_EPS &&
    String(box.storageLocation ?? '').trim() !== '';

  /** @type {string[]} */
  const problems = [];
  if (backOnLt) problems.push('BOX_BACK_ON_LT_RACK');
  if (docCones > 0 && docCones !== stCount) problems.push('BOX_CONE_COUNT_NE_ST');
  if (coneDataCount > 0 && coneDataCount !== stCount) problems.push('CONEDATA_COUNT_NE_ST');

  if (STRICT && !backOnLt) return null;
  if (!problems.length) return null;

  if (!box.coneData?.conesIssued) problems.push('CONES_ISSUED_FLAG_FALSE');

  return { match: true, problems, stCones };
}

/**
 * Builds one Excel row for a matched box.
 * @param {Record<string, unknown>} box
 * @param {Record<string, unknown>[]} allCones
 * @param {Record<string, unknown>[]} stCones
 * @param {string[]} problems
 * @param {Record<string, string>|undefined} syncRow
 * @returns {Record<string, unknown>}
 */
function buildRow(box, allCones, stCones, problems, syncRow) {
  const stWeight = stCones.reduce((s, c) => s + num(c.coneWeight), 0);
  const stSlots = [...new Set(stCones.map((c) => String(c.coneStorageId || '')).filter(Boolean))];

  return {
    problemTypes: problems.join(', '),
    poNumber: box.poNumber ?? '',
    boxBarcode: box.barcode ?? '',
    boxMongoId: String(box._id ?? ''),
    boxId: box.boxId ?? '',
    yarnName: box.yarnName ?? '',
    lotNumber: box.lotNumber ?? '',
    shadeCode: box.shadeCode ?? '',
    boxWeightKg: num(box.boxWeight),
    grossWeightKg: box.grossWeight ?? '',
    storedStatus: Boolean(box.storedStatus),
    storageLocation: box.storageLocation ?? '',
    numberOfConesOnBox: num(box.numberOfCones),
    coneDataNumberOfCones: num(box.coneData?.numberOfCones),
    conesIssuedFlag: Boolean(box.coneData?.conesIssued),
    actualConeCount: allCones.length,
    stConeCount: stCones.length,
    stConeWeightSumKg: stWeight,
    stStorageSlots: stSlots.join('; '),
    syncBeforeNumberOfCones: syncRow ? num(syncRow.beforeNumberOfCones) : '',
    syncAfterNumberOfCones: syncRow ? num(syncRow.afterNumberOfCones) : '',
    syncConeCountDelta: syncRow
      ? num(syncRow.afterNumberOfCones) - num(syncRow.beforeNumberOfCones)
      : '',
    syncBeforeNetWeightKg: syncRow ? num(syncRow.beforeNetWeight) : '',
    syncAfterNetWeightKg: syncRow ? num(syncRow.afterNetWeight) : '',
    syncBeforeLocation: syncRow?.beforeLocation ?? '',
    syncAfterLocation: syncRow?.afterLocation ?? '',
    expectedAfterTransfer:
      'boxWeight=0, storedStatus=false, no storageLocation, conesIssued=true, numberOfCones=stConeCount',
    recommendedAction:
      'Fix box doc: zero LT weight, clear storageLocation, set conesIssued=true; align numberOfCones to stConeCount',
  };
}

/**
 * @param {string} filePath
 * @param {Record<string, object[]>} sheets
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
 * @param {Record<string, unknown>[]} boxRows
 * @returns {Record<string, unknown>[]}
 */
function buildPoSummary(boxRows) {
  /** @type {Map<string, { poNumber: string, boxCount: number, backOnLt: number, coneCountMismatch: number }>} */
  const byPo = new Map();
  for (const row of boxRows) {
    const po = String(row.poNumber || '');
    if (!byPo.has(po)) {
      byPo.set(po, { poNumber: po, boxCount: 0, backOnLt: 0, coneCountMismatch: 0 });
    }
    const agg = byPo.get(po);
    agg.boxCount += 1;
    if (String(row.problemTypes || '').includes('BOX_BACK_ON_LT_RACK')) agg.backOnLt += 1;
    if (
      String(row.problemTypes || '').includes('BOX_CONE_COUNT_NE_ST') ||
      String(row.problemTypes || '').includes('CONEDATA_COUNT_NE_ST')
    ) {
      agg.coneCountMismatch += 1;
    }
  }
  return [...byPo.values()].sort((a, b) => a.poNumber.localeCompare(b.poNumber));
}

/**
 * Main entry.
 * @returns {Promise<void>}
 */
async function main() {
  const { url, source } = resolveMongoConnectionString();
  if (!url) throw new Error('MongoDB URL missing');

  const syncCsv = SYNC_CSV_ARG ? path.resolve(process.cwd(), SYNC_CSV_ARG) : findLatestSyncCsv();
  const syncByBoxId = loadSyncByBoxId(syncCsv || '');

  logger.info(`[report-yarn-box-reset-after-st] connecting via ${source}`);
  if (syncCsv) logger.info(`[report-yarn-box-reset-after-st] sync CSV: ${syncCsv}`);

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
  const conesByBoxId = new Map();
  for (const c of allCones) {
    const k = String(c.boxId || '');
    if (!conesByBoxId.has(k)) conesByBoxId.set(k, []);
    conesByBoxId.get(k).push(c);
  }

  /** @type {Record<string, unknown>[]} */
  const boxRows = [];

  for (const box of boxes) {
    const boxCones = conesByBoxId.get(String(box.boxId || '')) || [];
    const classified = classifyBoxResetAfterSt(box, boxCones);
    if (!classified) continue;

    const syncRow = syncByBoxId.get(String(box.boxId || ''));
    boxRows.push(
      buildRow(box, boxCones, classified.stCones, classified.problems, syncRow)
    );
  }

  boxRows.sort(
    (a, b) =>
      String(a.poNumber).localeCompare(String(b.poNumber)) ||
      String(a.boxId).localeCompare(String(b.boxId))
  );

  await mongoose.disconnect();

  const poSummary = buildPoSummary(boxRows);
  const backOnLtRows = boxRows.filter((r) =>
    String(r.problemTypes || '').includes('BOX_BACK_ON_LT_RACK')
  );
  const syncConeChangeRows = boxRows.filter((r) => num(r.syncConeCountDelta) !== 0);

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.resolve(
    process.cwd(),
    OUT_PATH || `./reports/yarn-box-reset-after-st-${ts}.xlsx`
  );

  writeXlsx(outPath, {
    Summary: [
      { metric: 'mode', value: STRICT ? 'strict (LT rack reset only)' : 'all reset signals' },
      { metric: 'poFilter', value: PO_FILTER || '(all)' },
      { metric: 'matchedBoxes', value: boxRows.length },
      { metric: 'boxesBackOnLtRack', value: backOnLtRows.length },
      { metric: 'syncConeCountChanged', value: syncConeChangeRows.length },
      { metric: 'uniquePOs', value: poSummary.length },
      { metric: 'syncCsv', value: syncCsv || '(none)' },
      { metric: 'mongoSource', value: source },
    ],
    POSummary: poSummary,
    ResetAfterStBoxes: boxRows,
    BackOnLtRack: backOnLtRows,
    SyncConeCountChanged: syncConeChangeRows,
  });

  console.log('\n=== Boxes reset after ST transfer ===');
  console.log(`Output: ${outPath}`);
  console.log(`Matched: ${boxRows.length} boxes (${poSummary.length} POs)`);
  console.log(`  back on LT rack: ${backOnLtRows.length}`);
  console.log(`  sync cone count changed: ${syncConeChangeRows.length}`);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
