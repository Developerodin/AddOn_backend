#!/usr/bin/env node

/**
 * Fix wrong `floorQuantities.knitting.completed` and `transferred` values on an Article document.
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/fix-article-knitting-qty.js --_id=69e8b3f8733c29bce00946b6 --value=1166
 *   NODE_ENV=development node src/scripts/fix-article-knitting-qty.js --id=ART-123 --value=1166
 *   NODE_ENV=development node src/scripts/fix-article-knitting-qty.js --_id=... --value=1166 --write
 *   NODE_ENV=development node src/scripts/fix-article-knitting-qty.js --_id=... --value=1166 --mongo-url="mongodb+srv://..."
 *
 * Notes:
 * - Default is DRY RUN (no DB writes). Pass `--write` to persist.
 * - MongoDB URL is resolved from `--mongo-url=` first, then `process.env.MONGODB_URL`.
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
import config from '../config/config.js';
import Article from '../models/production/article.model.js';

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
  if (u.endsWith('>')) u = u.slice(0, -1);
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
  console.log(
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
 * @returns {{ completed: number, transferred: number, received: number, remaining: number } | null}
 */
function readKnittingSnapshot(doc) {
  const fq = doc?.floorQuantities;
  const k = fq?.knitting;
  if (!k) return null;
  return {
    received: Number(k.received ?? 0),
    completed: Number(k.completed ?? 0),
    remaining: Number(k.remaining ?? 0),
    transferred: Number(k.transferred ?? 0),
  };
}

async function main() {
  const value = parseNumberOrThrow(readArg('value') ?? '1166');
  const byObjectId = readArg('_id');
  const byArticleId = readArg('id'); // Article.id (string)
  const write = process.argv.includes('--write');

  if (!byObjectId && !byArticleId) {
    throw new Error('Provide --_id=<mongoObjectId> OR --id=<Article.id>.');
  }

  await connectMongo();

  const query = byObjectId ? { _id: byObjectId } : { id: byArticleId };
  const doc = await Article.findOne(query).lean();
  if (!doc) {
    throw new Error(`Article not found for query: ${JSON.stringify(query)}`);
  }

  const before = readKnittingSnapshot(doc);
  if (!before) {
    throw new Error('Article has no `floorQuantities.knitting` object.');
  }

  const update = {
    $set: {
      'floorQuantities.knitting.completed': value,
      'floorQuantities.knitting.transferred': value,
    },
  };

  if (!write) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          query,
          value,
          before,
          after: { ...before, completed: value, transferred: value },
          hint: 'Re-run with --write to persist.',
        },
        null,
        2,
      ),
    );
    await mongoose.disconnect();
    return;
  }

  const res = await Article.updateOne(query, update);
  const afterDoc = await Article.findOne(query).lean();
  const after = readKnittingSnapshot(afterDoc);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: false,
        query,
        value,
        matchedCount: res?.matchedCount ?? res?.n ?? null,
        modifiedCount: res?.modifiedCount ?? res?.nModified ?? null,
        before,
        after,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack || err);
  process.exitCode = 1;
});

