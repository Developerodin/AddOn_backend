#!/usr/bin/env node

/**
 * Export all YarnCone documents with issueStatus === 'issued' to CSV (default) or XLSX.
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/export-issued-cones.js
 *   NODE_ENV=development node src/scripts/export-issued-cones.js --output=./issued-cones.csv
 *   NODE_ENV=development node src/scripts/export-issued-cones.js --format=xlsx --output=./issued-cones.xlsx
 *   NODE_ENV=development node src/scripts/export-issued-cones.js --mongo-url="mongodb+srv://..."
 *
 * MongoDB URL resolution:
 * - --mongo-url=... (highest priority)
 * - config.mongoose.url (from `.env` via src/config/config.js; requires NODE_ENV)
 * - process.env.MONGODB_URL
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

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import xlsx from 'xlsx';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnCone } from '../models/index.js';

/** Same subset as `src/index.js` — required so mongodb+srv parses with the new URL parser. */
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
 * @param {string} name
 * @returns {string|null}
 */
function readArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (!arg) return null;
  const v = arg.slice(prefix.length).trim();
  return v || null;
}

/**
 * Resolve connection string: CLI wins, then app config (includes `-test` db suffix when NODE_ENV=test), then raw env.
 * @returns {{ url: string, source: string }}
 */
function resolveMongoConnectionString() {
  const cli = readArg('mongo-url');
  if (cli) {
    const v = sanitizeMongoUrl(cli);
    if (v) return { url: v, source: '--mongo-url' };
  }
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) return { url: cfg, source: 'config.mongoose.url (MONGODB_URL from .env)' };
  const envOnly = sanitizeMongoUrl(String(process.env.MONGODB_URL || ''));
  return { url: envOnly, source: 'process.env.MONGODB_URL' };
}

/**
 * Connect to MongoDB (aligned with app `index.js` options).
 * @returns {Promise<void>}
 */
async function connectMongo() {
  logger.info('Connecting to MongoDB...');
  const { url: mongoUrl, source } = resolveMongoConnectionString();
  if (!mongoUrl) {
    throw new Error('MongoDB URL is empty. Set MONGODB_URL in .env or pass --mongo-url=');
  }
  const redactedUrl = mongoUrl.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`MongoDB URL (${source}): ${redactedUrl}`);
  await mongoose.connect(mongoUrl, MONGO_CONNECT_OPTIONS);
}

/**
 * CSV cell encoding with RFC4180-ish quoting.
 * @param {unknown} value
 * @returns {string}
 */
function csvCell(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {Record<string, any>} obj
 * @param {string} dotPath
 * @returns {unknown}
 */
function get(obj, dotPath) {
  const parts = String(dotPath).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * @param {Date|string|number|null|undefined} d
 * @returns {string}
 */
function isoOrEmpty(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString();
}

/**
 * @typedef {{ key: string, header: string }} FieldSpec
 */

/** @type {FieldSpec[]} */
const DEFAULT_FIELDS = [
  { key: '_id', header: 'id' },
  { key: 'barcode', header: 'barcode' },
  { key: 'poNumber', header: 'poNumber' },
  { key: 'boxId', header: 'boxId' },
  { key: 'yarnName', header: 'yarnName' },
  { key: 'yarnCatalogId', header: 'yarnCatalogId' },
  { key: 'shadeCode', header: 'shadeCode' },
  { key: 'issueStatus', header: 'issueStatus' },
  { key: 'issueDate', header: 'issueDate' },
  { key: 'issueWeight', header: 'issueWeight' },
  { key: 'issuedBy.username', header: 'issuedByUsername' },
  { key: 'orderId', header: 'orderId' },
  { key: 'articleId', header: 'articleId' },
  { key: 'coneWeight', header: 'coneWeight' },
  { key: 'tearWeight', header: 'tearWeight' },
  { key: 'coneStorageId', header: 'coneStorageId' },
  { key: 'createdAt', header: 'createdAt' },
  { key: 'updatedAt', header: 'updatedAt' },
];

/**
 * @param {FieldSpec[]} fields
 * @param {Record<string, any>} cone
 * @returns {Record<string, string>}
 */
function toRow(fields, cone) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const f of fields) {
    let v = get(cone, f.key);
    if (f.key.endsWith('At') || f.key.endsWith('Date')) v = isoOrEmpty(v);
    out[f.header] = v == null ? '' : String(v);
  }
  return out;
}

/**
 * @param {string} filePath
 * @param {FieldSpec[]} fields
 * @returns {Promise<number>} number of exported rows
 */
async function exportCsv(filePath, fields) {
  const outDir = path.dirname(filePath);
  fs.mkdirSync(outDir, { recursive: true });

  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
  stream.write(`${fields.map((f) => csvCell(f.header)).join(',')}\n`);

  let count = 0;
  const cursor = YarnCone.find({ issueStatus: 'issued' })
    .sort({ issueDate: -1, createdAt: -1, _id: 1 })
    .lean()
    .cursor();

  for await (const cone of cursor) {
    const row = toRow(fields, cone);
    const line = fields.map((f) => csvCell(row[f.header])).join(',');
    stream.write(`${line}\n`);
    count += 1;
  }

  await new Promise((resolve, reject) => {
    stream.end(() => resolve());
    stream.on('error', reject);
  });

  return count;
}

/**
 * @param {string} filePath
 * @param {FieldSpec[]} fields
 * @returns {Promise<number>} number of exported rows
 */
async function exportXlsx(filePath, fields) {
  const outDir = path.dirname(filePath);
  fs.mkdirSync(outDir, { recursive: true });

  /** @type {Record<string, string>[]} */
  const rows = [];

  const cursor = YarnCone.find({ issueStatus: 'issued' })
    .sort({ issueDate: -1, createdAt: -1, _id: 1 })
    .lean()
    .cursor();

  let count = 0;
  for await (const cone of cursor) {
    rows.push(toRow(fields, cone));
    count += 1;
  }

  const worksheet = xlsx.utils.json_to_sheet(rows, { header: fields.map((f) => f.header) });
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'issued_cones');
  xlsx.writeFile(workbook, filePath);

  return count;
}

async function main() {
  const format = (readArg('format') || 'csv').toLowerCase();
  const output = readArg('output') || (format === 'xlsx' ? './issued-cones.xlsx' : './issued-cones.csv');

  if (format !== 'csv' && format !== 'xlsx') {
    // eslint-disable-next-line no-console
    console.error('Invalid --format. Use --format=csv or --format=xlsx');
    process.exit(1);
  }

  await connectMongo();

  logger.info(`Exporting issued cones to ${output} (${format})...`);
  const count = format === 'xlsx' ? await exportXlsx(output, DEFAULT_FIELDS) : await exportCsv(output, DEFAULT_FIELDS);
  logger.info(`Done. Exported ${count} cones.`);

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

