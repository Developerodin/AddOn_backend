#!/usr/bin/env node

/**
 * Lookup a YarnCone by barcode (or _id) and print its YarnTransactions (read-only).
 *
 * Usage:
 *   node src/scripts/check-cone-by-barcode-and-transactions.js --barcode=69c61d3d14badff1b9e4d701
 *   node src/scripts/check-cone-by-barcode-and-transactions.js --id=69c61d3d14badff1b9e4d715
 *   node src/scripts/check-cone-by-barcode-and-transactions.js --key=69c61d3d14badff1b9e4d701
 *   node src/scripts/check-cone-by-barcode-and-transactions.js --barcode=... --json-only
 *   node src/scripts/check-cone-by-barcode-and-transactions.js --barcode=... --mongo-url=mongodb://...
 *
 * Notes:
 * - Cone barcode is stored at `YarnCone.barcode` (unique).
 * - Transactions reference cones via `YarnTransaction.conesIdsArray` (ObjectId[]).
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

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnCone, YarnTransaction } from '../models/index.js';

const JSON_ONLY = process.argv.includes('--json-only');

/** @type {Record<string, unknown>} */
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
 * Resolve Mongo connection string: CLI wins, then app config, then env.
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
    return { url: cfg, source: 'config.mongoose.url (MONGODB_URL from .env, plus -test suffix when NODE_ENV=test)' };
  }

  const envOnly = sanitizeMongoUrl(String(process.env.MONGODB_URL || ''));
  return { url: envOnly, source: 'process.env.MONGODB_URL' };
}

/**
 * @param {string} argPrefix
 * @returns {string | null}
 */
function parseArg(argPrefix) {
  const raw = process.argv.find((a) => a.startsWith(argPrefix));
  if (!raw) return null;
  const v = raw.slice(argPrefix.length).trim();
  return v ? v : null;
}

/**
 * Escape string for exact-match regex.
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Connect to MongoDB.
 * @returns {Promise<void>}
 */
async function connectMongo() {
  const { url: mongoUrl, source } = resolveMongoConnectionString();
  if (!mongoUrl) throw new Error('MongoDB URL is empty. Set MONGODB_URL in .env or pass --mongo-url=');

  const redactedUrl = mongoUrl.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`MongoDB URL (${source}): ${redactedUrl}`);
  await mongoose.connect(mongoUrl, MONGO_CONNECT_OPTIONS);
}

/**
 * Find YarnCone by exact or case-insensitive barcode.
 * @param {string} barcode
 * @returns {Promise<import('mongoose').LeanDocument<any> | null>}
 */
async function findConeByBarcode(barcode) {
  const b = String(barcode || '').trim();
  if (!b) return null;

  let cone = await YarnCone.findOne({ barcode: b }).lean();
  if (cone) return cone;

  const esc = escapeRegex(b);
  return YarnCone.findOne({ barcode: new RegExp(`^${esc}$`, 'i') }).lean();
}

/**
 * Find YarnCone by _id.
 * @param {string} id
 * @returns {Promise<import('mongoose').LeanDocument<any> | null>}
 */
async function findConeById(id) {
  const raw = String(id || '').trim();
  if (!raw) return null;
  if (!mongoose.Types.ObjectId.isValid(raw)) return null;
  return YarnCone.findById(raw).lean();
}

/**
 * Resolve a cone by either barcode or _id.
 * @param {{ barcode?: string | null, id?: string | null, key?: string | null }} input
 * @returns {Promise<{ cone: import('mongoose').LeanDocument<any> | null, resolvedBy: 'barcode' | 'id' | 'key_as_id' | 'key_as_barcode' | 'none' }>}
 */
async function resolveCone(input) {
  const barcode = String(input.barcode || '').trim();
  const id = String(input.id || '').trim();
  const key = String(input.key || '').trim();

  if (id) {
    const coneById = await findConeById(id);
    return { cone: coneById, resolvedBy: 'id' };
  }

  if (barcode) {
    const coneByBarcode = await findConeByBarcode(barcode);
    return { cone: coneByBarcode, resolvedBy: 'barcode' };
  }

  if (key) {
    const asId = await findConeById(key);
    if (asId) return { cone: asId, resolvedBy: 'key_as_id' };
    const asBarcode = await findConeByBarcode(key);
    return { cone: asBarcode, resolvedBy: 'key_as_barcode' };
  }

  return { cone: null, resolvedBy: 'none' };
}

