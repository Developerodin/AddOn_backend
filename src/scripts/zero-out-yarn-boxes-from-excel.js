#!/usr/bin/env node

/**
 * Zero-out empty YarnBoxes (already-used in real life) and detach them from storage,
 * driven by an Excel file containing barcodes (and optional Box IDs).
 *
 * What it does (per matched YarnBox):
 *   - boxWeight        -> 0
 *   - grossWeight      -> 0
 *   - numberOfCones    -> 0
 *   - storedStatus     -> false
 *   - storageLocation  -> '' (empty)
 *   - tearweight       -> kept as-is (used for audit / re-stocking)
 *   - initialBoxWeight -> kept as-is (audit trail of the original LT weight)
 *
 * Excel expectations:
 *   Table must include columns "Barcode" and/or "Box ID" (case-insensitive), or synonyms "Yarn Box Barcode", "Yarn Box ID".
 *   Either barcode or Box ID per row works; YarnBox lookup prefers barcode then boxId.
 *   If banners sit above the table (e.g. this project’s “Box in System but not in Hand.xlsx”): the script **auto-detects**
 *   the header row by scanning for columns named Barcode and/or Box ID. Override with `--header-row=<N>` (1-based Excel row)
 *   if detection picks the wrong row.
 *
 * Usage:
 *   node src/scripts/zero-out-yarn-boxes-from-excel.js --file=./issues-in-boxes.xlsx --dry-run
 *   node src/scripts/zero-out-yarn-boxes-from-excel.js --file=./issues-in-boxes.xlsx --apply
 *   node src/scripts/zero-out-yarn-boxes-from-excel.js --file=./foo.xlsx --apply --sheet="BoxIds Need to be Zeroed"
 *   node src/scripts/zero-out-yarn-boxes-from-excel.js --file=./foo.xlsx --apply --report=./zero-out-report.csv
 *   node src/scripts/zero-out-yarn-boxes-from-excel.js --file=./Unallocated\ Stock.xlsx --sheet="Unallocated Stock" --header-row=4 --dry-run
 *
 * Flags:
 *   --file=PATH        Path to the .xlsx file (required).
 *   --sheet=NAME       Sheet name (defaults to first sheet).
 *   --header-row=N     Optional. Force 1-based Excel row of headers; if omitted, the sheet is scanned for Barcode/Box ID columns.
 *   --dry-run          Default. Resolves rows and prints the plan without writing.
 *   --apply            Required to actually write changes.
 *   --report=PATH      Optional CSV report path (defaults to ./zero-out-report-<ts>.csv).
 *   --mongo-url=URL    Override MongoDB URL (otherwise uses config / MONGODB_URL).
 *
 * Mongo URL resolution mirrors check-yarn-lt-st-by-barcode.js: CLI > config > env.
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

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox } from '../models/index.js';

/**
 * Parse a string CLI argument like `--key=value`.
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
 * Parse optional 1-based Excel header row (--header-row=N).
 * @returns {number|null}
 */
function parseOptionalHeaderExcelRow() {
  if (HEADER_ROW_RAW == null || HEADER_ROW_RAW === '') return null;
  const n = Number(HEADER_ROW_RAW);
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
    throw new Error(`Invalid --header-row=${HEADER_ROW_RAW}; use an integer Excel row ≥ 1 (e.g. 4)`);
  }
  return n;
}

/**
 * Strip wrapping quotes / BOM / stray CR from a Mongo URL string.
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
 * Resolve Mongo URL: CLI flag > app config > raw env.
 * @returns {{ url: string, source: string }}
 */
function resolveMongoConnectionString() {
  const cli = getArg('--mongo-url=');
  if (cli) return { url: sanitizeMongoUrl(cli), source: '--mongo-url' };
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) return { url: cfg, source: 'config.mongoose.url' };
  return { url: sanitizeMongoUrl(String(process.env.MONGODB_URL || '')), source: 'process.env.MONGODB_URL' };
}

const MONGO_CONNECT_OPTIONS = { useNewUrlParser: true, useUnifiedTopology: true };

/**
 * Connect to MongoDB.
 * @returns {Promise<void>}
 */
async function connectMongo() {
  const { url: u, source } = resolveMongoConnectionString();
  if (!u) throw new Error('MongoDB URL is empty. Set MONGODB_URL or pass --mongo-url=');
  const redacted = u.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`Connecting to MongoDB (${source}): ${redacted}`);
  await mongoose.connect(u, MONGO_CONNECT_OPTIONS);
}

/**
 * Load one worksheet from an .xlsx file.
 * @param {string} filePath
 * @param {string|null} sheetName Sheet name or null for first sheet.
 * @returns {{ sheet: import('xlsx').WorkSheet, sheetLabel: string }}
 */
