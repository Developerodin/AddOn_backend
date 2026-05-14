#!/usr/bin/env node

/**
 * Mark YarnCones from an Excel barcode list as **used** (empty / no longer on ST racks): align DB with reality when
 * cones were consumed in production but rows were never cleared (`issueConeFloorIssue.service.js` semantics).
 *
 * Per matched YarnCone (bulk updateOne — avoids pre/post save hooks firing per doc):
 *   - issueStatus  -> used
 *   - coneWeight   -> 0
 *   - tearWeight   -> 0
 *   - issueWeight  -> last net kg before wipe (`coneWeight - tearWeight`) if positive; else preserve existing issueWeight
 *   - issueDate    -> preserved if already set; otherwise set to now
 *   - $unset       coneStorageId, orderId, articleId
 *
 * YarnInventory: after APPLY, calls `syncInventoriesFromStorageForCatalogIds` for catalogs touched (post-save hooks
 * do not recalculate ST when the saved cone no longer qualifies as counted ST stock).
 *
 * CSV report: for `updated` / `would_update` rows, **`before*`** is the DB snapshot **before** the write; **`after*`**
 * is exactly what APPLY sets (`used`, weights 0, `coneStorageId` cleared via `$unset`; `issueWeight` = last net kg
 * when positive, else preserved prior `issueWeight`). On APPLY, `orderId` and `articleId` are **always `$unset`**.
 *
 * Excel:
 *   Needs a barcode column (`barcode`, `Barcode`, …). Headers may start after banner rows (`--header-row`).
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/mark-yarn-cones-used-from-excel.js \
 *     --file="./Short Term Cones Removal.xlsx" --sheet="371 cones ST" --header-row=5 --dry-run
 *   NODE_ENV=development node src/scripts/mark-yarn-cones-used-from-excel.js \
 *     --file="./Short Term Cones Removal.xlsx" --sheet="371 cones ST" --header-row=5 --apply
 *
 * Flags:
 *   --file=PATH     Required .xlsx path.
 *   --sheet=NAME    Sheet name (default first sheet).
 *   --header-row=N  Excel 1-based row where header cells are (omit if row 1 is the header row).
 *   --dry-run       Default unless --apply passed.
 *   --apply         Persist updates.
 *   --report=PATH   CSV path (defaults to ./mark-cones-used-report-<ts>.csv).
 *   --mongo-url=    Override Mongo connection string (else config.mongoose.url / MONGODB_URL).
 */

import './lib/mongoUrlParsePatch.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnCone } from '../models/index.js';
import { syncInventoriesFromStorageForCatalogIds } from '../services/yarnManagement/yarnInventory.service.js';

const WEIGHT_EPS = 1e-9;

/**
 * Reads `--prefix=value` CLI args.
 * @param {string} prefix e.g. '--file='
 * @returns {string|null}
 */
function getArg(prefix) {
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) return null;
  return found.slice(prefix.length).trim() || null;
}

const FILE_PATH = getArg('--file=');
const SHEET_NAME = getArg('--sheet=');
const REPORT_PATH = getArg('--report=');
const HEADER_ROW_RAW = getArg('--header-row=');
const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY || process.argv.includes('--dry-run');

/**
 * @returns {number|null}
 */
function parseOptionalHeaderExcelRow() {
  if (HEADER_ROW_RAW == null || HEADER_ROW_RAW === '') return null;
  const n = Number(HEADER_ROW_RAW);
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
    throw new Error(`Invalid --header-row=${HEADER_ROW_RAW}; use an integer Excel row ≥ 1`);
  }
  return n;
}

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
  const cli = getArg('--mongo-url=');
  if (cli) return { url: sanitizeMongoUrl(cli), source: '--mongo-url' };
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) return { url: cfg, source: 'config.mongoose.url' };
  return { url: sanitizeMongoUrl(String(process.env.MONGODB_URL || '')), source: 'process.env.MONGODB_URL' };
}

/**
 * Connect to MongoDB.
 * @returns {Promise<void>}
 */
async function connectMongo() {
  const { url: u, source } = resolveMongoConnectionString();
  if (!u) throw new Error('MongoDB URL is empty. Set MONGODB_URL or pass --mongo-url=');
  const redacted = u.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`Connecting to MongoDB (${source}): ${redacted}`);
  await mongoose.connect(u, { useNewUrlParser: true, useUnifiedTopology: true });
}

/**
 * Parses sheet rows keyed by barcode.
 * @param {string} filePath
 * @param {string|null} sheetName
 * @param {number|null} headerExcelRowOneBased
 * @returns {Array<{ barcode: string; rowIndex: number }>}
 */
