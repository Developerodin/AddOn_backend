#!/usr/bin/env node
/**
 * Remove mistakenly generated YarnCone rows from fresh sealed LT boxes.
 *
 * Use when cones were auto-generated and bulk-marked `used` (zero weight, no ST slot,
 * no production order) while the box still sits in long-term storage with full weight.
 *
 * Keeps the YarnBox document intact; only deletes cone rows and clears coneData.
 *
 * Usage (from AddOn_backend):
 *   NODE_ENV=development node src/scripts/remove-mistaken-lt-box-cones.js \
 *     --barcode=69944cb1f0a2c8b07dc3fda0,6994580ef0a2c8b07dc41cf5 --dry-run
 *   NODE_ENV=development node src/scripts/remove-mistaken-lt-box-cones.js \
 *     --barcode=69944cb1f0a2c8b07dc3fda0,6994580ef0a2c8b07dc41cf5 --apply
 *   NODE_ENV=development node src/scripts/remove-mistaken-lt-box-cones.js --po=PO-2026-997 --apply
 *
 * Flags:
 *   --barcode=ID[,ID...]  YarnBox.barcode values (Mongo _id strings)
 *   --box-id=ID[,ID...]   YarnBox.boxId values
 *   --po=PO-NUMBER        All active boxes on PO that match false-used LT pattern
 *   --dry-run             Preview only (default unless --apply)
 *   --apply               Delete cones + align box coneData + inventory sync
 *   --force               Skip safety validation (cones with weight/order/ST slot)
 *   --mongo-url=          Override Mongo URL
 *
 * @file
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnCone, YarnCatalog } from '../models/index.js';
import { syncInventoriesFromStorageForCatalogIds } from '../services/yarnManagement/yarnInventory.service.js';
import { activeYarnBoxMatch, activeYarnConeMatch } from '../services/yarnManagement/yarnStockActiveFilters.js';
import {
  isBoxStillInLt,
  isMismarkedUsedByMigration,
  validateRemovableMistakenCones,
} from './lib/yarnFalseUsedCone.lib.js';

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
 * Parse comma-separated CLI values.
 * @param {string|null} raw
 * @returns {string[]}
 */
function parseList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve YarnBox by barcode (exact, _id fallback).
 * @param {string} barcode
 * @returns {Promise<import('mongoose').LeanDocument | null>}
 */
async function findBoxByBarcode(barcode) {
  const trimmed = String(barcode || '').trim();
  if (!trimmed) return null;

  let box = await YarnBox.findOne({ barcode: trimmed, ...activeYarnBoxMatch }).lean();
  if (!box && mongoose.Types.ObjectId.isValid(trimmed)) {
    box = await YarnBox.findById(trimmed).lean();
    if (box?.returnedToVendorAt) return null;
  }
  return box;
}

/**
 * Collect YarnCatalog ids for inventory sync.
 * @param {Array<{ yarnCatalogId?: import('mongoose').Types.ObjectId | null; yarnName?: string | null }>} docs
 * @returns {Promise<string[]>}
 */
async function resolveCatalogIdsForSync(docs) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const d of docs) {
    const id = d?.yarnCatalogId;
    if (id != null && mongoose.Types.ObjectId.isValid(id)) {
      out.add(String(id));
    }
  }
  if (out.size > 0) return [...out];

  const name = docs.find((d) => d.yarnName && String(d.yarnName).trim())?.yarnName;
  if (!name) return [];
  const escaped = String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cat = await YarnCatalog.findOne({
    yarnName: { $regex: new RegExp(`^${escaped}$`, 'i') },
    status: { $ne: 'deleted' },
  })
    .select('_id')
    .lean();
  if (cat?._id) out.add(String(cat._id));
  return [...out];
}

/**
 * Resolve target boxes from CLI args.
 * @returns {Promise<import('mongoose').LeanDocument[]>}
 */
async function resolveTargetBoxes() {
  const barcodes = parseList(getArg('--barcode='));
  const boxIds = parseList(getArg('--box-id='));
  const po = getArg('--po=');

  /** @type {Map<string, import('mongoose').LeanDocument>} */
  const byBoxId = new Map();

  for (const barcode of barcodes) {
    const box = await findBoxByBarcode(barcode);
    if (!box) {
      logger.warn(`YarnBox not found for barcode=${barcode}`);
      continue;
    }
    byBoxId.set(String(box.boxId), box);
  }

  for (const boxId of boxIds) {
    const box = await YarnBox.findOne({ boxId, ...activeYarnBoxMatch }).lean();
    if (!box) {
      logger.warn(`YarnBox not found for boxId=${boxId}`);
      continue;
    }
    byBoxId.set(String(box.boxId), box);
  }

  if (po) {
    const poBoxes = await YarnBox.find({ poNumber: po, ...activeYarnBoxMatch }).lean();
    for (const box of poBoxes) {
      if (!isBoxStillInLt(box)) continue;
      const cones = await YarnCone.find({ boxId: box.boxId, ...activeYarnConeMatch }).lean();
      if (!cones.length) continue;
      const allMismarked = cones.every(isMismarkedUsedByMigration);
      if (allMismarked) {
        byBoxId.set(String(box.boxId), box);
      }
    }
  }

  return [...byBoxId.values()];
}

