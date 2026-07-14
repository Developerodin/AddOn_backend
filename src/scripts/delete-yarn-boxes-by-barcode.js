#!/usr/bin/env node
/**
 * Hard-delete one or more YarnBox rows (and their cones / related transactions) by barcode.
 *
 * Default barcodes (override with --barcode=id1,id2,...):
 *   6a48f0088fda2c72642913e1
 *   6a48f0088fda2c72642913e2
 *   6a48f0088fda2c72642913e3
 *
 * Usage:
 *   node src/scripts/delete-yarn-boxes-by-barcode.js
 *   node src/scripts/delete-yarn-boxes-by-barcode.js --barcode=6a48f0088fda2c72642913e1,6a48f0088fda2c72642913e2 --apply
 *   node src/scripts/delete-yarn-boxes-by-barcode.js --apply --force
 *
 * Flags:
 *   --barcode=ID[,ID...]  Box barcodes to delete (defaults to the three ids above).
 *   --apply               Perform deletes (default is dry-run preview).
 *   --force               Allow delete even when box has weight, storage, or cones.
 *   --mongo-url=URL       Override MongoDB URI.
 *
 * @file
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnCone, YarnPurchaseOrder, YarnTransaction } from '../models/index.js';
import { syncInventoriesFromStorageForCatalogIds } from '../services/yarnManagement/yarnInventory.service.js';
import { getUnusedPlaceholderArchiveBlockReason } from '../services/yarnManagement/yarnBox.service.js';

const DEFAULT_BARCODES = [
  '6a48f0088fda2c72642913e1',
  '6a48f0088fda2c72642913e2',
  '6a48f0088fda2c72642913e3',
];

/**
 * Reads `--prefix=value` CLI args.
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
 * Connect to MongoDB.
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
 * Parse comma-separated barcodes into trimmed non-empty strings.
 * @param {string} raw
 * @returns {string[]}
 */
