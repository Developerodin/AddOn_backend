#!/usr/bin/env node
/**
 * Inspect a Production Order + a specific Article (by articleNumber/factoryCode).
 *
 * Prints:
 *   - ProductionOrder document (lean) for the given orderNumber
 *   - All articles attached to that order (id, articleNumber, status, plannedQty, progress)
 *   - Full Article document for the requested articleNumber (full floorQuantities tree, etc.)
 *   - Linked Product master (factoryCode === articleNumber) with processes populated
 *
 * Usage:
 *   node scripts/inspect-order-article.js <orderNumber> <articleNumber>
 *   node scripts/inspect-order-article.js ORD-000036 A644
 *
 * Optional flags:
 *   --json       Print raw JSON only (no human-readable summary)
 *   --no-product Skip Product master lookup
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

import mongoose from 'mongoose';
import dns from 'dns/promises';
import config from '../src/config/config.js';
// Ensure all global models (User, Machine, etc.) are registered for populate().
import '../src/models/index.js';
import {
  ProductionOrder,
  Article,
} from '../src/models/production/index.js';
import Product from '../src/models/product.model.js';

/**
 * Sanitize raw mongo URL (align with other scripts).
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
 * Redact credentials in a Mongo URI for safe logging.
 * @param {string} uri
 * @returns {string}
 */
const redactMongoUri = (uri) => uri.replace(/^(mongodb(?:\+srv)?:\/\/)([^@]+)@/i, '$1***:***@');

/**
 * URL-encode the password portion if the URI contains multiple `@` characters
 * (mongodb driver v3.x cannot parse unescaped `@` inside the password).
 * @param {string} uri
 * @returns {string}
 */
const normalizeMongoUri = (uri) => {
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
};

/**
 * Strip query params unsupported by mongodb driver v3.x (e.g. `appName`).
 * @param {string} uri
 * @returns {string}
 */
const stripUnsupportedMongoParams = (uri) => {
  const qIdx = uri.indexOf('?');
  if (qIdx === -1) return uri;
  const base = uri.slice(0, qIdx);
  const params = uri.slice(qIdx + 1).split('&').filter(Boolean);
  const kept = params.filter((kv) => {
    const key = (kv.split('=', 1)[0] || '').trim();
    return key && key !== 'appName';
  });
  return kept.length ? `${base}?${kept.join('&')}` : base;
};

/**
 * Expand `mongodb+srv://` into a `mongodb://` host list using DNS SRV/TXT records.
 * Required for mongodb driver v3.x which is finicky with SRV.
 * @param {string} uri
 * @returns {Promise<string>}
 */
const expandSrvUriIfNeeded = async (uri) => {
  const m = uri.match(/^mongodb\+srv:\/\/([^:]+):([^@]+)@([^/]+)\/([^?]+)(\?.*)?$/i);
  if (!m) return uri;
  const [, username, password, host, dbName, rawQuery] = m;
  const query = (rawQuery || '').replace(/^\?/, '');

  const srv = await dns.resolveSrv(`_mongodb._tcp.${host}`);
  const hosts = srv.map((r) => `${r.name}:${r.port}`).join(',');

  const txt = (await dns.resolveTxt(host)).flat().filter(Boolean).join('&');
  const merged = [txt, query].filter(Boolean).join('&');
  const params = merged ? `${merged}&ssl=true` : 'ssl=true';

  return `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(
    password
  )}@${hosts}/${dbName}?${params}`;
};

/**
 * Parse CLI args into { orderNumber, articleNumber, flags }.
 * @param {string[]} argv
 */
const parseArgs = (argv) => {
  const positional = [];
  const flags = { json: false, product: true };
  for (const arg of argv) {
    if (arg === '--json') flags.json = true;
    else if (arg === '--no-product') flags.product = false;
    else positional.push(arg);
  }
  return {
    orderNumber: positional[0],
    articleNumber: positional[1],
    flags,
  };
};

/**
 * Pretty-print a labeled JSON block.
 * @param {string} label
 * @param {unknown} data
 */
const printSection = (label, data) => {
  process.stdout.write(`\n=== ${label} ===\n`);
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
};

/**
 * Build a small summary of the order (skip noisy floorQuantities for readability).
 * @param {object} order
 */
const summarizeOrder = (order) => ({
  _id: String(order._id),
  orderNumber: order.orderNumber,
  status: order.status,
  priority: order.priority,
  currentFloor: order.currentFloor,
  articleCount: Array.isArray(order.articles) ? order.articles.length : 0,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
  orderNote: order.orderNote ?? null,
});

