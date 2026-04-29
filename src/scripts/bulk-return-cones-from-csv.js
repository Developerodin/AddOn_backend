#!/usr/bin/env node

/**
 * Bulk-return cones (empty) from a CSV list or from `issued-cones.xlsx` (barcode column).
 *
 * Source of truth for transaction context: latest `yarn_issued` YarnTransaction that contains the
 * coneId in `conesIdsArray` (parity with issue data).
 *
 * Safety rules:
 * - Cone not found by barcode: reported.
 * - Cone not issued: skipped.
 * - Cone already has `yarn_returned` txn: return txn creation skipped (idempotent).
 * - Missing issue txn for cone: skipped + reported (strict accounting).
 *
 * Usage:
 *   node src/scripts/bulk-return-cones-from-csv.js
 *   node src/scripts/bulk-return-cones-from-csv.js --csv="./Cone Out data - Sheet1.csv"
 *   node src/scripts/bulk-return-cones-from-csv.js --csv="./issued-cones.xlsx"
 *   node src/scripts/bulk-return-cones-from-csv.js --csv="./issued-cones.xlsx" --sheet="issued_cones" --column="barcode"
 *   node src/scripts/bulk-return-cones-from-csv.js --mongo-url="mongodb+srv://..."
 */

// Node 25+ made url.parse() throw on comma-separated hosts (mongodb multi-host URIs).
// The mongodb driver 3.x uses url.parse() as a pre-check before its own regex parser,
// so we patch it to return a best-effort result instead of throwing.
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

import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { bulkReturnConesFromBarcodes } from '../services/yarnManagement/yarnConeReturnBackfill.service.js';

/** Same subset as `src/index.js` — required so mongodb+srv parses with the new URL parser. */
const MONGO_CONNECT_OPTIONS = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

/**
 * Normalize Mongo URL (quotes, BOM, stray CR).
 * @param {string} rawUrl
 * @returns {string}
 */
function sanitizeMongoUrl(rawUrl) {
  let u = String(rawUrl || '').replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  if (u.endsWith('>')) {
    u = u.slice(0, -1);
  }
  return u;
}

/**
 * Resolve connection string: CLI wins, then app config, then env.
 * @returns {{ url: string, source: string }}
 */
function resolveMongoConnectionString() {
  const cliArg = process.argv.find((a) => a.startsWith('--mongo-url='));
  if (cliArg) {
    const v = sanitizeMongoUrl(cliArg.slice('--mongo-url='.length));
    if (v) return { url: v, source: '--mongo-url' };
  }
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) {
    return { url: cfg, source: 'config.mongoose.url (MONGODB_URL from .env)' };
  }
  const envOnly = sanitizeMongoUrl(String(process.env.MONGODB_URL || ''));
  return { url: envOnly, source: 'process.env.MONGODB_URL' };
}

/**
 * Connect to MongoDB (aligned with app `index.js` options).
 * @returns {Promise<void>}
 */
async function connectMongo() {
  logger.info('Connecting to MongoDB...');
  const { url: sanitizedUrl, source } = resolveMongoConnectionString();
  if (!sanitizedUrl) {
    throw new Error('MongoDB URL is empty. Set MONGODB_URL in .env or pass --mongo-url=');
  }
  const redactedUrl = sanitizedUrl.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`MongoDB URL (${source}): ${redactedUrl}`);
  await mongoose.connect(sanitizedUrl, MONGO_CONNECT_OPTIONS);
}

/**
 * @param {string} argPrefix e.g. '--csv='
 * @returns {string|null}
 */
