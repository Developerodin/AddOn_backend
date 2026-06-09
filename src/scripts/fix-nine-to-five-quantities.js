#!/usr/bin/env node

/**
 * Fix production quantities stored with `.9` fractional parts that should be `.5`.
 *
 * Production qty allows whole numbers or `.5` half-steps only. Values like 877.9 or 749.899
 * are data-entry mistakes (`.9` typed instead of `.5`) and are corrected to 877.5 / 749.5.
 *
 * Collections scanned:
 *   - articles (floorQuantities + m3/m4 tracking)
 *   - article_logs (quantity)
 *   - m3_logs (quantity + on-hand fields)
 *   - m4_logs (quantity + on-hand fields)
 *
 * Usage:
 *   node src/scripts/fix-nine-to-five-quantities.js
 *   node src/scripts/fix-nine-to-five-quantities.js --order=ORD-000043 --article=A5436
 *   node src/scripts/fix-nine-to-five-quantities.js --write
 *
 * Default is DRY RUN. Pass `--write` to persist changes.
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
import dns from 'dns/promises';
import config from '../config/config.js';
import Article from '../models/production/article.model.js';
import ArticleLog from '../models/production/articleLog.model.js';
import M3Log from '../models/production/m3Log.model.js';
import M4Log from '../models/production/m4Log.model.js';
import ProductionOrder from '../models/production/productionOrder.model.js';

const HALF_STEP_EPSILON = 1e-9;
const NINE_FRACTION_TOLERANCE = 0.005;

const FLOOR_KEYS = [
  'knitting',
  'linking',
  'checking',
  'washing',
  'boarding',
  'silicon',
  'secondaryChecking',
  'branding',
  'reBoarding',
  'finalChecking',
  'warehouse',
  'dispatch',
];

const FLOOR_SCALAR_FIELDS = [
  'received',
  'completed',
  'remaining',
  'transferred',
  'repairReceived',
  'm4Quantity',
  'm1Quantity',
  'm2Quantity',
  'm3Quantity',
  'm1Transferred',
  'm1Remaining',
  'm2Transferred',
  'm2Remaining',
];

/** Weight is kg — not pair half-step qty; never auto-correct. */
const EXCLUDED_FLOOR_FIELDS = new Set(['weight']);

const ARTICLE_TRACKING_FIELDS = ['m3Tracking.outwardTotal', 'm4Tracking.outwardTotal'];

const LOG_NUMERIC_FIELDS = [
  'quantity',
  'previousOnHand',
  'newOnHand',
  'previousOutwardTotal',
  'newOutwardTotal',
  'availableAfter',
];

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
 * @param {string} uri
 * @returns {string}
 */
function normalizeMongoUri(uri) {
  const atCount = (uri.match(/@/g) || []).length;
  if (atCount <= 1) return uri;
  const m = uri.match(/^(mongodb(?:\+srv)?:\/\/)(.*)$/i);
  if (!m) return uri;
  const scheme = m[1];
  const rest = m[2];
  const lastAt = rest.lastIndexOf('@');
  if (lastAt === -1) return uri;
  const creds = rest.slice(0, lastAt);
  const hostAndQuery = rest.slice(lastAt + 1);
  const colonIdx = creds.indexOf(':');
  if (colonIdx === -1) return uri;
  const username = creds.slice(0, colonIdx);
  const password = creds.slice(colonIdx + 1);
  return `${scheme}${username}:${encodeURIComponent(password)}@${hostAndQuery}`;
}

/**
 * @param {string} uri
 * @returns {string}
 */
function stripUnsupportedMongoParams(uri) {
  const qIdx = uri.indexOf('?');
  if (qIdx === -1) return uri;
  const base = uri.slice(0, qIdx);
  const params = uri.slice(qIdx + 1).split('&').filter(Boolean);
  const kept = params.filter((kv) => {
    const key = (kv.split('=', 1)[0] || '').trim();
    return key && key !== 'appName';
  });
  return kept.length ? `${base}?${kept.join('&')}` : base;
}

/**
 * @param {string} uri
 * @returns {Promise<string>}
 */