/**
 * Build a compact one-line summary for each article on the order.
 * @param {object[]} articles
 */
const summarizeArticles = (articles) =>
  (articles || []).map((a) => ({
    _id: String(a._id),
    id: a.id,
    articleNumber: a.articleNumber,
    knittingCode: a.knittingCode ?? null,
    plannedQuantity: a.plannedQuantity,
    progress: a.progress,
    status: a.status,
    priority: a.priority,
    linkingType: a.linkingType,
    machineId: a.machineId ? String(a.machineId) : null,
  }));

/**
 * Main runner.
 * @param {string} orderNumber
 * @param {string} articleNumber
 * @param {{json: boolean, product: boolean}} flags
 */
const run = async (orderNumber, articleNumber, flags) => {
  if (!orderNumber || !articleNumber) {
    throw new Error('Usage: node scripts/inspect-order-article.js <orderNumber> <articleNumber>');
  }

  const mongoUrl = config?.mongoose?.url;
  if (typeof mongoUrl !== 'string' || mongoUrl.length === 0) {
    throw new Error('Missing config.mongoose.url (check MONGODB_URL in .env)');
  }

  // .env values sometimes contain accidental newlines; mongodb driver v3.x hard-fails on that.
  const cleanedMongoUrl = sanitizeMongoUrl(mongoUrl).replace(/\n/g, '');

  const safeUri = (await expandSrvUriIfNeeded(
    stripUnsupportedMongoParams(normalizeMongoUri(cleanedMongoUrl))
  )).replace(/\s/g, '');

  if (!flags.json) {
    process.stdout.write(`Connecting to ${redactMongoUri(safeUri)}\n`);
  }

  try {
    await mongoose.connect(safeUri, config.mongoose.options);
  } catch (err) {
    // Always include a redacted URI hint even in --json mode (to stderr).
    process.stderr.write(
      `Mongo connect failed. Raw URL issues: hasWhitespace=${/\\s/.test(mongoUrl)} hasNewline=${/[\\r\\n]/.test(
        mongoUrl
      )}\n`
    );
    process.stderr.write(`Mongo URL (redacted): ${redactMongoUri(safeUri)}\n`);
    throw err;
  }

  const order = await ProductionOrder.findOne({ orderNumber })
    .populate({
      path: 'articles',
      populate: { path: 'machineId', select: 'machineCode machineNumber model floor status' },
    })
    .populate('createdBy', 'name email')
    .populate('lastModifiedBy', 'name email')
    .lean();

  if (!order) {
    throw new Error(`ProductionOrder not found for orderNumber=${orderNumber}`);
  }

  const matchedArticles = (order.articles || []).filter(
    (a) => a && a.articleNumber === articleNumber
  );

  if (matchedArticles.length === 0) {
    const known = (order.articles || []).map((a) => a.articleNumber);
    throw new Error(
      `Article "${articleNumber}" not found on order ${orderNumber}. Articles on order: ${
        known.length ? known.join(', ') : '(none)'
      }`
    );
  }

  const articleIds = matchedArticles.map((a) => a._id);
  const fullArticles = await Article.find({ _id: { $in: articleIds } })
    .populate('machineId', 'machineCode machineNumber model floor status capacityPerShift capacityPerDay')
    .lean();

  let product = null;
  if (flags.product) {
    product = await Product.findOne({ factoryCode: articleNumber })
      .populate('processes.processId')
      .lean();
  }

  const output = {
    query: { orderNumber, articleNumber },
    order: summarizeOrder(order),
    articlesOnOrder: summarizeArticles(order.articles),
    matchedArticleCount: fullArticles.length,
    matchedArticles: fullArticles,
    product: product || null,
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  printSection('ORDER (summary)', output.order);
  printSection('ARTICLES ON ORDER (summary)', output.articlesOnOrder);
  printSection(`MATCHED ARTICLE(S) "${articleNumber}" — FULL DOCUMENT`, output.matchedArticles);
  if (flags.product) {
    printSection(`PRODUCT MASTER (factoryCode="${articleNumber}")`, output.product);
  }
};

const { orderNumber, articleNumber, flags } = parseArgs(process.argv.slice(2));
run(orderNumber, articleNumber, flags)
  .catch((err) => {
    process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // ignore disconnect errors
    }
  });