function parseSingleArg(argPrefix) {
  const raw = process.argv.find((a) => a.startsWith(argPrefix));
  if (!raw) return null;
  const v = raw.slice(argPrefix.length).trim();
  return v || null;
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {string}
 */
function toCsv(rows) {
  const header = [
    'inputBarcode',
    'action',
    'reason',
    'coneId',
    'issueTxnId',
    'orderId',
    'orderno',
    'articleId',
    'articleNumber',
    'machineId',
    'yarnCatalogId',
    'yarnName',
    'returnTxnId',
    'returnTxnGroupKey',
    'moaYarnReturnStatusBefore',
    'moaYarnReturnStatusAfter',
  ];
  const lines = [header.join(',')];
  for (const r of rows || []) {
    lines.push(
      header
        .map((k) => csvEscape(r?.[k] ?? ''))
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}

/**
 * Normalize a sheet header for fuzzy matching.
 * @param {string} k
 * @returns {string}
 */
function normalizeHeaderKey(k) {
  return String(k ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * Pick the barcode column from XLSX headers (issued-cones export uses `barcode`).
 * @param {string[]} headers
 * @returns {string|null}
 */
function pickBarcodeColumnFromHeaders(headers) {
  const list = (headers || []).filter((h) => h != null && String(h).trim() !== '');
  if (list.length === 0) return null;
  const normalized = list.map((raw) => ({ raw, norm: normalizeHeaderKey(raw) }));
  const preferred = ['barcode', 'conebarcode', 'cone_barcode', 'barcodestr'];
  for (const p of preferred) {
    const hit = normalized.find((x) => x.norm === p);
    if (hit) return hit.raw;
  }
  const fuzzy = normalized.find((x) => x.norm.includes('barcode'));
  return fuzzy ? fuzzy.raw : list[0];
}

/**
 * Read cone barcodes from the first row-as-keys sheet of an .xlsx file.
 * @param {string} filePath Absolute or resolved path.
 * @param {string|null} sheetName Sheet name, or first sheet if null.
 * @param {string|null} columnName Force this header key (exact match from row keys).
 * @returns {string[]}
 */
function parseBarcodesFromXlsx(filePath, sheetName, columnName) {
  const wb = XLSX.readFile(filePath);
  let name = wb.SheetNames[0];
  if (sheetName) {
    if (wb.SheetNames.includes(sheetName)) {
      name = sheetName;
    } else {
      logger.warn(
        `Sheet "${sheetName}" not found; available: ${wb.SheetNames.join(', ')}. Using "${name}".`
      );
    }
  }
  if (!name) {
    throw new Error('Workbook has no sheets.');
  }
  const sheet = wb.Sheets[name];
  if (!sheet) {
    throw new Error(`Sheet not found: ${name}`);
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }
  const headers = Object.keys(rows[0]);
  const col =
    columnName && headers.includes(columnName)
      ? columnName
      : pickBarcodeColumnFromHeaders(headers);
  if (!col) {
    return [];
  }
  logger.info(`XLSX using sheet "${name}", column "${col}"`);
  /** @type {string[]} */
  const barcodes = [];
  for (const row of rows) {
    const v = String((row && row[col]) ?? '').trim();
    if (v && v.toLowerCase() !== 'barcode') {
      barcodes.push(v);
    }
  }
  return barcodes;
}

/**
 * Parse CSV that is just a list of barcodes (comma/newline-separated).
 * @param {string} fileContent
 * @returns {string[]}
 */
function parseBarcodeCsv(fileContent) {
  return String(fileContent || '')
    .replace(/^\uFEFF/, '')
    .split(/[\n,]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const csvArg = parseSingleArg('--csv=');
  const outArg = parseSingleArg('--out=');
  const sheetArg = parseSingleArg('--sheet=');
  const columnArg = parseSingleArg('--column=');
  const csvPath = csvArg
    ? path.resolve(process.cwd(), csvArg)
    : path.resolve(process.cwd(), 'Cone Out data - Sheet1.csv');
  const outPath = outArg
    ? path.resolve(process.cwd(), outArg)
    : path.resolve(process.cwd(), 'bulk-cone-return-report.csv');

  const isXlsx = csvPath.toLowerCase().endsWith('.xlsx');
  /** @type {string[]} */
  let barcodes;
  if (isXlsx) {
    logger.info(`Reading XLSX: ${csvPath}`);
    barcodes = parseBarcodesFromXlsx(csvPath, sheetArg, columnArg);
  } else {
    logger.info(`Reading CSV: ${csvPath}`);
    const raw = await fs.readFile(csvPath, 'utf-8');
    barcodes = parseBarcodeCsv(raw);
  }

  if (barcodes.length === 0) {
    logger.warn(`No barcodes found in ${isXlsx ? 'XLSX' : 'CSV'}. Exiting.`);
    return;
  }

  logger.info(`Parsed ${barcodes.length} barcode cell(s) (duplicates allowed; service normalizes).`);

  await connectMongo();

  const summary = await bulkReturnConesFromBarcodes({
    barcodes,
    returnDate: new Date(),
    returnByUsername: 'system',
    strictMissingIssueTxn: true,
  });

  // Write detailed per-barcode audit report for verification.
  try {
    const csvText = toCsv(summary.auditRows || []);
    await fs.writeFile(outPath, csvText, 'utf-8');
    logger.info(`Wrote audit CSV: ${outPath}`);
  } catch (e) {
    logger.error(`Failed to write audit CSV (${outPath}): ${e?.message || e}`);
  }

  logger.info('Backfill summary:');
  logger.info(JSON.stringify(summary, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  // Never leave empty catch blocks; print actionable error.
  // eslint-disable-next-line no-console
  console.error('[bulk-return-cones-from-csv] failed:', err);
  process.exitCode = 1;
});