/**
 * Preview or apply cone removal for one box.
 * @param {{ box: import('mongoose').LeanDocument; apply: boolean; force: boolean }} params
 * @returns {Promise<Record<string, unknown>>}
 */
async function processBox({ box, apply, force }) {
  const boxId = String(box.boxId);
  const cones = await YarnCone.find({ boxId, ...activeYarnConeMatch }).sort({ _id: 1 }).lean();
  const validationError = validateRemovableMistakenCones(box, cones, force);

  const issueSummary = cones.reduce((acc, c) => {
    const st = String(c.issueStatus || 'unknown');
    acc[st] = (acc[st] || 0) + 1;
    return acc;
  }, /** @type {Record<string, number>} */ ({}));

  const preview = {
    barcode: box.barcode,
    boxId,
    poNumber: box.poNumber,
    yarnName: box.yarnName,
    storageLocation: box.storageLocation,
    boxWeight: box.boxWeight,
    numberOfCones: box.numberOfCones,
    coneDataBefore: box.coneData ?? null,
    coneCount: cones.length,
    issueSummaryBefore: issueSummary,
    mismarkedUsedCount: cones.filter(isMismarkedUsedByMigration).length,
    validationError,
  };

  if (!cones.length) {
    return { ...preview, status: 'skipped', reason: 'no cones to remove' };
  }

  if (validationError && !force) {
    return { ...preview, status: 'blocked', reason: validationError };
  }

  if (!apply) {
    return {
      ...preview,
      status: 'would_delete',
      conesToDelete: cones.map((c) => ({ _id: String(c._id), barcode: c.barcode, issueStatus: c.issueStatus })),
      boxAfter: {
        coneData: { conesIssued: false },
        numberOfCones: box.numberOfCones,
      },
    };
  }

  const coneIds = cones.map((c) => c._id);
  const deleteRes = await YarnCone.deleteMany({ _id: { $in: coneIds } });

  await YarnBox.updateOne(
    { boxId, ...activeYarnBoxMatch },
    {
      $set: {
        'coneData.conesIssued': false,
      },
      $unset: {
        'coneData.numberOfCones': '',
        'coneData.coneIssueDate': '',
        'coneData.coneIssueBy': '',
      },
    }
  );

  const catalogIds = await resolveCatalogIdsForSync([box, ...cones]);
  if (catalogIds.length > 0) {
    await syncInventoriesFromStorageForCatalogIds(catalogIds.map((id) => new mongoose.Types.ObjectId(id)));
  }

  const remaining = await YarnCone.countDocuments({ boxId, ...activeYarnConeMatch });
  const updatedBox = await YarnBox.findOne({ boxId, ...activeYarnBoxMatch }).select('coneData numberOfCones').lean();

  return {
    ...preview,
    status: 'fixed',
    conesDeleted: deleteRes.deletedCount,
    remainingCones: remaining,
    coneDataAfter: updatedBox?.coneData ?? null,
    inventoryCatalogsSynced: catalogIds.length,
  };
}

/**
 * @returns {void}
 */
function printUsage() {
  // eslint-disable-next-line no-console
  console.error(
    'Usage: node src/scripts/remove-mistaken-lt-box-cones.js (--barcode=ID[,ID...] | --box-id=ID[,ID...] | --po=PO) [--dry-run|--apply] [--force] [--mongo-url=]'
  );
}

async function main() {
  const APPLY = process.argv.includes('--apply');
  const FORCE = process.argv.includes('--force');
  const hasTarget =
    getArg('--barcode=') || getArg('--box-id=') || getArg('--po=');

  if (!hasTarget) {
    printUsage();
    process.exit(1);
  }

  logger.info(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} | force=${FORCE}`);

  await connectMongo();

  /** @type {Record<string, unknown>[]} */
  const results = [];

  try {
    const boxes = await resolveTargetBoxes();
    if (!boxes.length) {
      throw new Error('No target boxes resolved. Check barcodes/box-ids/PO filter.');
    }

    for (const box of boxes) {
      const result = await processBox({ box, apply: APPLY, force: FORCE });
      results.push(result);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result, null, 2));
    }

    const summary = {
      total: results.length,
      wouldDelete: results.filter((r) => r.status === 'would_delete').length,
      fixed: results.filter((r) => r.status === 'fixed').length,
      blocked: results.filter((r) => r.status === 'blocked').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ summary }, null, 2));

    if (!APPLY) {
      // eslint-disable-next-line no-console
      console.log('(No writes: pass --apply to delete mistaken cones.)');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
