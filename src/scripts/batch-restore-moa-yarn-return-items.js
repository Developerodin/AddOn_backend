#!/usr/bin/env node

/**
 * Batch restore machine-order-assignment rows so articles reappear on the Yarn Return screen
 * after erroneous MOA yarn-return completion (cones still issued, row removed from queue).
 *
 * Does NOT return cones — only re-adds MOA queue rows with yarnReturnStatus = In Progress.
 *
 * Usage (preview — default, no DB writes):
 *   cd AddOn_backend
 *   NODE_ENV=production node src/scripts/batch-restore-moa-yarn-return-items.js
 *
 * Apply on production (pass prod Mongo URL — never commit credentials):
 *   NODE_ENV=production node src/scripts/batch-restore-moa-yarn-return-items.js \
 *     --mongo-url="mongodb+srv://USER:PASS@cluster.../addon?retryWrites=true&w=majority" \
 *     --write
 *
 * Optional custom list (CSV columns: article,order,machine — order/machine may be numeric):
 *   node src/scripts/batch-restore-moa-yarn-return-items.js --csv=./articles-to-restore.csv --write
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

import fs from 'fs/promises';
import mongoose from 'mongoose';
import config from '../config/config.js';
import Machine from '../models/machine.model.js';
import ProductionOrder from '../models/production/productionOrder.model.js';
import Article from '../models/production/article.model.js';
import MachineOrderAssignment from '../models/production/machineOrderAssignment.model.js';
import YarnCone from '../models/yarnReq/yarnCone.model.js';
import { OrderStatus, YarnIssueStatus, YarnReturnStatus } from '../models/production/enums.js';
import { updateMachineOrderAssignmentById } from '../services/production/machineOrderAssignment.service.js';

const MONGO_CONNECT_OPTIONS = { useNewUrlParser: true, useUnifiedTopology: true };

/** Default rows from yarn-return remediation list (article, order no, machine no). */
const DEFAULT_TARGET_ROWS = [
  { article: 'A581', order: 38, machine: 51 },
  { article: 'A5429', order: 43, machine: 7 },
  { article: 'A102', order: 31, machine: 6 },
  { article: 'A6330', order: 31, machine: 3 },
  { article: 'A6325', order: 31, machine: 1 },
  { article: 'A132', order: 42, machine: 25 },
  { article: 'A3172', order: 27, machine: 22 },
  { article: 'A3419', order: 50, machine: 41 },
  { article: 'A6486', order: 51, machine: 5 },
];

/**
 * @param {string} name
 * @returns {string|null}
 */
function readArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : null;
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
 * Resolve Mongo connection string: CLI wins, then app config.
 * @returns {{ url: string, source: string }}
 */
function resolveMongoConnectionString() {
  const cli = readArg('mongo-url');
  if (cli) {
    const v = sanitizeMongoUrl(cli);
    if (v) return { url: v, source: '--mongo-url' };
  }
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || process.env.MONGODB_URL || ''));
  if (cfg) return { url: cfg, source: 'MONGODB_URL / config.mongoose.url' };
  throw new Error('MongoDB URL missing. Set MONGODB_URL or pass --mongo-url=');
}

/**
 * @param {number|string} orderNo
 * @returns {string}
 */
function formatOrderNumber(orderNo) {
  const n = String(orderNo).trim();
  const raw = /^ORD-/i.test(n) ? n.replace(/^ORD-/i, '') : n;
  const num = parseInt(raw, 10);
  if (Number.isNaN(num)) return n.toUpperCase();
  return `ORD-${String(num).padStart(6, '0')}`;
}

/**
 * @param {number|string} machineNo
 * @returns {string}
 */
function formatMachineCode(machineNo) {
  const n = String(machineNo).trim();
  if (/^K\d+$/i.test(n)) return n.toUpperCase();
  const num = parseInt(n, 10);
  if (Number.isNaN(num)) return n;
  return `K${String(num).padStart(3, '0')}`;
}