function loadWorksheet(filePath, sheetName) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }
  const wb = XLSX.readFile(filePath);
  const sheetLabel = sheetName || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetLabel];
  if (!sheet) {
    throw new Error(`Sheet not found: "${sheetLabel}". Available: ${wb.SheetNames.join(', ')}`);
  }
  return { sheet, sheetLabel };
}

/**
 * Find the 1-based Excel row that contains column headers (Barcode / Box ID) when the sheet has banner rows above the table.
 * @param {import('xlsx').WorkSheet} sheet
 * @param {number} [maxScan=50]
 * @returns {number|null} Header row index, or null if not found.
 */
function detectBarcodeHeaderExcelRow(sheet, maxScan = 50) {
  for (let hr = 1; hr <= maxScan; hr += 1) {
    const json = XLSX.utils.sheet_to_json(sheet, {
      defval: null,
      raw: false,
      range: hr - 1,
    });
    if (!json.length) continue;
    const keys = Object.keys(json[0]).map((k) => String(k).trim().toLowerCase());
    const set = new Set(keys);
    const hasBarcode =
      set.has('barcode') || set.has('yarn box barcode') || set.has('box barcode');
    const hasBoxId =
      set.has('box id') || set.has('boxid') || set.has('box_id') || set.has('yarn box id');
    if (hasBarcode || hasBoxId) {
      return hr;
    }
  }
  return null;
}

/**
 * Read yarn-box identifier rows from a sheet; normalizes column names.
 * @param {import('xlsx').WorkSheet} sheet
 * @param {number} headerExcelRow 1-based Excel row used as keys (Barcode, Box ID, …).
 * @returns {{ barcode: string, boxId: string, rowIndex: number }[]}
 */
function readRowsFromSheet(sheet, headerExcelRow) {
  const opts = { defval: null, raw: false, range: headerExcelRow - 1 };
  const json = XLSX.utils.sheet_to_json(sheet, opts);
  const firstDataExcelRowOneBased = headerExcelRow + 1;

  return json.map((row, idx) => {
    const norm = {};
    for (const [k, v] of Object.entries(row)) {
      norm[String(k).trim().toLowerCase()] = v == null ? '' : String(v).trim();
    }
    return {
      rowIndex: firstDataExcelRowOneBased + idx,
      barcode:
        norm['barcode'] ||
        norm['box barcode'] ||
        norm['yarn box barcode'] ||
        '',
      boxId:
        norm['box id'] ||
        norm['boxid'] ||
        norm['box_id'] ||
        norm['yarn box id'] ||
        '',
    };
  });
}

/**
 * Resolve a YarnBox doc by barcode (preferred) or boxId.
 * @param {{ barcode: string, boxId: string }} row
 * @returns {Promise<import('mongoose').Document|null>}
 */
async function findBox(row) {
  if (row.barcode) {
    const byBarcode = await YarnBox.findOne({ barcode: row.barcode });
    if (byBarcode) return byBarcode;
    const esc = row.barcode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ci = await YarnBox.findOne({ barcode: new RegExp(`^${esc}$`, 'i') });
    if (ci) return ci;
  }
  if (row.boxId) {
    const byId = await YarnBox.findOne({ boxId: row.boxId });
    if (byId) return byId;
  }
  return null;
}

/**
 * Apply zero-out + storage detach mutations on a box doc (in-memory).
 * @param {import('mongoose').Document} box
 * @returns {{ before: object, after: object }}
 */
function applyZeroOut(box) {
  const before = {
    boxWeight: Number(box.boxWeight ?? 0),
    grossWeight: Number(box.grossWeight ?? 0),
    numberOfCones: Number(box.numberOfCones ?? 0),
    storedStatus: Boolean(box.storedStatus),
    storageLocation: String(box.storageLocation ?? ''),
  };

  box.boxWeight = 0;
  box.grossWeight = 0;
  box.numberOfCones = 0;
  box.storedStatus = false;
  box.storageLocation = '';

  const after = {
    boxWeight: 0,
    grossWeight: 0,
    numberOfCones: 0,
    storedStatus: false,
    storageLocation: '',
  };
  return { before, after };
}

