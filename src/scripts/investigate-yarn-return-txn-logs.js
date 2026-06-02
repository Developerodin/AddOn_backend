#!/usr/bin/env node
/**
 * Production forensics for a bad yarn_returned transaction and its cone.
 * Queries MongoDB (transaction, cone, issue history, UserActivityLog) and optionally greps server log files.
 *
 * UserActivityLog retention is 30 days (TTL) — run before logs expire.
 *
 * Usage (on production server with prod .env / MONGODB_URL):
 *   NODE_ENV=production node src/scripts/investigate-yarn-return-txn-logs.js
 *   NODE_ENV=production node src/scripts/investigate-yarn-return-txn-logs.js --txn=69f8821c27350179fbb4b2e2
 *   NODE_ENV=production node src/scripts/investigate-yarn-return-txn-logs.js --cone=69e2059f514236271de91cb9
 *   NODE_ENV=production node src/scripts/investigate-yarn-return-txn-logs.js --log-dir=/home/ubuntu/.pm2/logs
 *   NODE_ENV=production node src/scripts/investigate-yarn-return-txn-logs.js --window-min=10
 */

import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import url from 'url';

const _origUrlParse = url.parse;
url.parse = function patchedParse(urlStr, ...args) {
  try {
    return _origUrlParse.call(this, urlStr, ...args);
  } catch {
    return _origUrlParse.call(this, String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2'), ...args);
  }
};

import mongoose from 'mongoose';
import config from '../config/config.js';
import { User, UserActivityLog, YarnTransaction, YarnCone } from '../models/index.js';
import { ProductionOrder, Article } from '../models/production/index.js';

const DEFAULT_TXN_ID = '69f8821c27350179fbb4b2e2';
const DEFAULT_CONE_ID = '69e2059f514236271de91cb9';

/**
 * @param {string} flag
 * @returns {string|undefined}
 */
function argValue(flag) {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

const txnIdArg = argValue('--txn') || DEFAULT_TXN_ID;
const coneIdArg = argValue('--cone');
const logDirArg = argValue('--log-dir');
const windowMin = Math.max(1, Number(argValue('--window-min') || 8) || 8);

/**
 * @param {unknown} v
 * @returns {string}
 */
function safeJson(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/**
 * @param {Record<string, unknown>|undefined} meta
 * @param {string[]} needles
 * @returns {boolean}
 */
function metaMatches(meta, needles) {
  if (!meta || typeof meta !== 'object') return false;
  const blob = JSON.stringify(meta).toLowerCase();
  return needles.some((n) => blob.includes(String(n).toLowerCase()));
}

/**
 * @param {import('mongoose').LeanDocument<any>} log
 * @param {string[]} needles
 * @returns {boolean}
 */
function activityLogMatches(log, needles) {
  const pathStr = String(log.path || '').toLowerCase();
  const hay = [
    pathStr,
    String(log.resourceId || ''),
    safeJson(log.requestMeta),
    String(log.errorMessage || ''),
  ]
    .join(' ')
    .toLowerCase();
  return needles.some((n) => hay.includes(String(n).toLowerCase()));
}

/**
 * Recursively list .log files under dir (max depth 3).
 * @param {string} dir
 * @param {number} depth
 * @returns {string[]}
 */
function listLogFiles(dir, depth = 0) {
  if (depth > 3) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...listLogFiles(full, depth + 1));
    } else if (/\.log$/i.test(ent.name) || ent.name.includes('out') || ent.name.includes('error')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Grep log files for needles; prints matching lines with file context.
 * @param {string[]} files
 * @param {string[]} needles
 * @param {Date} after
 * @param {Date} before
 */
async function grepLogFiles(files, needles, after, before) {
  console.log('\n=== SERVER LOG FILES ===');
  if (!files.length) {
    console.log('No log files found under --log-dir');
    return;
  }
  console.log(`Scanning ${files.length} file(s)...`);
  let matchCount = 0;

  for (const file of files) {
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    let lineNo = 0;
    for await (const line of rl) {
      lineNo += 1;
      const lower = line.toLowerCase();
      if (!needles.some((n) => lower.includes(String(n).toLowerCase()))) continue;

      // Optional coarse date filter if line contains ISO date
      const iso = line.match(/20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}/);
      if (iso) {
        const t = new Date(iso[0]);
        if (t < after || t > before) continue;
      }

      matchCount += 1;
      console.log(`\n--- ${file}:${lineNo} ---`);
      console.log(line.slice(0, 2000));
      if (matchCount >= 80) {
        console.log('\n(stopped after 80 matches — narrow --window-min or log-dir)');
        return;
      }
    }
  }
  console.log(`\nTotal log line matches: ${matchCount}`);
}

await mongoose.connect(config.mongoose.url, config.mongoose.options);

const txn = await YarnTransaction.findById(txnIdArg).lean();
if (!txn) {
  console.error(`YarnTransaction not found: ${txnIdArg}`);
  process.exit(1);
}

const coneIds = (txn.conesIdsArray || []).map((id) => String(id));
const primaryConeId = coneIdArg || coneIds[0] || '';

console.log('=== TARGET ===');
console.log(
  safeJson({
    txnId: String(txn._id),
    type: txn.transactionType,
    netKg: txn.transactionNetWeight,
    cones: txn.transactionConeCount,
    orderno: txn.orderno,
    articleNumber: txn.articleNumber,
    yarnName: txn.yarnName,
    transactionDate: txn.transactionDate,
    createdAt: txn.createdAt,
    coneIds,
  })
);

const center = txn.createdAt ? new Date(txn.createdAt) : new Date(txn.transactionDate);
const windowStart = new Date(center.getTime() - windowMin * 60 * 1000);
const windowEnd = new Date(center.getTime() + windowMin * 60 * 1000);

console.log(`\nActivity log window: ${windowStart.toISOString()} → ${windowEnd.toISOString()} (±${windowMin} min)`);
console.log('UserActivityLog TTL is 30 days — older rows are auto-deleted.');

const cones = primaryConeId
  ? await YarnCone.find({ _id: { $in: [primaryConeId, ...coneIds] } })
      .select(
        'barcode coneWeight tearWeight issueWeight returnWeight issueStatus returnStatus orderId articleId boxId poNumber yarnName coneStorageId issueDate returnDate createdAt updatedAt'
      )
      .lean()
  : [];

console.log('\n=== CONE(S) ===');
for (const c of cones) {
  console.log(safeJson(c));
}

const barcodes = cones.map((c) => c.barcode).filter(Boolean);
const needles = [
  String(txn._id),
  primaryConeId,
  ...coneIds,
  ...barcodes,
  txn.orderno,
  txn.articleNumber,
  String(txn.transactionNetWeight),
  'yarn-transactions',
  'yarn-cones',
  'yarn_returned',
].filter(Boolean);

if (txn.orderId) {
  const po = await ProductionOrder.findById(txn.orderId).select('orderNumber status').lean();
  console.log('\n=== ORDER ===');
  console.log(safeJson(po));
}
if (txn.articleId) {
  const art = await Article.findById(txn.articleId).select('articleNumber').lean();
  console.log('\n=== ARTICLE ===');
  console.log(safeJson(art));
}

const issueForCone = primaryConeId
  ? await YarnTransaction.find({
      transactionType: { $in: ['yarn_issued', 'yarn_issued_linking', 'yarn_issued_sampling'] },
      conesIdsArray: new mongoose.Types.ObjectId(primaryConeId),
    })
      .select('_id transactionNetWeight orderno articleNumber transactionDate createdAt')
      .sort({ createdAt: 1 })
      .lean()
  : [];

console.log('\n=== ISSUE TXNS FOR CONE ===');
issueForCone.forEach((t) => {
  console.log(
    `${t.createdAt?.toISOString?.()} | ${t._id} | ${t.transactionNetWeight} kg | ${t.orderno} | ${t.articleNumber}`
  );
});

const activityCandidates = await UserActivityLog.find({
  createdAt: { $gte: windowStart, $lte: windowEnd },
  method: { $in: ['POST', 'PATCH', 'PUT'] },
  $or: [
    { path: { $regex: /yarn-transactions/i } },
    { path: { $regex: /yarn-cones/i } },
    { path: { $regex: /yarn-return/i } },
  ],
})
  .sort({ createdAt: 1 })
  .lean();

const activityHits = activityCandidates.filter((log) => activityLogMatches(log, needles));

const activityBroad = activityCandidates.filter(
  (log) =>
    metaMatches(log.requestMeta, [txn.orderno, txn.articleNumber, 'yarn_returned', '111069']) ||
    String(log.path || '').includes('yarn-transactions')
);

const activityById = new Map();
for (const log of [...activityHits, ...activityBroad]) {
  activityById.set(String(log._id), log);
}
const activityToShow = [...activityById.values()].sort(
  (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
);

console.log('\n=== USER ACTIVITY LOGS (authenticated API, ±window) ===');
console.log(`Candidates in window: ${activityCandidates.length} | Strong/body matches: ${activityToShow.length}`);

const userIds = [...new Set(activityToShow.map((l) => String(l.userId)).filter(Boolean))];
const users = await User.find({ _id: { $in: userIds } })
  .select('name email role')
  .lean();
const userById = new Map(users.map((u) => [String(u._id), u]));

for (const log of activityToShow) {
  const u = userById.get(String(log.userId));
  console.log('\n---');
  console.log(
    safeJson({
      at: log.createdAt,
      user: u ? { id: String(u._id), name: u.name, email: u.email, role: u.role } : { id: String(log.userId) },
      method: log.method,
      path: log.path,
      statusCode: log.statusCode,
      action: log.action,
      resource: log.resource,
      resourceId: log.resourceId,
      durationMs: log.durationMs,
      ip: log.ip,
      userAgent: log.userAgent,
      requestMeta: log.requestMeta,
      errorMessage: log.errorMessage,
    })
  );
}

if (!activityToShow.length) {
  console.log('\nNo matching UserActivityLog rows. Try widening --window-min=30 or check TTL (30d).');
  console.log('Also pass --log-dir=/path/to/pm2/logs to grep stdout files.');
}

if (logDirArg) {
  const files = listLogFiles(path.resolve(logDirArg));
  await grepLogFiles(files, needles, windowStart, windowEnd);
}

await mongoose.disconnect();
