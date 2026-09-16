#!/usr/bin/env node

/**
 * Empty-return **issued** cones (0 kg yarn_returned for THIS issue) and mark leftover
 * **not_issued** cones used (the 23 — they already have yarn_returned).
 *
 * Default: DRY RUN (no writes).
 *
 * Issued cones → empty return + 0 kg yarn_returned for the latest issue order/article.
 * not_issued leftover cones (the 23) → mark used only (they already have yarn_returned).
 * Already used/empty → skip.
 *
 * Local:
 *   NODE_ENV=development node src/scripts/empty-return-excel-cones.js \
 *     --file="./data-correction-needed/empty return cone details with order no to remove (1).xlsx" \
 *     --mongo-url="mongodb://127.0.0.1:27017/addon" --dry-run
 *   NODE_ENV=development node src/scripts/empty-return-excel-cones.js --file="..." --mongo-url="mongodb://127.0.0.1:27017/addon" --limit=20 --apply
 *
 * Production (.env MONGODB_URL):
 *   NODE_ENV=development node src/scripts/empty-return-excel-cones.js --file="..." --dry-run
 *   NODE_ENV=development node src/scripts/empty-return-excel-cones.js --file="..." --apply
 */

import './lib/mongoUrlParsePatch.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import {
  applyEmptyReturns,
  countByAction,
  loadConesByBarcode,
  loadIssueAndReturnTxns,
  readExcelConeRows,
} from './lib/emptyReturnExcelCones.lib.js';
import { classifyExcelRows } from './lib/emptyReturnExcelClassify.lib.js';
import { applyMarkUsedLeftovers } from './lib/emptyReturnExcelMarkUsed.lib.js';

const MONGO_CONNECT_OPTIONS = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000,
};

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
 * @param {object[]} rows
 * @returns {string}
 */
function toCsv(rows) {
  const headers = [
    'rowIndex',
    'barcode',
    'excelOrder',
    'coneId',
    'issueStatus',
    'latestIssueOrder',
    'latestIssueArticleId',
    'issueTxnId',
    'action',
    'reason',
    'needsConeClose',
    'needsReturnTxn',
    'returnTxnId',
  ];
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

async function main() {
  const APPLY = process.argv.includes('--apply');
  const FILE_PATH =
    getArg('--file=') ||
    './data-correction-needed/empty return cone details with order no to remove (1).xlsx';
  const SHEET = getArg('--sheet=');
  const REPORT = getArg('--report=');
  const LIMIT_RAW = getArg('--limit=');
  const limit = LIMIT_RAW != null && LIMIT_RAW !== '' ? Number(LIMIT_RAW) : null;
  if (LIMIT_RAW && (!Number.isFinite(limit) || limit < 1)) {
    throw new Error(`Invalid --limit=${LIMIT_RAW}`);
  }

  const absFile = path.resolve(process.cwd(), FILE_PATH);
  if (!fs.existsSync(absFile)) throw new Error(`Excel not found: ${absFile}`);

  logger.info(`Mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  if (limit) logger.info(`Limit: first ${limit} cones that need close`);

  const excelRows = readExcelConeRows(absFile, SHEET);
  logger.info(`Excel rows: ${excelRows.length} from ${path.basename(absFile)}`);

  const { url, source } = resolveMongoConnectionString();
  if (!url) throw new Error('MongoDB URL empty. Set MONGODB_URL or pass --mongo-url=');
  const redacted = url.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`Mongo (${source}): ${redacted}`);
  await mongoose.connect(url, MONGO_CONNECT_OPTIONS);

  const uniqueBarcodes = [...new Set(excelRows.map((r) => r.barcode).filter(Boolean))];
  const coneByBarcode = await loadConesByBarcode(uniqueBarcodes);
  const issuedIds = [...coneByBarcode.values()].filter((c) => c.issueStatus === 'issued').map((c) => c._id);
  logger.info(`Loaded cones ${coneByBarcode.size}; currently issued ${issuedIds.length}`);
  const txns = await loadIssueAndReturnTxns(issuedIds);
  let classified = classifyExcelRows(excelRows, coneByBarcode, txns);

  const result = await applyEmptyReturns(classified, {
    apply: APPLY,
    returnByUsername: getArg('--return-by=') || 'system',
    limit,
  });
  const markUsed = await applyMarkUsedLeftovers(result.rows, { apply: APPLY });

  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    mongoSource: source,
    excelRows: excelRows.length,
    uniqueBarcodes: uniqueBarcodes.length,
    currentlyIssued: issuedIds.length,
    actions: countByAction(result.rows),
    closed: result.closed,
    returnTxnsCreated: result.txnsCreated,
    moaYarnReturnCompleted: result.moaCompleted,
    markedUsedLeftover: markUsed.marked,
    errors: result.errors + markUsed.errors,
    wouldClose: result.rows.filter((r) => r.needsConeClose).length,
    wouldCreateReturnTxn: result.rows.filter((r) => r.needsReturnTxn).length,
    wouldMarkUsed: result.rows.filter((r) => r.needsMarkUsed).length,
  };
  // eslint-disable-next-line no-console
  console.log('\n=== Empty-return Excel cones ===\n');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));

  const outPath = REPORT || `./data-correction-needed/empty-return-excel-${APPLY ? 'apply' : 'dry-run'}-${Date.now()}.csv`;
  fs.writeFileSync(path.resolve(process.cwd(), outPath), toCsv(result.rows), 'utf8');
  logger.info(`Wrote ${path.resolve(process.cwd(), outPath)}`);
  if (!APPLY) logger.warn('DRY RUN — re-run with --apply to write.');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.error(err);
  try {
    await mongoose.disconnect();
  } catch (disconnectErr) {
    logger.error(disconnectErr);
  }
  process.exit(1);
});