/**
 * Convert array of plain objects to CSV string.
 * @param {object[]} rows
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
      'Usage: node src/scripts/zero-out-yarn-boxes-from-excel.js --file=<path.xlsx> [--sheet=NAME] [--header-row=N] [--dry-run|--apply] [--report=PATH]'
    );
    process.exit(1);
  }

  const headerRowFromCli = parseOptionalHeaderExcelRow();
  logger.info(`Mode: ${APPLY ? 'APPLY (writes will happen)' : 'DRY RUN (no writes)'}`);

  const { sheet, sheetLabel } = loadWorksheet(FILE_PATH, SHEET_NAME);
  let headerExcelRow = headerRowFromCli;
  if (headerExcelRow == null) {
    headerExcelRow = detectBarcodeHeaderExcelRow(sheet);
    if (headerExcelRow == null) {
      throw new Error(
        'Could not detect header row: no column named Barcode or Box ID in the first 50 rows. Set --header-row=N to the Excel row that contains those headers.'
      );
    }
    logger.info(`Detected Excel header row: ${headerExcelRow}`);
  } else {
    logger.info(`Using Excel header row from --header-row: ${headerExcelRow}`);
  }

  const rows = readRowsFromSheet(sheet, headerExcelRow);
  logger.info(
    `Read ${rows.length} row(s) from ${path.basename(FILE_PATH)} [${sheetLabel}] headerRow=${headerExcelRow}`
  );

  if (rows.length === 0) {
    logger.warn('No rows found. Exiting.');
    process.exit(0);
  }

  await connectMongo();

  /** @type {object[]} */
  const report = [];
  let updated = 0;
  let skippedAlreadyZero = 0;
  let notFound = 0;

  for (const row of rows) {
    const lookupKey = row.barcode || row.boxId;
    if (!lookupKey) {
      report.push({
        rowIndex: row.rowIndex,
        barcode: '',
        boxId: '',
        status: 'skip_empty_row',
        message: 'No barcode or boxId on row',
      });
      continue;
    }

    const box = await findBox(row);
    if (!box) {
      notFound += 1;
      report.push({
        rowIndex: row.rowIndex,
        barcode: row.barcode,
        boxId: row.boxId,
        status: 'not_found',
        message: 'No YarnBox found for barcode/boxId',
      });
      continue;
    }

    const alreadyZero =
      Number(box.boxWeight ?? 0) === 0 &&
      Number(box.numberOfCones ?? 0) === 0 &&
      box.storedStatus !== true &&
      (!box.storageLocation || String(box.storageLocation).trim() === '');

    if (alreadyZero) {
      skippedAlreadyZero += 1;
      report.push({
        rowIndex: row.rowIndex,
        barcode: box.barcode,
        boxId: box.boxId,
        status: 'already_zeroed',
        boxWeightBefore: box.boxWeight ?? 0,
        storageBefore: box.storageLocation ?? '',
        storedStatusBefore: Boolean(box.storedStatus),
      });
      continue;
    }

    const { before } = applyZeroOut(box);

    if (APPLY) {
      try {
        // Use updateOne to bypass pre/post-save hooks that auto-create yarn_stocked
        // transactions or recompute initialBoxWeight (we explicitly want neither here).
        await YarnBox.updateOne(
          { _id: box._id },
          {
            $set: {
              boxWeight: 0,
              grossWeight: 0,
              numberOfCones: 0,
              storedStatus: false,
              storageLocation: '',
            },
          }
        );
        updated += 1;
        report.push({
          rowIndex: row.rowIndex,
          barcode: box.barcode,
          boxId: box.boxId,
          status: 'updated',
          boxWeightBefore: before.boxWeight,
          grossWeightBefore: before.grossWeight,
          numberOfConesBefore: before.numberOfCones,
          storageBefore: before.storageLocation,
          storedStatusBefore: before.storedStatus,
        });
      } catch (err) {
        report.push({
          rowIndex: row.rowIndex,
          barcode: box.barcode,
          boxId: box.boxId,
          status: 'error',
          message: err && err.message ? err.message : String(err),
        });
      }
    } else {
      report.push({
        rowIndex: row.rowIndex,
        barcode: box.barcode,
        boxId: box.boxId,
        status: 'would_update',
        boxWeightBefore: before.boxWeight,
        grossWeightBefore: before.grossWeight,
        numberOfConesBefore: before.numberOfCones,
        storageBefore: before.storageLocation,
        storedStatusBefore: before.storedStatus,
      });
    }
  }

  const totals = {
    totalRows: rows.length,
    matched: rows.length - notFound,
    notFound,
    alreadyZeroed: skippedAlreadyZero,
    [APPLY ? 'updated' : 'wouldUpdate']: APPLY ? updated : report.filter((r) => r.status === 'would_update').length,
  };

  // eslint-disable-next-line no-console
  console.log('\n=== Zero-out summary ===');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(totals, null, 2));

  const outPath = REPORT_PATH || `./zero-out-report-${Date.now()}.csv`;
  fs.writeFileSync(outPath, toCsv(report), 'utf8');
  logger.info(`Wrote per-row report: ${path.resolve(outPath)}`);

  if (DRY_RUN) {
    logger.warn('DRY RUN — no DB writes performed. Re-run with --apply to commit.');
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