async function expandSrvUriIfNeeded(uri) {
  const m = uri.match(/^mongodb\+srv:\/\/([^:]+):([^@]+)@([^/]+)\/([^?]+)(\?.*)?$/i);
  if (!m) return uri;
  const [, username, password, host, dbName, rawQuery] = m;
  const query = (rawQuery || '').replace(/^\?/, '');
  const srv = await dns.resolveSrv(`_mongodb._tcp.${host}`);
  const hosts = srv.map((r) => `${r.name}:${r.port}`).join(',');
  const txt = (await dns.resolveTxt(host)).flat().filter(Boolean).join('&');
  const merged = [txt, query].filter(Boolean).join('&');
  const params = merged ? `${merged}&ssl=true` : 'ssl=true';
  return `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${hosts}/${dbName}?${params}`;
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
 * Returns whether a number is a valid half-step quantity (whole or .5).
 * @param {number} n
 * @returns {boolean}
 */
function isValidHalfStepValue(n) {
  if (!Number.isFinite(n)) return false;
  return Math.abs(n * 2 - Math.round(n * 2)) < HALF_STEP_EPSILON;
}

/**
 * Detect `.9` fractional typo (including float drift like 877.89999).
 * @param {number} n
 * @returns {boolean}
 */
function hasNineFractionTypo(n) {
  if (!Number.isFinite(n) || Number.isInteger(n)) return false;
  if (isValidHalfStepValue(n)) return false;
  const frac = Math.abs(n) - Math.floor(Math.abs(n));
  return Math.abs(frac - 0.9) < NINE_FRACTION_TOLERANCE;
}

/**
 * Convert `.9` fraction to `.5` (877.9 → 877.5). Returns null if no change needed.
 * @param {number} n
 * @returns {{ before: number, after: number } | null}
 */
function fixNineToFive(n) {
  if (!hasNineFractionTypo(n)) return null;
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  const after = sign * (Math.floor(abs) + 0.5);
  return { before: n, after };
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {Array<{ path: string, before: number, after: number }>} changes
 * @returns {unknown}
 */
function maybeFixScalar(value, path, changes) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const fix = fixNineToFive(value);
  if (!fix) return value;
  changes.push({ path, before: fix.before, after: fix.after });
  return fix.after;
}

/**
 * Walk an article floorQuantities tree and collect $set updates.
 * @param {object} floorQuantities
 * @returns {{ updates: Record<string, number>, changes: Array<{ path: string, before: number, after: number }> }}
 */
function buildArticleFloorUpdates(floorQuantities) {
  /** @type {Record<string, number>} */
  const updates = {};
  /** @type {Array<{ path: string, before: number, after: number }>} */
  const changes = [];

  if (!floorQuantities || typeof floorQuantities !== 'object') {
    return { updates, changes };
  }

  for (const floorKey of FLOOR_KEYS) {
    const floor = floorQuantities[floorKey];
    if (!floor || typeof floor !== 'object') continue;

    for (const field of FLOOR_SCALAR_FIELDS) {
      if (EXCLUDED_FLOOR_FIELDS.has(field)) continue;
      if (!(field in floor)) continue;
      const path = `floorQuantities.${floorKey}.${field}`;
      const fixed = maybeFixScalar(floor[field], path, changes);
      if (fixed !== floor[field]) updates[path] = fixed;
    }

    for (const [arrayField, nestedNumeric] of [
      ['receivedData', ['transferred']],
      ['transferredData', ['transferred']],
    ]) {
      const rows = floor[arrayField];
      if (!Array.isArray(rows)) continue;
      rows.forEach((row, idx) => {
        if (!row || typeof row !== 'object') return;
        for (const nestedField of nestedNumeric) {
          if (!(nestedField in row)) return;
          const path = `floorQuantities.${floorKey}.${arrayField}.${idx}.${nestedField}`;
          const fixed = maybeFixScalar(row[nestedField], path, changes);
          if (fixed !== row[nestedField]) updates[path] = fixed;
        }
      });
    }
  }

  return { updates, changes };
}

/**
 * @param {object} article
 * @returns {{ updates: Record<string, number>, changes: Array<{ path: string, before: number, after: number }> }}
 */
function buildArticleUpdates(article) {
  const { updates: floorUpdates, changes } = buildArticleFloorUpdates(article.floorQuantities);
  /** @type {Record<string, number>} */
  const updates = { ...floorUpdates };

  for (const dottedPath of ARTICLE_TRACKING_FIELDS) {
    const [root, leaf] = dottedPath.split('.');
    const current = article?.[root]?.[leaf];
    const fixed = maybeFixScalar(current, dottedPath, changes);
    if (fixed !== current) updates[dottedPath] = fixed;
  }

  return { updates, changes };
}

/**
 * @param {object} doc
 * @param {string[]} fields
 * @param {string} labelPrefix
 * @returns {{ updates: Record<string, number>, changes: Array<{ path: string, before: number, after: number }> }}
 */
function buildLogUpdates(doc, fields, labelPrefix) {
  /** @type {Record<string, number>} */
  const updates = {};
  /** @type {Array<{ path: string, before: number, after: number }>} */
  const changes = [];

  for (const field of fields) {
    if (!(field in doc)) continue;
    const path = `${labelPrefix}.${field}`;
    const fixed = maybeFixScalar(doc[field], path, changes);
    if (fixed !== doc[field]) updates[field] = fixed;
  }

  return { updates, changes };
}

/**
 * @param {string} orderNumber
 * @param {string|null} articleNumber
 * @returns {Promise<string[]|null>}
 */
async function resolveArticleMongoIds(orderNumber, articleNumber) {
  if (!orderNumber) return null;
  const order = await ProductionOrder.findOne({ orderNumber }).select('_id orderNumber articles').lean();
  if (!order) throw new Error(`ProductionOrder not found: ${orderNumber}`);

  let articleIds = (order.articles || []).map((id) => String(id));
  if (articleNumber) {
    const scoped = await Article.find({
      orderId: order._id,
      articleNumber,
    })
      .select('_id')
      .lean();
    if (!scoped.length) {
      throw new Error(`Article ${articleNumber} not found on order ${orderNumber}`);
    }
    articleIds = scoped.map((a) => String(a._id));
  }
  return articleIds;
}

/**
 * @returns {Promise<void>}
 */
async function connectMongo() {
  const mongoUrl = config?.mongoose?.url;
  if (typeof mongoUrl !== 'string' || !mongoUrl.length) {
    throw new Error('Missing MONGODB_URL in config');
  }
  const cleaned = sanitizeMongoUrl(mongoUrl).replace(/\n/g, '');
  const safeUri = (await expandSrvUriIfNeeded(stripUnsupportedMongoParams(normalizeMongoUri(cleaned)))).replace(
    /\s/g,
    ''
  );
  await mongoose.connect(safeUri, config.mongoose.options);
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const write = process.argv.includes('--write');
  const orderNumber = readArg('order');
  const articleNumber = readArg('article');

  await connectMongo();

  const scopedArticleIds = await resolveArticleMongoIds(orderNumber, articleNumber);

  /** @type {Record<string, unknown>} */
  const articleQuery = {};
  if (scopedArticleIds) {
    articleQuery._id = { $in: scopedArticleIds };
  }

  const articles = await Article.find(articleQuery)
    .select('_id id articleNumber orderId floorQuantities m3Tracking m4Tracking')
    .lean();

  /** @type {Array<object>} */
  const articleFixes = [];
  /** @type {import('mongoose').AnyBulkWriteOperation[]} */
  const articleBulkOps = [];

  for (const article of articles) {
    const { updates, changes } = buildArticleUpdates(article);
    if (!changes.length) continue;

    articleFixes.push({
      _id: String(article._id),
      id: article.id,
      articleNumber: article.articleNumber,
      changeCount: changes.length,
      changes,
    });

    if (write) {
      articleBulkOps.push({
        updateOne: {
          filter: { _id: article._id },
          update: { $set: updates },
        },
      });
    }
  }

  const articleIdStrings = articles.map((a) => a.id).filter(Boolean);
  const articleMongoIdStrings = articles.map((a) => String(a._id));

  /** @type {Record<string, unknown>} */
  const logScope = {};
  if (scopedArticleIds) {
    logScope.$or = [{ articleId: { $in: articleIdStrings } }, { orderId: { $in: articleMongoIdStrings } }];
  }

  const [articleLogs, m3Logs, m4Logs] = await Promise.all([
    ArticleLog.find(logScope).select('_id id articleId orderId quantity').lean(),
    M3Log.find(logScope).select('_id id articleNumber orderNumber quantity previousOnHand newOnHand previousOutwardTotal newOutwardTotal availableAfter').lean(),
    M4Log.find(logScope).select('_id id articleNumber orderNumber quantity previousOnHand newOnHand previousOutwardTotal newOutwardTotal availableAfter').lean(),
  ]);

  /** @type {Array<object>} */
  const articleLogFixes = [];
  /** @type {import('mongoose').AnyBulkWriteOperation[]} */
  const articleLogBulkOps = [];

  for (const log of articleLogs) {
    const { updates, changes } = buildLogUpdates(log, ['quantity'], `article_logs.${log.id || log._id}`);
    if (!changes.length) continue;
    articleLogFixes.push({ _id: String(log._id), id: log.id, articleId: log.articleId, changes });
    if (write) {
      articleLogBulkOps.push({ updateOne: { filter: { _id: log._id }, update: { $set: updates } } });
    }
  }

  /** @type {Array<object>} */
  const m3LogFixes = [];
  /** @type {import('mongoose').AnyBulkWriteOperation[]} */
  const m3LogBulkOps = [];

  for (const log of m3Logs) {
    const { updates, changes } = buildLogUpdates(log, LOG_NUMERIC_FIELDS, `m3_logs.${log.id || log._id}`);
    if (!changes.length) continue;
    m3LogFixes.push({
      _id: String(log._id),
      id: log.id,
      articleNumber: log.articleNumber,
      orderNumber: log.orderNumber,
      changes,
    });
    if (write) {
      m3LogBulkOps.push({ updateOne: { filter: { _id: log._id }, update: { $set: updates } } });
    }
  }

  /** @type {Array<object>} */
  const m4LogFixes = [];
  /** @type {import('mongoose').AnyBulkWriteOperation[]} */
  const m4LogBulkOps = [];

  for (const log of m4Logs) {
    const { updates, changes } = buildLogUpdates(log, LOG_NUMERIC_FIELDS, `m4_logs.${log.id || log._id}`);
    if (!changes.length) continue;
    m4LogFixes.push({
      _id: String(log._id),
      id: log.id,
      articleNumber: log.articleNumber,
      orderNumber: log.orderNumber,
      changes,
    });
    if (write) {
      m4LogBulkOps.push({ updateOne: { filter: { _id: log._id }, update: { $set: updates } } });
    }
  }

  let articleWriteResult = null;
  let articleLogWriteResult = null;
  let m3LogWriteResult = null;
  let m4LogWriteResult = null;

  if (write) {
    if (articleBulkOps.length) articleWriteResult = await Article.bulkWrite(articleBulkOps);
    if (articleLogBulkOps.length) articleLogWriteResult = await ArticleLog.bulkWrite(articleLogBulkOps);
    if (m3LogBulkOps.length) m3LogWriteResult = await M3Log.bulkWrite(m3LogBulkOps);
    if (m4LogBulkOps.length) m4LogWriteResult = await M4Log.bulkWrite(m4LogBulkOps);
  }

  const summary = {
    ok: true,
    dryRun: !write,
    scope: {
      orderNumber: orderNumber || null,
      articleNumber: articleNumber || null,
      articlesScanned: articles.length,
    },
    counts: {
      articlesWithFixes: articleFixes.length,
      articleFieldChanges: articleFixes.reduce((n, r) => n + r.changeCount, 0),
      articleLogsWithFixes: articleLogFixes.length,
      m3LogsWithFixes: m3LogFixes.length,
      m4LogsWithFixes: m4LogFixes.length,
    },
    writeResults: write
      ? {
          articles: articleWriteResult,
          articleLogs: articleLogWriteResult,
          m3Logs: m3LogWriteResult,
          m4Logs: m4LogWriteResult,
        }
      : null,
    samples: {
      articles: articleFixes.slice(0, 5),
      articleLogs: articleLogFixes.slice(0, 5),
      m3Logs: m3LogFixes.slice(0, 5),
      m4Logs: m4LogFixes.slice(0, 5),
    },
    hint: write ? 'Changes persisted.' : 'Re-run with --write to persist.',
  };

  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
