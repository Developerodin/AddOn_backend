#!/usr/bin/env node

/**
 * For a production order + article number: show knitting `floorQuantities`, first-floor receipt (linking),
 * and ArticleLog rows where work left **Knitting** (transfer actions + optional knit `QUANTITY_UPDATED` context).
 *
 * Optional correction: set `floorQuantities.knitting.completed` and `.transferred` to the same value and
 * recompute `.remaining` as `max(0, received - completed - m4Quantity)` (matches `article.service.js` knit transfer).
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/report-knitting-transfer-by-order-article.js ORD-000043 A5431
 *   NODE_ENV=development node src/scripts/report-knitting-transfer-by-order-article.js ORD-000043 A5431 --value=1271 --write
 *
 * Options:
 *   --value=<n>   When passed with `--write`, sets knitting completed + transferred to n and updates remaining.
 *   --write       Persist `--value` to MongoDB (default is read-only report).
 *   --mongo-url=  Override connection string (else config / MONGODB_URL).
 */

// Node 25+ url.parse edge case for multi-host URIs (same as fix-article-knitting-qty.js).
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

import mongoose from 'mongoose';
import config from '../config/config.js';
import Article from '../models/production/article.model.js';
import ArticleLog from '../models/production/articleLog.model.js';
import ProductionOrder from '../models/production/productionOrder.model.js';
import { LogAction } from '../models/production/enums.js';

/** @type {import('mongoose').ConnectOptions} */
const MONGO_CONNECT_OPTIONS = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

/** Log actions that represent a transfer **to** a downstream floor (excludes inbound-to-knitting). */
const TRANSFER_OUT_ACTIONS = new Set(
  Object.values(LogAction).filter(
    (a) => typeof a === 'string' && /^Transferred to /i.test(a) && a !== LogAction.TRANSFERRED_TO_KNITTING,
  ),
);

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
 * @param {string} rawUrl
 * @returns {string}
 */
function sanitizeMongoUrl(rawUrl) {
  let u = String(rawUrl || '').replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
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
 * Connects to MongoDB using the shared app config or CLI/env URL.
 * @returns {Promise<void>}
 */
async function connectMongo() {
  const { url: mongoUrl, source } = resolveMongoConnectionString();
  if (!mongoUrl) {
    throw new Error('MongoDB URL is empty. Set MONGODB_URL in .env or pass --mongo-url=');
  }
  if (!/^mongodb(\+srv)?:\/\//.test(mongoUrl)) {
    throw new Error(
      `MongoDB URL looks invalid (must start with mongodb:// or mongodb+srv://). Got: ${mongoUrl.slice(0, 32)}...`,
    );
  }
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify(
      {
        msg: 'Connecting to MongoDB',
        source,
        url: mongoUrl.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@'),
      },
      null,
      2,
    ),
  );
  await mongoose.connect(mongoUrl, MONGO_CONNECT_OPTIONS);
}

/**
 * @param {unknown} v
 * @returns {number}
 */