function parseBarcodes(raw) {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve YarnBox by barcode (exact, case-insensitive, or Mongo _id fallback).
 * @param {string} barcode
 * @returns {Promise<import('mongoose').LeanDocument | null>}
 */
async function findBoxByBarcode(barcode) {
  const trimmed = String(barcode || '').trim();
  if (!trimmed) return null;

  let box = await YarnBox.findOne({ barcode: trimmed }).lean();
  if (!box) {
    const esc = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    box = await YarnBox.findOne({ barcode: new RegExp(`^${esc}$`, 'i') }).lean();
  }
  if (!box && mongoose.Types.ObjectId.isValid(trimmed)) {
    box = await YarnBox.findById(trimmed).lean();
  }
  return box;
}

/**
 * Collect unique yarn catalog ids from box/cone docs.
 * @param {Array<{ yarnCatalogId?: unknown }>} docs
 * @returns {string[]}
 */
function catalogIdsFromDocs(docs) {
  const set = new Set();
  for (const d of docs) {
    const id = d?.yarnCatalogId;
    if (id != null && mongoose.Types.ObjectId.isValid(String(id))) {
      set.add(String(id));
    }
  }
  return [...set];
}

/**
 * Build YarnTransaction filter for a box and its cones.
 * @param {string} boxId
 * @param {import('mongoose').Types.ObjectId[]} coneIds
 * @returns {Record<string, unknown>|null}
 */
function buildTransactionFilter(boxId, coneIds) {
  const parts = [];
  if (boxId) {
    parts.push({ orderno: boxId }, { boxIds: boxId });
  }
  if (coneIds.length) {
    parts.push({ conesIdsArray: { $in: coneIds } });
  }
  return parts.length ? { $or: parts } : null;
}

/**
 * Preview or delete a single box by barcode.
 * @param {{ barcode: string, apply: boolean, force: boolean }} params
 * @returns {Promise<Record<string, unknown>>}
 */
async function processBox({ barcode, apply, force }) {
  const box = await findBoxByBarcode(barcode);
  if (!box) {
    return { barcode, status: 'not_found' };
  }

  const boxId = String(box.boxId);
  const cones = await YarnCone.find({ boxId }).lean();
  const coneIds = cones.map((c) => c._id);
  const txFilter = buildTransactionFilter(boxId, coneIds);
  const txCount = txFilter ? await YarnTransaction.countDocuments(txFilter) : 0;
  const placeholderBlock = getUnusedPlaceholderArchiveBlockReason(box);

  const preview = {
    barcode: box.barcode,
    mongoId: String(box._id),
    boxId,
    poNumber: box.poNumber,
    lotNumber: box.lotNumber,
    yarnName: box.yarnName,
    boxWeight: box.boxWeight,
    grossWeight: box.grossWeight,
    numberOfCones: box.numberOfCones,
    storedStatus: box.storedStatus,
    storageLocation: box.storageLocation,
    returnedToVendorAt: box.returnedToVendorAt,
    coneCount: cones.length,
    transactionCount: txCount,
    placeholderBlockReason: placeholderBlock,
    canDeleteWithoutForce: placeholderBlock == null && cones.length === 0,
  };

  if (!apply) {
    return { ...preview, status: 'would_delete' };
  }

  if (!force && (placeholderBlock || cones.length > 0)) {
    return {
      ...preview,
      status: 'blocked',
      reason: placeholderBlock || 'Box has yarn cones recorded (pass --force to delete anyway)',
    };
  }

  if (coneIds.length) {
    const rCones = await YarnCone.deleteMany({ _id: { $in: coneIds } });
    preview.conesDeleted = rCones.deletedCount;
  } else {
    preview.conesDeleted = 0;
  }

  if (txFilter) {
    const rTx = await YarnTransaction.deleteMany(txFilter);
    preview.transactionsDeleted = rTx.deletedCount;
  } else {
    preview.transactionsDeleted = 0;
  }

  const rBox = await YarnBox.deleteOne({ _id: box._id });
  if (!rBox.deletedCount) {
    return { ...preview, status: 'failed', reason: 'YarnBox deleteOne returned 0' };
  }

  const lotTrim = box.lotNumber != null ? String(box.lotNumber).trim() : '';
  if (lotTrim && box.poNumber) {
    await YarnPurchaseOrder.updateOne(
      { poNumber: box.poNumber },
      { $inc: { 'receivedLotDetails.$[lot].numberOfBoxes': -1 } },
      { arrayFilters: [{ 'lot.lotNumber': lotTrim }] }
    );
    preview.poLotBoxCountDecremented = true;
  }

  const catalogIds = [...new Set([...catalogIdsFromDocs([box]), ...catalogIdsFromDocs(cones)])];
  if (catalogIds.length) {
    await syncInventoriesFromStorageForCatalogIds(catalogIds.map((id) => new mongoose.Types.ObjectId(id)));
    preview.inventoryCatalogsSynced = catalogIds.length;
  }

  return { ...preview, status: 'deleted' };
}

/**
 * @returns {void}
 */
function printUsage() {
  // eslint-disable-next-line no-console
  console.error(
    'Usage: node src/scripts/delete-yarn-boxes-by-barcode.js [--barcode=id1,id2,...] [--apply] [--force] [--mongo-url=]'
  );
}

async function main() {
  const barcodeArg = getArg('--barcode=');
  const APPLY = process.argv.includes('--apply');
  const FORCE = process.argv.includes('--force');
  const barcodes = barcodeArg ? parseBarcodes(barcodeArg) : DEFAULT_BARCODES;

  if (!barcodes.length) {
    printUsage();
    process.exit(1);
  }

  logger.info(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} | force=${FORCE} | barcodes=${barcodes.length}`);

  await connectMongo();

  /** @type {Record<string, unknown>[]} */
  const results = [];

  try {
    for (const barcode of barcodes) {
      const result = await processBox({ barcode, apply: APPLY, force: FORCE });
      results.push(result);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result, null, 2));
    }

    const summary = {
      total: results.length,
      notFound: results.filter((r) => r.status === 'not_found').length,
      wouldDelete: results.filter((r) => r.status === 'would_delete').length,
      deleted: results.filter((r) => r.status === 'deleted').length,
      blocked: results.filter((r) => r.status === 'blocked').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ summary }, null, 2));

    if (!APPLY) {
      // eslint-disable-next-line no-console
      console.log('(No writes: pass --apply to delete. Use --force if boxes have weight/cones/storage.)');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
