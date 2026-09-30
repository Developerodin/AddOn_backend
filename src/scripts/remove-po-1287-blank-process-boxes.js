#!/usr/bin/env node
/**
 * Delete the 13 blank cartons Process created on PO-2026-1287 lot 10730-19092026.
 *
 * Process ignores returned boxes, sees the lot still asking for 13, and inserts empty shells.
 * This removes only those shells: no weight, no cones, no storage slot, no QC status.
 * The original 13 QC-rejected boxes (already returned, weight 0) are left in place.
 *
 * Dry-run is the default.
 *
 *   node src/scripts/remove-po-1287-blank-process-boxes.js
 *   node src/scripts/remove-po-1287-blank-process-boxes.js --apply
 *
 * Run from AddOn_backend on the production server. Aborts unless it finds exactly 13 blank boxes.
 *
 * @file
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnCone, YarnTransaction } from '../models/index.js';

const APPLY = process.argv.includes('--apply');
const PO_NUMBER = 'PO-2026-1287';
const LOT_NUMBER = '10730-19092026';
const EXPECTED_BLANK = 13;
const NOT_RETURNED = { $or: [{ returnedToVendorAt: { $exists: false } }, { returnedToVendorAt: null }] };

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
 * Mongoose 5 uses n / nModified. Newer drivers use deletedCount / modifiedCount.
 * @param {{ modifiedCount?: number, nModified?: number, deletedCount?: number, n?: number }} res
 * @returns {number}
 */
function writeCount(res) {
  return Number(res?.modifiedCount ?? res?.nModified ?? res?.deletedCount ?? res?.n ?? 0);
}

/**
 * Blank Process shells have no weight, cones, slot, or QC decision.
 * @param {Object} box
 * @returns {boolean}
 */
function isBlankShell(box) {
  const weight = Number(box.boxWeight || 0);
  const cones = Number(box.numberOfCones || 0);
  const location = box.storageLocation && String(box.storageLocation).trim();
  return weight <= 0 && cones <= 0 && !location && !box.qcData?.status && !box.returnedToVendorAt;
}

/**
 * @param {{ boxId: string, barcode?: string }} box
 * @returns {Promise<number>}
 */
async function countBoxTransactions(box) {
  return YarnTransaction.countDocuments({
    $or: [{ boxIds: box.boxId }, { orderno: box.boxId }, { boxIds: box.barcode }],
  });
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
 * Find the blank shells and refuse anything that is real stock or the original rejected set.
 * @returns {Promise<Object[]>}
 */
async function findBlankShells() {
  const returnedRejected = await YarnBox.countDocuments({
    poNumber: PO_NUMBER,
    lotNumber: LOT_NUMBER,
    'qcData.status': 'qc_rejected',
    returnedToVendorAt: { $ne: null },
  });
  if (returnedRejected !== EXPECTED_BLANK) {
    throw new Error(
      `Expected ${EXPECTED_BLANK} returned QC-rejected boxes on ${LOT_NUMBER}, found ${returnedRejected}. Aborting.`
    );
  }

  const active = await YarnBox.find({ poNumber: PO_NUMBER, lotNumber: LOT_NUMBER, ...NOT_RETURNED }).lean();
  const blanks = active.filter(isBlankShell);
  const keptAside = active.filter((box) => !isBlankShell(box));
  if (keptAside.length) {
    throw new Error(
      `${keptAside.length} active box(es) on this lot are not blank. Aborting. First: ${keptAside[0].boxId}`
    );
  }
  if (blanks.length === 0) return [];
  if (blanks.length !== EXPECTED_BLANK) {
    throw new Error(`Expected ${EXPECTED_BLANK} blank boxes, found ${blanks.length}. Aborting.`);
  }

  for (const box of blanks) {
    const coneDocs = await YarnCone.countDocuments({ boxId: box.boxId });
    const txCount = await countBoxTransactions(box);
    if (coneDocs || txCount) {
      throw new Error(`${box.boxId} has ${coneDocs} cones and ${txCount} transactions. Aborting.`);
    }
  }
  return blanks;
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  logger.info(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}`);
  await connectMongo();
  const blanks = await findBlankShells();
  if (!blanks.length) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ apply: APPLY, status: 'none', message: 'No blank Process boxes on this lot.' }, null, 2));
    await mongoose.disconnect();
    process.exit(0);
  }

  const boxIds = blanks.map((box) => box.boxId);
  if (!APPLY) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ apply: false, status: 'would_delete', boxes: boxIds.length, boxIds }, null, 2));
    await mongoose.disconnect();
    process.exit(0);
  }

  const res = await YarnBox.deleteMany({ _id: { $in: blanks.map((box) => box._id) } });
  const removed = writeCount(res);
  if (removed !== EXPECTED_BLANK) {
    throw new Error(`Deleted ${removed} boxes, expected ${EXPECTED_BLANK}`);
  }
  const stillBlank = await YarnBox.countDocuments({
    poNumber: PO_NUMBER,
    lotNumber: LOT_NUMBER,
    ...NOT_RETURNED,
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ apply: true, status: 'deleted', boxes: removed, boxIds, activeBoxesLeft: stillBlank }, null, 2));
  await mongoose.disconnect();
  process.exit(0);
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
