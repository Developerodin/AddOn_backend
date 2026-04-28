#!/usr/bin/env node

/**
 * Fix a wrong `activeItems[].quantity` value inside a ContainersMaster document.
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/fix-container-activeitem-qty.js --_id=699865138112b2ead70340c2 --value=67
 *   NODE_ENV=development node src/scripts/fix-container-activeitem-qty.js --_id=699865138112b2ead70340c2 --value=67 --write
 *
 * Optional:
 *   --index=0            Which activeItems[] row to update (default: 0)
 *   --mongo-url=...      Override MongoDB URL
 *
 * Notes:
 * - Default is DRY RUN. Pass `--write` to persist.
 * - MongoDB URL resolution: --mongo-url -> config.mongoose.url (from .env) -> process.env.MONGODB_URL
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
import ContainersMaster from '../models/production/containersMaster.model.js';

/** Same subset as `src/index.js` — required so mongodb+srv parses with the new URL parser. */
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
 * Resolve connection string: CLI wins, then app config, then env.
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
  const { url: mongoUrl, source } = resolveMongoConnectionString();
  if (!mongoUrl) {
    throw new Error('MongoDB URL is empty. Set MONGODB_URL in .env or pass --mongo-url=');
  }
  if (!/^mongodb(\+srv)?:\/\//.test(mongoUrl)) {
    throw new Error(`MongoDB URL looks invalid. Got: ${mongoUrl.slice(0, 32)}...`);
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
 * @param {string} name
 * @returns {number}
 */
function parseFiniteNumber(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}: ${String(v)}`);
  return n;
}

/**
 * @param {unknown} doc
 * @returns {{ activeItemsLen: number, activeItems: Array<{ quantity: number, article?: string|null, vendorProductionFlow?: string|null }> }}
 */
function snapshotContainer(doc) {
  const items = Array.isArray(doc?.activeItems) ? doc.activeItems : [];
  return {
    activeItemsLen: items.length,
    activeItems: items.map((it) => ({
      quantity: Number(it?.quantity ?? 0),
      article: it?.article ? String(it.article) : null,
      vendorProductionFlow: it?.vendorProductionFlow ? String(it.vendorProductionFlow) : null,
    })),
  };
}

async function main() {
  const containerId = readArg('_id');
  if (!containerId) throw new Error('Provide --_id=<containerObjectId>.');

  const value = parseFiniteNumber(readArg('value') ?? '67', 'value');
  const index = parseFiniteNumber(readArg('index') ?? '0', 'index');
  const write = process.argv.includes('--write');

  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid --index: ${index} (must be a non-negative integer)`);
  }
  if (value <= 0) {
    throw new Error(`Invalid --value: ${value} (must be > 0 to satisfy schema min 0.0001)`);
  }

  await connectMongo();

  const doc = await ContainersMaster.findOne({ _id: containerId }).lean();
  if (!doc) throw new Error(`Container not found: ${containerId}`);

  const before = snapshotContainer(doc);
  if (index >= before.activeItemsLen) {
    throw new Error(`Container has ${before.activeItemsLen} activeItems; cannot update index ${index}.`);
  }

  const updatePath = `activeItems.${index}.quantity`;
  const update = { $set: { [updatePath]: value } };

  if (!write) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          _id: containerId,
          index,
          path: updatePath,
          value,
          before,
          hint: 'Re-run with --write to persist.',
        },
        null,
        2,
      ),
    );
    await mongoose.disconnect();
    return;
  }

  const res = await ContainersMaster.updateOne({ _id: containerId }, update);
  const afterDoc = await ContainersMaster.findOne({ _id: containerId }).lean();
  const after = snapshotContainer(afterDoc);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: false,
        _id: containerId,
        index,
        path: updatePath,
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