function parseNumberOrThrow(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${String(v)}`);
  return n;
}

/**
 * @param {unknown} doc
 * @returns {Record<string, unknown>|null}
 */
function knittingSlice(doc) {
  const k = doc?.floorQuantities?.knitting;
  if (!k || typeof k !== 'object') return null;
  return {
    received: Number(k.received ?? 0),
    completed: Number(k.completed ?? 0),
    remaining: Number(k.remaining ?? 0),
    transferred: Number(k.transferred ?? 0),
    m4Quantity: Number(k.m4Quantity ?? 0),
    weight: Number(k.weight ?? 0),
  };
}

/**
 * Sum of log quantities for transfers that left knitting (by action + fromFloor).
 * @param {import('mongoose').LeanDocument<*>[]} logs
 * @returns {{ totalQty: number, rows: import('mongoose').LeanDocument<*>[] }}
 */
function sumKnittingTransferOutFromLogs(logs) {
  const rows = logs.filter((log) => {
    const from = String(log.fromFloor || '').trim();
    const isKnit = /^knitting$/i.test(from);
    if (!isKnit) return false;
    return TRANSFER_OUT_ACTIONS.has(log.action);
  });
  const totalQty = rows.reduce((s, r) => s + Number(r.quantity ?? 0), 0);
  return { totalQty, rows };
}

/**
 * Recomputes knitting remaining after a completed/transferred correction (knit floor only).
 * @param {number} received
 * @param {number} completed
 * @param {number} m4Quantity
 * @returns {number}
 */
function computeKnittingRemaining(received, completed, m4Quantity) {
  return Math.max(0, received - completed - m4Quantity);
}

/**
 * @param {string} orderNumber
 * @param {string} articleNumber
 * @returns {Promise<{ order: import('mongoose').LeanDocument<*>; article: import('mongoose').LeanDocument<*> }>}
 */
async function resolveOrderAndArticle(orderNumber, articleNumber) {
  const orderRe = new RegExp(`^${escapeRegex(orderNumber.trim())}$`, 'i');
  const artRe = new RegExp(`^${escapeRegex(articleNumber.trim())}$`, 'i');

  const order = await ProductionOrder.findOne({ orderNumber: orderRe }).lean();
  if (!order) {
    throw new Error(`ProductionOrder not found for orderNumber=${orderNumber}`);
  }

  const article = await Article.findOne({
    orderId: order._id,
    articleNumber: artRe,
  }).lean();

  if (!article) {
    throw new Error(`Article not found for orderNumber=${orderNumber} articleNumber=${articleNumber}`);
  }

  return { order, article };
}

async function main() {
  const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const write = process.argv.includes('--write');
  const valueRaw = readArg('value');

  const orderNumber = pos[0];
  const articleNumber = pos[1];
  if (!orderNumber || !articleNumber) {
    throw new Error('Usage: node ... <orderNumber> <articleNumber>  e.g. ORD-000043 A5431');
  }

  await connectMongo();
  const { order, article } = await resolveOrderAndArticle(orderNumber, articleNumber);

  const orderIdStr = String(order._id);
  const articleIdStr = String(article._id);

  const logs = await ArticleLog.find({
    orderId: orderIdStr,
    articleId: articleIdStr,
  })
    .sort({ timestamp: 1 })
    .lean();

  const { totalQty: logSumTransferOut, rows: knitOutRows } = sumKnittingTransferOutFromLogs(logs);
  const knit = knittingSlice(article);
  const linkingReceived = Number(article?.floorQuantities?.linking?.received ?? 0);

  const report = {
    orderNumber: order.orderNumber,
    orderId: orderIdStr,
    articleNumber: article.articleNumber,
    articleId: article.id,
    articleObjectId: articleIdStr,
    plannedQuantity: article.plannedQuantity,
    floorKnitting: knit,
    linkingReceived,
    ledger: {
      knittingTransferOutLogQtySum: logSumTransferOut,
      knittingTransferOutLogCount: knitOutRows.length,
    },
    logLines: knitOutRows.map((r) => ({
      timestamp: r.timestamp,
      action: r.action,
      quantity: r.quantity,
      fromFloor: r.fromFloor,
      toFloor: r.toFloor,
      remarks: r.remarks,
      id: r.id,
    })),
  };

  if (write) {
    if (valueRaw == null) {
      throw new Error('With --write you must pass --value=<n> (e.g. --value=1271).');
    }
    const value = parseNumberOrThrow(valueRaw);
    if (!knit) throw new Error('Article has no floorQuantities.knitting');
    const received = knit.received;
    const m4 = knit.m4Quantity;
    const remaining = computeKnittingRemaining(received, value, m4);
    const update = {
      $set: {
        'floorQuantities.knitting.completed': value,
        'floorQuantities.knitting.transferred': value,
        'floorQuantities.knitting.remaining': remaining,
      },
    };
    const res = await Article.updateOne({ _id: article._id }, update);
    const after = await Article.findById(article._id).lean();
    report.write = {
      value,
      matchedCount: res?.matchedCount ?? res?.n ?? null,
      modifiedCount: res?.modifiedCount ?? res?.nModified ?? null,
      floorKnittingAfter: knittingSlice(after),
    };
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack || err);
  process.exitCode = 1;
});
