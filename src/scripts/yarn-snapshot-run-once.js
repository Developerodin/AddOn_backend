#!/usr/bin/env node

/**
 * Run yarn daily closing snapshot once (same logic as cron).
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/yarn-snapshot-run-once.js
 *   NODE_ENV=development node src/scripts/yarn-snapshot-run-once.js --dates=2026-04-21,2026-04-23
 *   NODE_ENV=development node src/scripts/yarn-snapshot-run-once.js --mongo-url=mongodb+srv://...
 *
 * `--dates` writes **current** physical kg under each snapshotDate key (manual backfill when
 * nightly job never ran — not historically reconstructed balances).
 *
 * Node 25+ can make `url.parse()` throw on strings the mongodb 3.x driver builds after SRV lookup,
 * which surfaces as `MongoParseError: URI malformed`. Same workaround as `check-yarn-lt-st-by-barcode.js`.
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
import { runYarnDailySnapshot } from '../cron/yarnDailySnapshot.cron.js';

/**
 * Normalize Mongo URL (quotes, BOM, stray CR) from `.env` paste issues.
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
  if (u.endsWith('>')) {
    u = u.slice(0, -1);
  }
  return u;
}

/**
 * CLI `--mongo-url=` overrides config (same precedence idea as other maintenance scripts).
 * @returns {string}
 */
function resolveMongoUrl() {
  const cliArg = process.argv.find((a) => a.startsWith('--mongo-url='));
  if (cliArg) {
    const v = sanitizeMongoUrl(cliArg.slice('--mongo-url='.length));
    if (v) return v;
  }
  return sanitizeMongoUrl(String(config?.mongoose?.url || ''));
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function parseDatesArg(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const datesArg = process.argv.find((a) => a.startsWith('--dates='));
  const dates = datesArg ? parseDatesArg(datesArg.slice('--dates='.length)) : [];

  const mongoUrl = resolveMongoUrl();
  if (!mongoUrl) {
    throw new Error('No MongoDB URL: set MONGODB_URL in .env or pass --mongo-url=');
  }
  await mongoose.connect(mongoUrl, config.mongoose.options);

  if (!dates.length) {
    const out = await runYarnDailySnapshot({});
    console.log(JSON.stringify(out, null, 2));
  } else {
    for (const d of dates) {
      const out = await runYarnDailySnapshot({ snapshotDate: d });
      console.log(JSON.stringify(out, null, 2));
    }
  }

  await mongoose.connection.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
