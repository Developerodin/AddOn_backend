#!/usr/bin/env node
/**
 * Builds a CSV snapshot for every YarnCone whose `barcode` appears in a line list file.
 *
 * Defaults (run from `AddOn_backend`):
 *   Input:  `reports/cones-data.md`  (any line that is exactly 24 hex chars counts as a barcode)
 *   Output: `reports/cones-data.csv`
 *
 * Usage:
 *   node src/scripts/report-cones-barcodes-csv.js
 *   node src/scripts/report-cones-barcodes-csv.js --in=./reports/cones-data.md --out=./reports/out.csv
 *   node src/scripts/report-cones-barcodes-csv.js --dry-run   # print CSV to stdout only
 */

import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.resolve(BACKEND_ROOT, '.env') });

/** @type {readonly string[]} */
const CSV_HEADERS = [
  'snapshotAt',
  'barcode',
  'found',
  'coneObjectId',
  'netWeight',
  'coneWeight',
  'tearWeight',
  'coneStorageId',
  'storageZone',
  'storageSection',
  'storageShelf',
  'storageFloor',
  'storageLabel',
  'issueStatus',
  'returnStatus',
  'orderId',
  'orderno',
  'articleId',
  'articleNumber',
  'boxId',
  'poNumber',
  'yarnName',
  'shadeCode',
  'yarnCatalogId',
  'issueDate',
  'issueWeight',
  'returnWeight',
  'returnedToVendorAt',
  'createdAt',
  'updatedAt',
];

/**
 * @returns {string}
 */
