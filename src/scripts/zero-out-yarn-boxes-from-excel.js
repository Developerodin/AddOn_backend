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
 *   First sheet has columns "Barcode" and/or "Box ID" (case-insensitive).
 *   Either one is enough per row; we resolve a YarnBox using whichever is present.
 *
 * Usage:
 *   node src/scripts/zero-out-yarn-boxes-from-excel.js --file=./issues-in-boxes.xlsx --dry-run
 *   node src/scripts/zero-out-yarn-boxes-from-excel.js --file=./issues-in-boxes.xlsx --apply
 *   node src/scripts/zero-out-yarn-boxes-from-excel.js --file=./foo.xlsx --apply --sheet="BoxIds Need to be Zeroed"
 *   node src/scripts/zero-out-yarn-boxes-from-excel.js --file=./foo.xlsx --apply --report=./zero-out-report.csv
 *
 * Flags:
 *   --file=PATH        Path to the .xlsx file (required).
 *   --sheet=NAME       Sheet name (defaults to first sheet).
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
const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY || process.argv.includes('--dry-run');

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
 * Read rows from the workbook, normalizing column names.
 * @param {string} filePath
 * @param {string|null} sheetName
 * @returns {{ barcode: string, boxId: string, rowIndex: number }[]}
 */
function readRowsFromExcel(filePath, sheetName) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }
  const wb = XLSX.readFile(filePath);
  const sheet = sheetName ? wb.Sheets[sheetName] : wb.Sheets[wb.SheetNames[0]];
  if (!sheet) {
    throw new Error(`Sheet not found. Available: ${wb.SheetNames.join(', ')}`);
  }
  const json = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
  return json.map((row, idx) => {
    const norm = {};
    for (const [k, v] of Object.entries(row)) {
      norm[String(k).trim().toLowerCase()] = v == null ? '' : String(v).trim();
    }
    return {
      rowIndex: idx + 2, // +1 for header, +1 for 1-based
      barcode: norm['barcode'] || norm['box barcode'] || '',
      boxId: norm['box id'] || norm['boxid'] || norm['box_id'] || '',
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
      'Usage: node src/scripts/zero-out-yarn-boxes-from-excel.js --file=<path.xlsx> [--sheet=NAME] [--dry-run|--apply] [--report=PATH]'
    );
    process.exit(1);
  }

  logger.info(`Mode: ${APPLY ? 'APPLY (writes will happen)' : 'DRY RUN (no writes)'}`);

  const rows = readRowsFromExcel(FILE_PATH, SHEET_NAME);
  logger.info(`Read ${rows.length} row(s) from ${path.basename(FILE_PATH)}${SHEET_NAME ? ` [${SHEET_NAME}]` : ''}`);

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