function readBarcodeRows(filePath, sheetName, headerExcelRowOneBased) {
  if (!fs.existsSync(filePath)) throw new Error(`Excel file not found: ${filePath}`);
  const wb = XLSX.readFile(filePath);
  const sheet = sheetName ? wb.Sheets[sheetName] : wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error(`Sheet not found. Available: ${wb.SheetNames.join(', ')}`);
  const opts = { defval: null, raw: false };
  if (headerExcelRowOneBased != null) opts.range = headerExcelRowOneBased - 1;
  const rows = XLSX.utils.sheet_to_json(sheet, opts);
  const firstDataExcelRow = headerExcelRowOneBased != null ? headerExcelRowOneBased + 1 : 2;
  /** @type {{ barcode: string, rowIndex: number }[]} */
  const out = [];
  for (let idx = 0; idx < rows.length; idx += 1) {
    const row = rows[idx];
    const norm = {};
    for (const [k, v] of Object.entries(row)) {
      norm[String(k).trim().toLowerCase()] = v == null ? '' : String(v).trim();
    }
    const barcode =
      norm['barcode'] || norm['cone barcode'] || norm['cone barcode id'] || norm['yarn cone barcode'] || '';
    out.push({
      rowIndex: firstDataExcelRow + idx,
      barcode,
    });
  }
  return out;
}

/**
 * Loads an active YarnCone by barcode with case-insensitive fallback.
 * @param {string} raw
 * @returns {Promise<import('mongoose').Document|null>}
 */
async function findConeByBarcode(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const direct = await YarnCone.findOne({ barcode: trimmed });
  if (direct) return direct;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return YarnCone.findOne({ barcode: new RegExp(`^${escaped}$`, 'i') });
}

/**
 * @param {import('mongoose').Document} cone
 * @returns {{ alreadyFinal: boolean, reason?: string }}
 */
function describeConeIfAlreadyConsumed(cone) {
  const hasStorage = cone.coneStorageId != null && String(cone.coneStorageId).trim() !== '';
  const cw = Number(cone.coneWeight ?? 0);
  const tw = Number(cone.tearWeight ?? 0);
  const w0 = cw <= WEIGHT_EPS && tw <= WEIGHT_EPS;
  if (cone.issueStatus === 'used' && !hasStorage && w0) {
    return { alreadyFinal: true, reason: 'already_used_cleared' };
  }
  return { alreadyFinal: false };
}

/**
 * @param {{ rows: unknown[] }}
 * @returns {string}
 */
function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

