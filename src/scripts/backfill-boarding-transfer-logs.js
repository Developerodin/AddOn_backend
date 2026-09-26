#!/usr/bin/env node

/**
 * Insert missing Boarding outbound article_logs so Daily Production Summary
 * Boarding rows match completed punches. Does NOT change article.floorQuantities
 * (transferred qty is already correct; only the transfer log insert failed).
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Local:
 *   NODE_ENV=development node src/scripts/backfill-boarding-transfer-logs.js \
 *     --mongo-url="mongodb://127.0.0.1:27017/addon"
 *   NODE_ENV=development node src/scripts/backfill-boarding-transfer-logs.js \
 *     --mongo-url="mongodb://127.0.0.1:27017/addon" --apply
 *
 * Production (pass URL yourself — do not commit passwords):
 *   NODE_ENV=production node src/scripts/backfill-boarding-transfer-logs.js \
 *     --mongo-url="mongodb+srv://USER:PASS@HOST/DB"
 *   NODE_ENV=production node src/scripts/backfill-boarding-transfer-logs.js \
 *     --mongo-url="mongodb+srv://USER:PASS@HOST/DB" --apply
 *
 * Or set MONGODB_URL (never print the raw URL; this script redacts credentials).
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { runBoardingTransferBackfill } from './lib/backfillBoardingTransferLogs.lib.js';

const APPLY = process.argv.includes('--apply');

const MONGO_CONNECT_OPTIONS = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000,
};

/**
 * @param {string} prefix
 * @returns {string|null}
 */
function getArg(prefix) {
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) return null;
  return found.slice(prefix.length).trim() || null;
}

/**
 * Strip quotes/BOM. Do not log the result if it contains credentials.
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
 * @param {string} url
 * @returns {string}
 */
function redactMongoUrl(url) {
  return String(url || '').replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
}

/**
 * CLI --mongo-url= wins, then config.mongoose.url, then MONGODB_URL.
 * Does not read ATLAS_MONGODB_URL.
 * @returns {{ url: string, source: string }}
 */
function resolveMongoConnectionString() {
  const cli = sanitizeMongoUrl(getArg('--mongo-url=') || '');
  if (cli) return { url: cli, source: '--mongo-url' };
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) return { url: cfg, source: 'config.mongoose.url' };
  return {
    url: sanitizeMongoUrl(String(process.env.MONGODB_URL || '')),
    source: 'process.env.MONGODB_URL',
  };
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const { url, source } = resolveMongoConnectionString();
  if (!url) throw new Error('MongoDB URL missing. Set MONGODB_URL or pass --mongo-url=');

  logger.info(`[backfill-boarding-transfer-logs] Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} (${source})`);
  logger.info(`[backfill-boarding-transfer-logs] Mongo: ${redactMongoUrl(url)}`);

  await mongoose.connect(url, MONGO_CONNECT_OPTIONS);
  try {
    const result = await runBoardingTransferBackfill({ apply: APPLY });
    logger.info(
      `[backfill-boarding-transfer-logs] punches scanned=${result.punchesScanned} ` +
        `already had transfer=${result.alreadyHadTransfer} ` +
        `${APPLY ? 'inserted' : 'would insert'}=${APPLY ? result.inserted : result.wouldInsert} ` +
        `skipped unresolved=${result.skippedUnresolved}`
    );
    logger.info(`[backfill-boarding-transfer-logs] qty by IST date: ${JSON.stringify(result.qtyByIstDate)}`);
    logger.info(
      `[backfill-boarding-transfer-logs] destination floors: ${JSON.stringify(result.destinationFloorCounts)}`
    );
    if (result.unresolvedArticleNumbers.length) {
      logger.warn(
        `[backfill-boarding-transfer-logs] unresolved articles: ${result.unresolvedArticleNumbers.join(', ')}`
      );
    }
    if (!APPLY && result.sample.length) {
      logger.info(`[backfill-boarding-transfer-logs] sample rows:\n${JSON.stringify(result.sample, null, 2)}`);
    }
    if (!APPLY) {
      logger.warn('DRY RUN — no DB writes. Re-run with --apply to commit.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