/**
 * Find transactions which include this cone _id.
 * @param {mongoose.Types.ObjectId} coneId
 * @returns {Promise<import('mongoose').LeanDocument<any>[]>}
 */
async function findTransactionsForConeId(coneId) {
  return YarnTransaction.find({ conesIdsArray: coneId })
    .sort({ transactionDate: 1, createdAt: 1 })
    .lean();
}

/**
 * @param {any} cone
 * @returns {Record<string, unknown>}
 */
function pickConeDetails(cone) {
  if (!cone) return {};
  return {
    _id: cone._id,
    barcode: cone.barcode,
    poNumber: cone.poNumber,
    boxId: cone.boxId,
    yarnName: cone.yarnName,
    yarnCatalogId: cone.yarnCatalogId,
    shadeCode: cone.shadeCode,
    coneWeight: cone.coneWeight,
    tearWeight: cone.tearWeight,
    coneStorageId: cone.coneStorageId,
    issueStatus: cone.issueStatus,
    issuedBy: cone.issuedBy,
    issueDate: cone.issueDate,
    issueWeight: cone.issueWeight,
    returnStatus: cone.returnStatus,
    returnBy: cone.returnBy,
    returnDate: cone.returnDate,
    returnWeight: cone.returnWeight,
    orderId: cone.orderId,
    articleId: cone.articleId,
    createdAt: cone.createdAt,
    updatedAt: cone.updatedAt,
  };
}

/**
 * @param {any} t
 * @returns {Record<string, unknown>}
 */
function pickTransactionDetails(t) {
  if (!t) return {};
  return {
    _id: t._id,
    transactionType: t.transactionType,
    transactionDate: t.transactionDate,
    yarnCatalogId: t.yarnCatalogId,
    yarnName: t.yarnName,
    transactionNetWeight: t.transactionNetWeight,
    transactionTotalWeight: t.transactionTotalWeight,
    transactionTearWeight: t.transactionTearWeight,
    transactionConeCount: t.transactionConeCount,
    orderId: t.orderId,
    orderno: t.orderno,
    articleId: t.articleId,
    articleNumber: t.articleNumber,
    machineId: t.machineId,
    boxIds: t.boxIds,
    conesIdsArray: t.conesIdsArray,
    fromStorageLocation: t.fromStorageLocation,
    toStorageLocation: t.toStorageLocation,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

async function main() {
  try {
    const barcode = parseArg('--barcode=');
    const id = parseArg('--id=');
    const key = parseArg('--key=');
    if (!barcode && !id && !key) {
      throw new Error('Missing required arg: pass one of --barcode=, --id=, or --key=');
    }

    await connectMongo();

    const { cone, resolvedBy } = await resolveCone({ barcode, id, key });
    if (!cone) {
      const out = {
        ok: false,
        barcode: barcode || null,
        id: id || null,
        key: key || null,
        resolvedBy,
        cone: null,
        transactions: [],
        transactionsCount: 0,
      };
      if (JSON_ONLY) {
        process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      } else {
        // Keep output terse for terminal usage
        const shown = barcode || id || key;
        logger.warn(`No YarnCone found for input: ${shown}`);
      }
      process.exit(2);
    }

    const transactions = await findTransactionsForConeId(cone._id);
    const out = {
      ok: true,
      barcode: barcode || null,
      id: id || null,
      key: key || null,
      resolvedBy,
      cone: pickConeDetails(cone),
      transactionsCount: transactions.length,
      transactions: transactions.map(pickTransactionDetails),
    };

    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    await mongoose.connection.close();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (JSON_ONLY) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: msg }, null, 2)}\n`);
    } else {
      logger.error(msg);
    }
    try {
      await mongoose.connection.close();
    } catch {
      // ignore
    }
    process.exit(1);
  }
}

main();

