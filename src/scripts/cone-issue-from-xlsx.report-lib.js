/**
 * Mongo + CSV helpers for cone-issue Excel reports (used by `report-cone-issue-from-xlsx.js`).
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnCone, YarnTransaction } from '../models/index.js';
import { ProductionOrder, Article } from '../models/production/index.js';

/** @type {string[]} */
export const ISSUE_TRANSACTION_TYPES = ['yarn_issued', 'yarn_issued_linking', 'yarn_issued_sampling'];

export const MONGO_CONNECT_OPTIONS = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

/**
 * @param {string} rawUrl
 * @returns {string}
 */
export function sanitizeMongoUrl(rawUrl) {
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
export function resolveMongoConnectionString() {
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
export async function connectMongo() {
  const { url: mongoUrl, source } = resolveMongoConnectionString();
  if (!mongoUrl) throw new Error('MongoDB URL is empty. Set MONGODB_URL or pass --mongo-url=');
  const redactedUrl = mongoUrl.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`MongoDB URL (${source}): ${redactedUrl}`);
  await mongoose.connect(mongoUrl, MONGO_CONNECT_OPTIONS);
}

/**
 * @param {unknown} v
 * @returns {string}
 */
export function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * @param {string} trimmed
 * @returns {boolean}
 */
export function isCanonicalObjectIdString(trimmed) {
  return (
    mongoose.Types.ObjectId.isValid(trimmed) && String(new mongoose.Types.ObjectId(trimmed)) === trimmed
  );
}

/**
 * Escapes a string for use inside a RegExp.
 * @param {string} s
 * @returns {string}
 */
export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Loads YarnCone docs for barcode or Mongo id inputs (batch + case-insensitive barcode fallback).
 * @param {string[]} keysInOrder
 * @returns {Promise<Map<string, import('mongoose').LeanDocument<any>>>} Keyed by Excel cell or ObjectId string.
 */
export async function loadConesForExcelKeys(keysInOrder) {
  const coneByInputKey = new Map();

  /** @type {Set<string>} */
  const oidSet = new Set();
  /** @type {Set<string>} */
  const bcSet = new Set();

  for (const raw of keysInOrder) {
    const t = String(raw ?? '').trim();
    if (!t) continue;
    if (isCanonicalObjectIdString(t)) oidSet.add(t);
    else bcSet.add(t);
  }

  if (oidSet.size) {
    const cones = await YarnCone.find({
      _id: { $in: [...oidSet].map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select('_id barcode yarnName issueStatus boxId')
      .lean();
    for (const c of cones) {
      coneByInputKey.set(String(c._id), c);
    }
  }

  if (bcSet.size) {
    const barcodes = [...bcSet];
    const exact = await YarnCone.find({ barcode: { $in: barcodes } })
      .select('_id barcode yarnName issueStatus boxId')
      .lean();
    for (const c of exact) {
      coneByInputKey.set(String(c.barcode), c);
    }
    const foundExact = new Set(exact.map((c) => String(c.barcode)));
    const missing = barcodes.filter((b) => !foundExact.has(b));
    for (const b of missing) {
      const esc = escapeRegex(b);
      const c = await YarnCone.findOne({ barcode: new RegExp(`^${esc}$`, 'i') })
        .select('_id barcode yarnName issueStatus boxId')
        .lean();
      if (c) coneByInputKey.set(b, c);
    }
  }

  return coneByInputKey;
}

/**
 * @param {string} s
 * @returns {boolean}
 */
function isNonEmptyString(s) {
  return typeof s === 'string' && s.trim() !== '';
}

/**
 * Builds maps for order/article numbers when missing on transactions.
 * @param {Iterable<any>} txns
 * @returns {Promise<{ orderNoById: Map<string, string>, articleNoById: Map<string, string> }>}
 */
export async function hydrateOrderAndArticleMaps(txns) {
  const orderNoById = new Map();
  const articleNoById = new Map();
  const orderIds = new Set();
  const articleIds = new Set();
  for (const txn of txns) {
    if (!txn) continue;
    if (!isNonEmptyString(txn.orderno) && txn.orderId) orderIds.add(String(txn.orderId));
    if (!isNonEmptyString(txn.articleNumber) && txn.articleId) articleIds.add(String(txn.articleId));
  }
  const oidList = [...orderIds].filter((id) => mongoose.Types.ObjectId.isValid(id));
  const aidList = [...articleIds].filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (oidList.length) {
    const orders = await ProductionOrder.find({
      _id: { $in: oidList.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select('orderNumber')
      .lean();
    for (const o of orders || []) {
      if (o?.orderNumber) orderNoById.set(String(o._id), String(o.orderNumber));
    }
  }
  if (aidList.length) {
    const articles = await Article.find({
      _id: { $in: aidList.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select('articleNumber')
      .lean();
    for (const a of articles || []) {
      if (a?.articleNumber) articleNoById.set(String(a._id), String(a.articleNumber));
    }
  }
  return { orderNoById, articleNoById };
}

/**
 * Latest issue transaction per cone `_id` (string key).
 * @param {Set<string>} targetConeIdStrSet
 * @returns {Promise<Map<string, any>>}
 */
export async function mapConeIdToLatestIssueTxn(targetConeIdStrSet) {
  if (targetConeIdStrSet.size === 0) return new Map();
  const targetConeIds = [...targetConeIdStrSet].map((s) => new mongoose.Types.ObjectId(s));

  const txns = await YarnTransaction.find({
    transactionType: { $in: ISSUE_TRANSACTION_TYPES },
    conesIdsArray: { $in: targetConeIds },
  })
    .sort({ transactionDate: -1, createdAt: -1 })
    .lean();

  const resolved = new Map();
  for (const txn of txns) {
    for (const coneId of txn?.conesIdsArray || []) {
      const idStr = coneId ? String(coneId) : '';
      if (!idStr) continue;
      if (!targetConeIdStrSet.has(idStr)) continue;
      if (resolved.has(idStr)) continue;
      resolved.set(idStr, txn);
    }
    if (resolved.size === targetConeIdStrSet.size) break;
  }
  return resolved;
}
