#!/usr/bin/env node

/**
 * Excel → Mongo audit for misplaced yarn box stickers / ERP vs storage mismatches.
 * See {@link ./report-yarn-box-excel-mismatch.lib.js} for parse + audit rules.
 *
 * Usage:
 *   node src/scripts/report-yarn-box-excel-mismatch.js --file="./7+2 Boxes Mis Match.xlsx"
 *   node src/scripts/report-yarn-box-excel-mismatch.js --output-csv=./reports/box-excel-audit.csv
 */

// Node 25+ url.parse() throws on comma-separated hosts; MongoDB driver 3.x calls url.parse().
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
import {
  auditOneSpreadsheetRow,
  parsePrimaryBarcodeTable,
  readArg,
  writeCsv,
} from './report-yarn-box-excel-mismatch.lib.js';

const MONGO_CONNECT_OPTIONS = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

/**
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
    return { url: cfg, source: 'config.mongoose.url' };
  }
  const envOnly = sanitizeMongoUrl(String(process.env.MONGODB_URL || ''));
  return { url: envOnly, source: 'process.env.MONGODB_URL' };
}

/**
 * @returns {Promise<void>}
 */
async function connectMongo() {
  const { url: sanitizedUrl, source } = resolveMongoConnectionString();
  if (!sanitizedUrl) {
    throw new Error('MongoDB URL is empty. Set MONGODB_URL in .env or pass --mongo-url=');
  }
  const redactedUrl = sanitizedUrl.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`MongoDB URL (${source}): ${redactedUrl}`);
  await mongoose.connect(sanitizedUrl, MONGO_CONNECT_OPTIONS);
}

async function main() {
  const fileRel = readArg('file', path.join(process.cwd(), '7+2 Boxes Mis Match.xlsx'));
  const filePath = path.isAbsolute(fileRel) ? fileRel : path.join(process.cwd(), fileRel);

  let sheetArg = readArg('sheet', '');
  const csvPath = readArg('output-csv', '');

  if (!fs.existsSync(filePath)) {
    logger.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const wb = XLSX.readFile(filePath);
  if (!sheetArg) sheetArg = wb.SheetNames[0];

  /** @type {unknown[][]} */
  const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetArg], { header: 1, raw: false, defval: '' });
  const parsed = parsePrimaryBarcodeTable(matrix);

  if (!parsed.sheetRows.length) {
    logger.error('Could not locate a barcode table (expected a row whose first header is Barcode).');
    process.exit(1);
  }

  await connectMongo();

  /** @type {Record<string, unknown>[]} */
  const results = [];
  let i = 0;
  for (const sr of parsed.sheetRows) {
    i += 1;
    results.push(await auditOneSpreadsheetRow(sr, i));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    filePath,
    sheet: sheetArg,
    rowCount: results.length,
    issueCounts: results.reduce((acc, r) => {
      String(r.issuesCsv || '')
        .split(';')
        .filter(Boolean)
        .forEach((k) => {
          acc[k] = (acc[k] || 0) + 1;
        });
      return acc;
    }, {}),
  };

  logger.info(JSON.stringify({ summary }, null, 2));
  logger.info(JSON.stringify({ rows: results }, null, 2));

  if (csvPath) {
    const headers = Object.keys(results[0] || {});
    /** @type {unknown[][]} */
    const csvMatrix = [headers, ...results.map((r) => headers.map((h) => r[h]))];
    writeCsv(csvMatrix, csvPath);
    logger.info(`CSV written to ${csvPath}`);
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
