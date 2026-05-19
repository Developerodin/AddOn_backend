#!/usr/bin/env node

/**
 * Short-term yarn return: return issued cones (with yarn_returned txn) and relocate/reweight
 * not-issued cones using reports/short-term-yarn-return-cones-to-allocate.csv.
 *
 * Usage:
 *   node src/scripts/process-short-term-yarn-return-allocate.js --dry-run
 *   node src/scripts/process-short-term-yarn-return-allocate.js
 *   node src/scripts/process-short-term-yarn-return-allocate.js --csv=./reports/short-term-yarn-return-cones-to-allocate.csv
 *   node src/scripts/process-short-term-yarn-return-allocate.js --out=./reports/st-yarn-return-allocate-result.csv
 */

import url from 'url';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { processShortTermYarnReturnAllocate } from '../services/yarnManagement/shortTermYarnReturnAllocate.service.js';

const _origUrlParse = url.parse;
url.parse = function patchedParse(urlStr, ...args) {
  try {
    return _origUrlParse.call(this, urlStr, ...args);
  } catch {
    const firstHost = String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2');
    return _origUrlParse.call(this, firstHost, ...args);
  }
};

const MONGO_CONNECT_OPTIONS = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

const DEFAULT_CSV = path.resolve(process.cwd(), 'reports/short-term-yarn-return-cones-to-allocate.csv');
const DEFAULT_OUT = path.resolve(process.cwd(), 'reports/short-term-yarn-return-allocate-result.csv');
const DEFAULT_ERRORS_OUT = path.resolve(process.cwd(), 'reports/short-term-yarn-return-allocate-errors.csv');

const REPORT_HEADERS = [
  'cone_barcode',
  'order_no',
  'article_number',
  'csv_issue_status',
  'db_issue_status_before',
  'action',
  'status',
  'reason',
  'actual_weight',
  'location_to_allocate',
  'weight_before',
  'weight_after',
  'storage_before',
  'storage_after',
  'return_txn_id',
  'issue_txn_id',
  'order_id',
  'article_id',
];

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
  const cliArg = process.argv.find((a) => a.startsWith('--mongo-url='));
  if (cliArg) {
    const v = sanitizeMongoUrl(cliArg.slice('--mongo-url='.length));
    if (v) return { url: v, source: '--mongo-url' };
  }
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) return { url: cfg, source: 'config.mongoose.url' };
  const envOnly = sanitizeMongoUrl(String(process.env.MONGODB_URL || ''));
  return { url: envOnly, source: 'process.env.MONGODB_URL' };
}

/**
 * @returns {Promise<void>}
 */
async function connectMongo() {
  const { url: mongoUrl, source } = resolveMongoConnectionString();
  if (!mongoUrl) {
    throw new Error('MongoDB URL is empty. Set MONGODB_URL in .env or pass --mongo-url=');
  }
  const redacted = mongoUrl.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`MongoDB (${source}): ${redacted}`);
  await mongoose.connect(mongoUrl, MONGO_CONNECT_OPTIONS);
}

/**
 * @param {string} argPrefix
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
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {string}
 */
function toReportCsv(rows) {
  const lines = [REPORT_HEADERS.join(',')];
  for (const r of rows || []) {
    lines.push(REPORT_HEADERS.map((k) => csvEscape(r?.[k] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Parse header-based CSV (simple, no quoted commas in data expected).
 * @param {string} fileContent
 * @returns {import('../services/yarnManagement/shortTermYarnReturnAllocate.service.js').AllocateCsvRow[]}
 */
function parseAllocateCsv(fileContent) {
  const lines = String(fileContent || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim());
  const idx = (name) => headers.indexOf(name);

  const required = [
    'cone_barcode',
    'order_no',
    'article_number',
    'current_issue_status',
    'current_weight_db',
    'actual_weight',
    'location_to_allocate',
  ];
  for (const col of required) {
    if (idx(col) < 0) throw new Error(`CSV missing column: ${col}`);
  }

  /** @type {import('../services/yarnManagement/shortTermYarnReturnAllocate.service.js').AllocateCsvRow[]} */
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(',');
    if (parts.length < headers.length) continue;
    rows.push({
      cone_barcode: String(parts[idx('cone_barcode')] ?? '').trim(),
      order_no: String(parts[idx('order_no')] ?? '').trim(),
      article_number: String(parts[idx('article_number')] ?? '').trim(),
      current_issue_status: String(parts[idx('current_issue_status')] ?? '').trim(),
      current_weight_db: Number(parts[idx('current_weight_db')]),
      actual_weight: Number(parts[idx('actual_weight')]),
      location_to_allocate: String(parts[idx('location_to_allocate')] ?? '').trim(),
    });
  }
  return rows;
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const csvArg = parseSingleArg('--csv=');
  const outArg = parseSingleArg('--out=');
  const errorsOutArg = parseSingleArg('--errors-out=');
  const csvPath = csvArg ? path.resolve(process.cwd(), csvArg) : DEFAULT_CSV;
  const outPath = outArg ? path.resolve(process.cwd(), outArg) : DEFAULT_OUT;
  const errorsOutPath = errorsOutArg ? path.resolve(process.cwd(), errorsOutArg) : DEFAULT_ERRORS_OUT;

  logger.info(`Reading: ${csvPath}`);
  const raw = await fs.readFile(csvPath, 'utf-8');
  const rows = parseAllocateCsv(raw);
  if (rows.length === 0) {
    logger.warn('No data rows in CSV.');
    return;
  }
  logger.info(`Parsed ${rows.length} row(s). dryRun=${dryRun}`);

  await connectMongo();

  const { reportRows, summary } = await processShortTermYarnReturnAllocate({
    rows,
    returnDate: new Date(),
    returnByUsername: 'st-yarn-return-allocate',
    dryRun,
  });

  const csvText = toReportCsv(reportRows);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, csvText, 'utf-8');
  logger.info(`Wrote report: ${outPath}`);

  const problemRows = (reportRows || []).filter(
    (r) => r.status === 'error' || r.status === 'skipped'
  );
  const errorsCsv = toReportCsv(problemRows);
  await fs.writeFile(errorsOutPath, errorsCsv, 'utf-8');
  logger.info(
    `Wrote errors/skipped report (${problemRows.length} row(s)): ${errorsOutPath}`
  );

  logger.info(`Summary: ${JSON.stringify(summary, null, 2)}`);
  if (summary.error > 0) {
    logger.warn(
      `${summary.error} error(s) — see ${errorsOutPath}. Re-run after fix; already-success cones are idempotent (relocate only).`
    );
    process.exitCode = 1;
  }

  if (dryRun) {
    logger.info('Dry run — no database changes were made.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[process-short-term-yarn-return-allocate] failed:', err);
  process.exitCode = 1;
});