/**
 * @param {string} csvPath
 * @returns {Promise<Array<{ article: string, order: string|number, machine: string|number }>>}
 */
async function loadRowsFromCsv(csvPath) {
  const raw = await fs.readFile(csvPath, 'utf8');
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error(`CSV ${csvPath} must have a header and at least one row`);

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const ai = header.indexOf('article');
  const oi = header.findIndex((h) => h === 'order' || h === 'order_no' || h === 'orderno');
  const mi = header.findIndex((h) => h === 'machine' || h === 'machine_no' || h === 'machinecode');
  if (ai < 0 || oi < 0 || mi < 0) {
    throw new Error('CSV must include columns: article, order (or order_no), machine (or machine_no)');
  }

  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim());
    return {
      article: cols[ai],
      order: cols[oi],
      machine: cols[mi],
    };
  });
}

/**
 * @param {string} orderNumber
 * @param {string} articleNumber
 * @param {import('mongoose').Types.ObjectId} orderId
 * @param {import('mongoose').Types.ObjectId} articleId
 * @returns {Promise<{ issuedCones: number, onMoa: boolean, yarnReturnStatus: string|null, willShowOnYarnReturn: boolean }>}
 */
async function diagnoseRow(orderNumber, articleNumber, orderId, articleId) {
  const issuedCones = await YarnCone.countDocuments({
    orderId,
    articleId,
    issueStatus: 'issued',
  });

  const moa = await MachineOrderAssignment.findOne({
    productionOrderItems: {
      $elemMatch: { productionOrder: orderId, article: articleId },
    },
  }).lean();

  const item = moa?.productionOrderItems?.find(
    (i) => String(i.productionOrder) === String(orderId) && String(i.article) === String(articleId)
  );

  const yarnReturnStatus = item?.yarnReturnStatus ? String(item.yarnReturnStatus) : null;
  const willShowOnYarnReturn =
    !!item &&
    String(item.status) === OrderStatus.COMPLETED &&
    String(item.yarnIssueStatus) === YarnIssueStatus.COMPLETED &&
    yarnReturnStatus !== YarnReturnStatus.COMPLETED;

  return {
    issuedCones,
    onMoa: !!item,
    yarnReturnStatus,
    willShowOnYarnReturn,
  };
}

/**
 * Re-add one order/article to a machine MOA queue for pending yarn return.
 * @param {{ article: string, orderNumber: string, machineCode: string, dryRun: boolean }} params
 * @returns {Promise<Record<string, unknown>>}
 */