function sanitizeMongoUrl() {
  let u = String(process.env.MONGODB_URL || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  if (u.endsWith('>')) u = u.slice(0, -1);
  return u;
}

/**
 * @param {string} v
 * @returns {string | null}
 */
function parseArgPrefix(prefix) {
  const raw = process.argv.find((a) => a.startsWith(prefix));
  if (!raw) return null;
  return raw.slice(prefix.length).trim() || null;
}

/**
 * @param {string[]} lines
 * @returns {string[]}
 */
function dedupePreserveOrder(lines) {
  const seen = new Set();
  const out = [];
  for (const x of lines) {
    const k = String(x).trim().toLowerCase();
    if (!/^[a-f0-9]{24}$/.test(k)) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
async function readBarcodesFromFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  return dedupePreserveOrder(lines);
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
 * @param {string} mongoUrl
 * @param {string[]} barcodes
 * @returns {object[]}
 */
function fetchRowsFromMongo(mongoUrl, barcodes) {
  const barcodesJson = JSON.stringify(barcodes);
  const script = `
const barcodes = ${barcodesJson};
const cones = db.yarncones.find({ barcode: { $in: barcodes } }).toArray();
const byBarcode = Object.fromEntries(cones.map((c) => [c.barcode, c]));
const storageIds = [
  ...new Set(
    cones
      .map((c) => c.coneStorageId)
      .filter((x) => x != null && String(x).trim() !== '')
      .map((x) => String(x).trim())
  ),
];
const slots = storageIds.length
  ? db.storageslots
      .find({
        $or: [{ barcode: { $in: storageIds } }, { label: { $in: storageIds } }],
      })
      .toArray()
  : [];
const slotMap = {};
for (const s of slots) {
  slotMap[s.barcode] = s;
  slotMap[s.label] = s;
}
const orderOidSet = new Set();
const articleOidSet = new Set();
for (const c of cones) {
  if (c.orderId) orderOidSet.add(c.orderId);
  if (c.articleId) articleOidSet.add(c.articleId);
}
const orderOids = [...orderOidSet];
const articleOids = [...articleOidSet];
const orderMap = {};
if (orderOids.length) {
  for (const o of db.production_orders
    .find({ _id: { $in: orderOids } }, { orderNumber: 1 })
    .toArray()) {
    orderMap[o._id.toString()] = o.orderNumber || '';
  }
}
const articleMap = {};
if (articleOids.length) {
  for (const a of db.articles
    .find({ _id: { $in: articleOids } }, { articleNumber: 1 })
    .toArray()) {
    articleMap[a._id.toString()] = a.articleNumber || '';
  }
}
function iso(d) {
  return d ? d.toISOString() : '';
}
const rows = barcodes.map((b) => {
  const c = byBarcode[b];
  if (!c) {
    return { barcode: b, found: false };
  }
  const sid = c.coneStorageId != null ? String(c.coneStorageId).trim() : '';
  const sl = sid ? slotMap[sid] : null;
  const cw = c.coneWeight != null ? Number(c.coneWeight) : null;
  const tw = c.tearWeight != null ? Number(c.tearWeight) : null;
  const net = cw != null && tw != null ? cw - tw : cw != null ? cw : null;
  return {
    barcode: b,
    found: true,
    coneObjectId: c._id.toString(),
    coneWeight: cw,
    tearWeight: tw,
    netWeight: net,
    coneStorageId: sid,
    storageZone: sl ? sl.zoneCode : '',
    storageSection: sl ? sl.sectionCode || '' : '',
    storageShelf: sl ? sl.shelfNumber : '',
    storageFloor: sl ? sl.floorNumber : '',
    storageLabel: sl ? sl.label || '' : '',
    issueStatus: c.issueStatus || '',
    returnStatus: c.returnStatus || '',
    orderId: c.orderId ? c.orderId.toString() : '',
    articleId: c.articleId ? c.articleId.toString() : '',
    boxId: c.boxId || '',
    poNumber: c.poNumber || '',
    yarnName: c.yarnName || '',
    shadeCode: c.shadeCode || '',
    yarnCatalogId: c.yarnCatalogId ? c.yarnCatalogId.toString() : '',
    issueDate: iso(c.issueDate),
    issueWeight: c.issueWeight != null ? Number(c.issueWeight) : null,
    returnWeight: c.returnWeight != null ? Number(c.returnWeight) : null,
    returnedToVendorAt: iso(c.returnedToVendorAt),
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  };
});
for (const r of rows) {
  if (!r.found) continue;
  r.orderno = r.orderId ? orderMap[r.orderId] || '' : '';
  r.articleNumber = r.articleId ? articleMap[r.articleId] || '' : '';
}
print(JSON.stringify(rows));
`;

  const r = spawnSync('mongosh', [mongoUrl, '--quiet', '--eval', script], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(r.stderr || `mongosh exited ${r.status}`);
  }
  const trimmed = r.stdout.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed);
}

/**
 * @param {object[]} rows
 * @param {string} snapshotAtIso
 * @returns {string}
 */
function buildCsv(rows, snapshotAtIso) {
  const lines = [CSV_HEADERS.join(',')];
  for (const r of rows) {
    if (!r.found) {
      const blank = CSV_HEADERS.map((h) => {
        if (h === 'snapshotAt') return csvEscape(snapshotAtIso);
        if (h === 'barcode') return csvEscape(r.barcode);
        if (h === 'found') return 'false';
        return '';
      });
      lines.push(blank.join(','));
      continue;
    }
    const vals = CSV_HEADERS.map((h) => {
      if (h === 'snapshotAt') return csvEscape(snapshotAtIso);
      if (h === 'found') return 'true';
      if (h === 'netWeight') {
        return r.netWeight != null ? csvEscape(Number(r.netWeight).toFixed(6)) : '';
      }
      if (h === 'coneWeight' || h === 'tearWeight' || h === 'issueWeight' || h === 'returnWeight') {
        const x = r[h];
        return x != null && x !== '' ? csvEscape(x) : '';
      }
      return csvEscape(r[h]);
    });
    lines.push(vals.join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const inPath =
    parseArgPrefix('--in=') || path.join(BACKEND_ROOT, 'reports', 'cones-data.md');
  const outPath =
    parseArgPrefix('--out=') || path.join(BACKEND_ROOT, 'reports', 'cones-data.csv');

  const mongoUrl = sanitizeMongoUrl();
  if (!mongoUrl) {
    console.error('MONGODB_URL missing in .env');
    process.exit(1);
  }

  const barcodes = await readBarcodesFromFile(inPath);
  if (barcodes.length === 0) {
    console.error('No barcode lines found in', inPath);
    process.exit(1);
  }

  const rows = fetchRowsFromMongo(mongoUrl, barcodes);
  const generatedAt = new Date().toISOString();
  const csv = buildCsv(rows, generatedAt);

  const foundCount = rows.filter((r) => r.found).length;
  const missingCount = rows.length - foundCount;

  if (dryRun) {
    process.stdout.write(csv);
    console.error(`rows=${rows.length} found=${foundCount} missing_barcode=${missingCount}`);
    return;
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, csv, 'utf8');
  console.log(
    `Wrote ${outPath} (${rows.length} rows, ${foundCount} matched cones, ${missingCount} not in DB)`
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
