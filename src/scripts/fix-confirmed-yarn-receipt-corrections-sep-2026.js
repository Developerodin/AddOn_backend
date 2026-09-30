#!/usr/bin/env node
/**
 * Confirmed yarn receipt corrections (Aloke, 22–23 Sep 2026).
 *
 * 1. PO-2026-1287 lot 10730-19092026 — mark the 13 QC-rejected boxes returned
 *    so 650 kg leaves Unallocated. PO, QC, GRN-2026-0254, and PO-2026-1310 stay.
 * 2. GRN-2026-0263 — issue the next revision without the duplicate 1-bag / 22.76 kg
 *    line. Keep 4 bags / 89.68 kg. Do not touch boxes or GRN-2026-0268.
 * 3. PO-2026-1268 — delete leftover box …MU2607754…-3 (14.4 kg, no slot).
 *    Do not decrement the PO lot box count.
 *
 * Dry-run is the default. Writes happen only with --apply.
 *
 *   node src/scripts/fix-confirmed-yarn-receipt-corrections-sep-2026.js
 *   node src/scripts/fix-confirmed-yarn-receipt-corrections-sep-2026.js --apply
 *   node src/scripts/fix-confirmed-yarn-receipt-corrections-sep-2026.js --mongo-url="mongodb://..." --apply
 *
 * Run from AddOn_backend so .env loads. The script aborts if a fingerprint does not match.
 *
 * @file
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import {
  runConfirmedYarnReceiptCorrections,
  setCorrectionApply,
} from './lib/yarnReceiptCorrectionSep2026.lib.js';

const APPLY = process.argv.includes('--apply');

/**
 * Read `--key=value` from argv.
 * @param {string} prefix
 * @returns {string|null}
 */
function getArg(prefix) {
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) return null;
  return found.slice(prefix.length).trim() || null;
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
  const cli = getArg('--mongo-url=');
  if (cli) return { url: sanitizeMongoUrl(cli), source: '--mongo-url' };
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) return { url: cfg, source: 'config.mongoose.url' };
  return { url: sanitizeMongoUrl(String(process.env.MONGODB_URL || '')), source: 'process.env.MONGODB_URL' };
}

/**
 * @returns {Promise<void>}
 */
async function connectMongo() {
  const { url: u, source } = resolveMongoConnectionString();
  if (!u) throw new Error('MongoDB URL is empty. Set MONGODB_URL or pass --mongo-url=');
  const redacted = u.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`Connecting to MongoDB (${source}): ${redacted}`);
  await mongoose.connect(u, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 30_000 });
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  logger.info(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}`);
  setCorrectionApply(APPLY);
  await connectMongo();
  const { results, verification } = await runConfirmedYarnReceiptCorrections(new Date());
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ apply: APPLY, results, verification }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.error(err);
  try {
    await mongoose.disconnect();
  } catch (disconnectErr) {
    logger.error(disconnectErr);
  }
  process.exit(1);
});