async function restoreOneRow({ articleNumber, orderNumber, machineCode, dryRun }) {
  const order = await ProductionOrder.findOne({ orderNumber }).lean();
  if (!order) {
    return { ok: false, action: 'error', articleNumber, orderNumber, machineCode, error: 'ORDER_NOT_FOUND' };
  }

  const article = await Article.findOne({ orderId: order._id, articleNumber }).lean();
  if (!article) {
    return {
      ok: false,
      action: 'error',
      articleNumber,
      orderNumber,
      machineCode,
      error: 'ARTICLE_NOT_FOUND',
    };
  }

  const machine = await Machine.findOne({
    $or: [{ machineCode }, { name: machineCode }],
  }).lean();
  if (!machine) {
    return { ok: false, action: 'error', articleNumber, orderNumber, machineCode, error: 'MACHINE_NOT_FOUND' };
  }

  const diag = await diagnoseRow(orderNumber, articleNumber, order._id, article._id);

  if (diag.willShowOnYarnReturn) {
    return {
      ok: true,
      action: 'skipped_already_visible',
      articleNumber,
      orderNumber,
      machineCode,
      ...diag,
    };
  }

  if (diag.issuedCones === 0) {
    return {
      ok: true,
      action: 'skipped_no_issued_cones',
      articleNumber,
      orderNumber,
      machineCode,
      ...diag,
    };
  }

  if (diag.onMoa && diag.yarnReturnStatus === YarnReturnStatus.COMPLETED) {
    return {
      ok: false,
      action: 'needs_manual_fix',
      articleNumber,
      orderNumber,
      machineCode,
      ...diag,
      error: 'ON_MOA_BUT_YARN_RETURN_COMPLETED — patch yarnReturnStatus to In Progress manually',
    };
  }

  if (dryRun) {
    return {
      ok: true,
      action: 'would_restore',
      articleNumber,
      orderNumber,
      machineCode,
      ...diag,
    };
  }

  const assignment = await MachineOrderAssignment.findOne({ machine: machine._id });
  if (!assignment) {
    return {
      ok: false,
      action: 'error',
      articleNumber,
      orderNumber,
      machineCode,
      error: 'NO_ASSIGNMENT_FOR_MACHINE',
    };
  }

  const updated = await updateMachineOrderAssignmentById(
    assignment._id,
    {
      addProductionOrderItems: [
        {
          productionOrder: order._id,
          article: article._id,
          status: OrderStatus.COMPLETED,
          yarnIssueStatus: YarnIssueStatus.COMPLETED,
          yarnReturnStatus: YarnReturnStatus.IN_PROGRESS,
          priority: 10,
        },
      ],
      remarks: `Batch restore ${articleNumber} on ${orderNumber} to ${machineCode} (yarn return pending; cones still issued)`,
    },
    undefined
  );

  const row = (updated.productionOrderItems || []).find(
    (i) =>
      String(i.productionOrder?._id ?? i.productionOrder) === String(order._id) &&
      String(i.article?._id ?? i.article) === String(article._id)
  );

  return {
    ok: true,
    action: 'restored',
    articleNumber,
    orderNumber,
    machineCode,
    assignmentId: String(updated._id),
    itemId: row?._id ? String(row._id) : null,
    yarnReturnStatus: row?.yarnReturnStatus,
    issuedCones: diag.issuedCones,
    willShowOnYarnReturn: true,
  };
}

const dryRun = !process.argv.includes('--write');
const csvPath = readArg('csv');
const { url: mongoUrl, source: mongoSource } = resolveMongoConnectionString();

const targetRows = csvPath ? await loadRowsFromCsv(csvPath) : DEFAULT_TARGET_ROWS;

console.log(
  JSON.stringify(
    {
      mode: dryRun ? 'DRY_RUN (pass --write to apply)' : 'WRITE',
      mongoSource,
      mongoDb: mongoUrl.replace(/\/\/[^@]+@/, '//***@').replace(/(\/[^/?]+).*/, '$1'),
      rowCount: targetRows.length,
    },
    null,
    2
  )
);

await mongoose.connect(mongoUrl, MONGO_CONNECT_OPTIONS);

const results = [];
for (const row of targetRows) {
  const orderNumber = formatOrderNumber(row.order);
  const machineCode = formatMachineCode(row.machine);
  const articleNumber = String(row.article).trim();

  try {
    const result = await restoreOneRow({
      articleNumber,
      orderNumber,
      machineCode,
      dryRun,
    });
    results.push(result);
    console.log(JSON.stringify(result));
  } catch (err) {
    const fail = {
      ok: false,
      action: 'error',
      articleNumber,
      orderNumber,
      machineCode,
      error: err?.message || String(err),
    };
    results.push(fail);
    console.error(JSON.stringify(fail));
  }
}

const summary = {
  total: results.length,
  restored: results.filter((r) => r.action === 'restored').length,
  wouldRestore: results.filter((r) => r.action === 'would_restore').length,
  alreadyVisible: results.filter((r) => r.action === 'skipped_already_visible').length,
  noIssuedCones: results.filter((r) => r.action === 'skipped_no_issued_cones').length,
  errors: results.filter((r) => r.action === 'error' || r.action === 'needs_manual_fix').length,
};

console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));

await mongoose.disconnect();
process.exit(summary.errors > 0 ? 1 : 0);
