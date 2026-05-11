#!/usr/bin/env node
/**
 * One-time fix: unique index on `idempotencyKey` conflicted because explicit `null`
 * values were stored on every session row (duplicate key for idempotencyKey: null).
 *
 * 1. $unset idempotencyKey where it is null
 * 2. Drop old idempotencyKey_1 index (unique+sparse)
 * 3. syncIndexes() so the partial unique index from the model is created
 *
 * Usage (from repo root `AddOn_backend`, with `.env` containing MONGODB_URL):
 *   NODE_ENV=development node src/scripts/fix-yarn-po-vendor-return-idempotency-index.js
 *
 * If your shell exports a bad MONGODB_URL, this script loads `.env` with override so
 * `.env` wins. You can also pass an explicit URI:
 *   node src/scripts/fix-yarn-po-vendor-return-idempotency-index.js --mongo-url="mongodb://..."
 */

// Node 25+ / strict URL parsing: mongodb 3.x driver may throw on multi-host URIs here.
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

import dotenv from 'dotenv';
import path from 'path';

import mongoose from 'mongoose';
import YarnPoVendorReturn from '../models/yarnReq/yarnPoVendorReturn.model.js';

// Prefer `.env` at cwd (where you run `node ...`). `override: true` beats a broken MONGODB_URL in the shell.
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

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
  let u = String(rawUrl || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
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
  const env = sanitizeMongoUrl(String(process.env.MONGODB_URL || ''));
  if (env) return { url: env, source: 'MONGODB_URL (after .env override)' };
  return { url: '', source: 'none' };
}

async function main() {
  const { url: mongoUrl, source } = resolveMongoConnectionString();
  if (!mongoUrl) {
    throw new Error(
      'MongoDB URL is empty. Set MONGODB_URL in AddOn_backend/.env or run from that folder, or pass --mongo-url=mongodb://...'
    );
  }
  if (!/^mongodb(\+srv)?:\/\//.test(mongoUrl)) {
    throw new Error(`MongoDB URL must start with mongodb:// or mongodb+srv:// (source: ${source})`);
  }
  // eslint-disable-next-line no-console -- migration script
  console.log(JSON.stringify({ mongoUrlSource: source, mongoUrlPrefix: mongoUrl.split('@').pop()?.slice(0, 48) }));

  await mongoose.connect(mongoUrl, MONGO_CONNECT_OPTIONS);
  const col = YarnPoVendorReturn.collection;

  const unsetRes = await col.updateMany({ idempotencyKey: null }, { $unset: { idempotencyKey: 1 } });
  const modified = unsetRes.modifiedCount ?? unsetRes.nModified ?? 0;
  const matched = unsetRes.matchedCount ?? unsetRes.n ?? 0;
  // eslint-disable-next-line no-console -- migration script
  console.log(`Unset null idempotencyKey: matched=${matched} modified=${modified}`);

  try {
    await col.dropIndex('idempotencyKey_1');
    // eslint-disable-next-line no-console -- migration script
    console.log('Dropped index idempotencyKey_1');
  } catch (e) {
    // eslint-disable-next-line no-console -- migration script
    console.warn('dropIndex idempotencyKey_1:', e.message);
  }

  await YarnPoVendorReturn.syncIndexes();
  // eslint-disable-next-line no-console -- migration script
  console.log('YarnPoVendorReturn.syncIndexes() ok');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