async function main() {
  if (!FILE_PATH) {
    // eslint-disable-next-line no-console
    console.error(
      'Usage: node src/scripts/mark-yarn-cones-used-from-excel.js --file=<path.xlsx> [--sheet=NAME] [--header-row=N] [--dry-run|--apply] [--report=PATH]'
    );
    process.exit(1);
  }

  const headerExcelRowOneBased = parseOptionalHeaderExcelRow();
  logger.info(`Mode: ${APPLY ? 'APPLY (writes will happen)' : 'DRY RUN (no writes)'}`);

  const rawRows = readBarcodeRows(FILE_PATH, SHEET_NAME, headerExcelRowOneBased);
  logger.info(`Read ${rawRows.length} excel row(s) from ${path.basename(FILE_PATH)}${SHEET_NAME ? ` [${SHEET_NAME}]` : ''}`);

  const seen = new Set();
  /** @type {{ barcode: string, rowIndex: number; isDup?: boolean }[]} */
  const rows = [];
  for (const r of rawRows) {
    const b = String(r.barcode || '').trim();
    if (!b) {
      rows.push({ rowIndex: r.rowIndex, barcode: '' });
      continue;
    }
    if (seen.has(b)) {
      rows.push({ rowIndex: r.rowIndex, barcode: b, isDup: true });
      continue;
    }
    seen.add(b);
    rows.push({ rowIndex: r.rowIndex, barcode: b });
  }

  await connectMongo();

  /** @type {object[]} */
  const report = [];
  /** @type {Set<string>} */
  const catalogIdsToSync = new Set();
  let updated = 0;
  let skippedDup = 0;
  let skippedEmpty = 0;
  let skippedFinal = 0;
  let notFound = 0;
  let skippedVendorReturn = 0;

  for (const row of rows) {
    if (!row.barcode) {
      skippedEmpty += 1;
      report.push({
        rowIndex: row.rowIndex,
        barcode: '',
        status: 'skip_empty_barcode',
      });
      continue;
    }
    if (row.isDup) {
      skippedDup += 1;
      report.push({
        rowIndex: row.rowIndex,
        barcode: row.barcode,
        status: 'skip_duplicate_barcode_in_excel',
      });
      continue;
    }

    const cone = await findConeByBarcode(row.barcode);
    if (!cone) {
      notFound += 1;
      report.push({
        rowIndex: row.rowIndex,
        barcode: row.barcode,
        status: 'not_found',
      });
      continue;
    }

    const vendorRet = cone.returnedToVendorAt != null;
    if (vendorRet) {
      skippedVendorReturn += 1;
      report.push({
        rowIndex: row.rowIndex,
        barcode: cone.barcode || row.barcode,
        coneId: String(cone._id),
        status: 'skip_returned_to_vendor',
      });
      continue;
    }

    const fin = describeConeIfAlreadyConsumed(cone);
    if (fin.alreadyFinal) {
      skippedFinal += 1;
      report.push({
        rowIndex: row.rowIndex,
        barcode: cone.barcode,
        coneId: String(cone._id),
        status: fin.reason,
      });
      continue;
    }

    const priorNet =
      Number(cone.coneWeight ?? 0) -
      Number(cone.tearWeight ?? 0);
    const issueWeightToSet =
      priorNet > WEIGHT_EPS ? priorNet : Math.max(0, Number(cone.issueWeight ?? 0));
    const issueDateToSet = cone.issueDate || new Date();
    const before = {
      issueStatus: cone.issueStatus,
      coneWeight: Number(cone.coneWeight ?? 0),
      tearWeight: Number(cone.tearWeight ?? 0),
      coneStorageId: cone.coneStorageId != null ? String(cone.coneStorageId) : '',
      issueWeight: Number(cone.issueWeight ?? 0),
    };
    /** Target state persisted on APPLY — matches `issueConeForFloor` cone-side cleanup. */
    const after = {
      issueStatus: 'used',
      coneWeight: 0,
      tearWeight: 0,
      coneStorageId: '',
      issueWeight: issueWeightToSet,
    };

    if (cone.yarnCatalogId != null && String(cone.yarnCatalogId).trim()) {
      catalogIdsToSync.add(String(cone.yarnCatalogId));
    }

    if (APPLY) {
      try {
        await YarnCone.updateOne(
          { _id: cone._id },
          {
            $set: {
              issueStatus: 'used',
              coneWeight: 0,
              tearWeight: 0,
              issueWeight: issueWeightToSet,
              issueDate: issueDateToSet,
            },
            $unset: { coneStorageId: '', orderId: '', articleId: '' },
          }
        );
        updated += 1;
        report.push({
          rowIndex: row.rowIndex,
          barcode: cone.barcode,
          coneId: String(cone._id),
          yarnCatalogId: cone.yarnCatalogId ? String(cone.yarnCatalogId) : '',
          status: 'updated',
          beforeIssueStatus: before.issueStatus,
          beforeConeWeight: before.coneWeight,
          beforeTearWeight: before.tearWeight,
          beforeConeStorageId: before.coneStorageId,
          beforeIssueWeight: before.issueWeight,
          afterIssueStatus: after.issueStatus,
          afterConeWeight: after.coneWeight,
          afterTearWeight: after.tearWeight,
          afterConeStorageId: after.coneStorageId,
          afterIssueWeight: after.issueWeight,
        });
      } catch (err) {
        report.push({
          rowIndex: row.rowIndex,
          barcode: cone.barcode,
          coneId: String(cone._id),
          status: 'error',
          message: err && err.message ? err.message : String(err),
        });
      }
    } else {
      report.push({
        rowIndex: row.rowIndex,
        barcode: cone.barcode,
        coneId: String(cone._id),
        yarnCatalogId: cone.yarnCatalogId ? String(cone.yarnCatalogId) : '',
        status: 'would_update',
        beforeIssueStatus: before.issueStatus,
        beforeConeWeight: before.coneWeight,
        beforeTearWeight: before.tearWeight,
        beforeConeStorageId: before.coneStorageId,
        beforeIssueWeight: before.issueWeight,
        afterIssueStatus: after.issueStatus,
        afterConeWeight: after.coneWeight,
        afterTearWeight: after.tearWeight,
        afterConeStorageId: after.coneStorageId,
        afterIssueWeight: after.issueWeight,
      });
    }
  }

  if (APPLY && catalogIdsToSync.size > 0) {
    logger.info(`Syncing YarnInventory from storage for ${catalogIdsToSync.size} catalog(s) …`);
    try {
      await syncInventoriesFromStorageForCatalogIds([...catalogIdsToSync]);
    } catch (e) {
      logger.error('[mark-yarn-cones-used] Inventory sync failed:', e.message || e);
      report.push({
        rowIndex: -1,
        barcode: '_inventory_sync_',
        status: 'inventory_sync_error',
        message: e && e.message ? e.message : String(e),
      });
    }
  }

  const totals = {
    totalExcelRows: rawRows.length,
    uniqueBarcodeRows: rows.filter((r) => r.barcode && !r.isDup).length,
    notFound,
    skippedDup,
    skippedEmpty,
    skippedFinal,
    skippedVendorReturn,
    [APPLY ? 'updated' : 'wouldUpdate']: APPLY ? updated : report.filter((x) => x.status === 'would_update').length,
  };

  // eslint-disable-next-line no-console
  console.log('\n=== Mark cones used summary ===');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(totals, null, 2));

  const outPath = REPORT_PATH || `./mark-cones-used-report-${Date.now()}.csv`;
  fs.writeFileSync(outPath, toCsv(report), 'utf8');
  logger.info(`Wrote report: ${path.resolve(outPath)}`);

  if (DRY_RUN) {
    logger.warn('DRY RUN — no DB writes. Re-run with --apply.');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
