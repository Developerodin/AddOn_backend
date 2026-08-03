#!/usr/bin/env node
/**
 * Restore a mistakenly zeroed-out YarnBox to a fresh sealed LT box (pre–ST-transfer state).
 *
 * - Sets boxWeight, grossWeight, tearweight, numberOfCones on the box
 * - Clears storage / coneData / vendor-return flags
 * - Deletes any YarnCone rows for the box (erroneous zero-out or mistaken ST cones)
 * - Uses `updateOne` to bypass pre/post-save hooks (same as zero-out script)
 *
 * Usage:
 *   node src/scripts/restore-fresh-yarn-box-by-barcode.js \
 *     --barcode=69eb05b786f7ddd153e2e83b \
 *     --cones=18 --net-weight=20.29 --gross-weight=22.7 --dry-run
 *   node src/scripts/restore-fresh-yarn-box-by-barcode.js \
 *     --barcode=69eb05b786f7ddd153e2e83b \
 *     --cones=18 --net-weight=20.29 --gross-weight=22.7 --apply
 *
 * Flags:
 *   --barcode=ID[,ID...]   Required. YarnBox.barcode value(s).
 *   --box-id=ID[,ID...]    Alternative lookup by YarnBox.boxId.
 *   --cones=N              Cone count on the sealed box (default 18).
 *   --net-weight=KG        Net box weight → boxWeight + initialBoxWeight (default 20.29).
 *   --gross-weight=KG      Gross weight (default 22.7). tearweight = gross − net.
 *   --dry-run              Preview only (default unless --apply).
 *   --apply                Persist box restore + cone deletes + inventory sync.
 *   --force                Allow restore even when active ST/issued cones exist.
 *   --mongo-url=URL        Override MongoDB URI.
 *
 * @file
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnCone, YarnCatalog } from '../models/index.js';
import { syncInventoriesFromStorageForCatalogIds } from '../services/yarnManagement/yarnInventory.service.js';
import { activeYarnBoxMatch } from '../services/yarnManagement/yarnStockActiveFilters.js';
import { yarnConeUnavailableIssueStatuses } from '../models/yarnReq/yarnCone.model.js';

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

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

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
 * Split comma-separated CLI list values.
 * @param {string | null | undefined} raw
 * @returns {string[]}
 */
function splitList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse a required positive number CLI arg.
 * @param {string | null | undefined} raw
 * @param {string} label
 * @returns {number}
 */
function parseRequiredNumber(raw, label) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
  return n;
}

/**
 * Resolve YarnBox documents from barcode and/or boxId lists.
 * @param {{ barcodes: string[]; boxIds: string[] }} params
 * @returns {Promise<import('mongoose').LeanDocument[]>}
 */
async function resolveBoxes({ barcodes, boxIds }) {
  /** @type {Map<string, import('mongoose').LeanDocument>} */
  const byKey = new Map();

  for (const barcode of barcodes) {
    const box = await YarnBox.findOne({ barcode, ...activeYarnBoxMatch }).lean();
    if (box) byKey.set(String(box._id), box);
    else if (mongoose.Types.ObjectId.isValid(barcode)) {
      const byId = await YarnBox.findById(barcode).lean();
      if (byId && !byId.returnedToVendorAt) byKey.set(String(byId._id), byId);
    }
  }

  for (const boxId of boxIds) {
    const box = await YarnBox.findOne({ boxId, ...activeYarnBoxMatch }).lean();
    if (box) byKey.set(String(box._id), box);
  }

  return [...byKey.values()];
}

/**
 * Build the target fresh sealed box payload.
 * @param {{ netWeight: number; grossWeight: number; numberOfCones: number }} params
 * @returns {Record<string, unknown>}
 */
function buildFreshBoxPayload({ netWeight, grossWeight, numberOfCones }) {
  const tearweight = Number((grossWeight - netWeight).toFixed(3));
  return {
    boxWeight: netWeight,
    grossWeight,
    tearweight: tearweight >= 0 ? tearweight : 0,
    initialBoxWeight: netWeight,
    numberOfCones,
    storedStatus: false,
    storageLocation: '',
    returnedToVendorAt: null,
    vendorReturnId: null,
  };
}

/**
 * Returns a block reason when cones are not safe to delete, unless `--force`.
 * @param {import('mongoose').LeanDocument[]} cones
 * @param {boolean} force
 * @returns {string | null}
 */
function validateConesRemovable(cones, force) {
  if (force || cones.length === 0) return null;
  const risky = cones.filter((c) => {
    const hasSlot = c.coneStorageId && String(c.coneStorageId).trim();
    const issued = yarnConeUnavailableIssueStatuses.includes(String(c.issueStatus || ''));
    const hasWeight = Number(c.coneWeight ?? 0) > 0;
    return hasSlot || (issued && hasWeight);
  });
  if (risky.length > 0) {
    return `${risky.length} cone(s) have ST slot / issued weight — pass --force to delete anyway`;
  }
  return null;
}

/**
 * Resolve YarnCatalog ids for inventory sync after cone deletes.
 * @param {import('mongoose').LeanDocument} box
 * @param {import('mongoose').LeanDocument[]} cones
 * @returns {Promise<string[]>}
 */
async function resolveCatalogIdsForSync(box, cones) {
  /** @type {Set<string>} */
  const out = new Set();
  if (box.yarnCatalogId && mongoose.Types.ObjectId.isValid(box.yarnCatalogId)) {
    out.add(String(box.yarnCatalogId));
  }
  for (const c of cones) {
    if (c.yarnCatalogId && mongoose.Types.ObjectId.isValid(c.yarnCatalogId)) {
      out.add(String(c.yarnCatalogId));
    }
  }
  if (out.size > 0) return [...out];
  const name = box.yarnName && String(box.yarnName).trim();
  if (!name) return [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
 * Preview or apply restore for one YarnBox.
 * @param {{ box: import('mongoose').LeanDocument; apply: boolean; force: boolean; netWeight: number; grossWeight: number; numberOfCones: number }} params
 * @returns {Promise<Record<string, unknown>>}
 */
async function processBox({ box, apply, force, netWeight, grossWeight, numberOfCones }) {
  const boxId = String(box.boxId);
  const cones = await YarnCone.find({ boxId }).sort({ _id: 1 }).lean();
  const coneBlock = validateConesRemovable(cones, force);
  const after = buildFreshBoxPayload({ netWeight, grossWeight, numberOfCones });

  const preview = {
    barcode: box.barcode,
    boxId,
    poNumber: box.poNumber,
    lotNumber: box.lotNumber,
    yarnName: box.yarnName,
    before: {
      boxWeight: box.boxWeight ?? 0,
      grossWeight: box.grossWeight ?? 0,
      tearweight: box.tearweight ?? 0,
      initialBoxWeight: box.initialBoxWeight ?? null,
      numberOfCones: box.numberOfCones ?? 0,
      storedStatus: Boolean(box.storedStatus),
      storageLocation: box.storageLocation ?? '',
      coneData: box.coneData ?? null,
      returnedToVendorAt: box.returnedToVendorAt ?? null,
    },
    after,
    conesFound: cones.length,
    conesSample: cones.slice(0, 5).map((c) => ({
      _id: String(c._id),
      issueStatus: c.issueStatus,
      coneWeight: c.coneWeight,
      coneStorageId: c.coneStorageId ?? null,
    })),
    coneBlock,
  };

  if (coneBlock) {
    return { ...preview, status: 'blocked', reason: coneBlock };
  }

  if (!apply) {
    return { ...preview, status: 'would_restore', conesToDelete: cones.length };
  }

  let conesDeleted = 0;
  if (cones.length > 0) {
    const deleteRes = await YarnCone.deleteMany({ boxId });
    conesDeleted = deleteRes.deletedCount ?? 0;
  }

  await YarnBox.updateOne(
    { _id: box._id },
    {
      $set: after,
      $unset: {
        coneData: '',
      },
    }
  );

  const catalogIds = await resolveCatalogIdsForSync(box, cones);
  if (catalogIds.length > 0) {
    await syncInventoriesFromStorageForCatalogIds(catalogIds.map((id) => new mongoose.Types.ObjectId(id)));
  }

  const updated = await YarnBox.findById(box._id).lean();

  return {
    ...preview,
    status: 'restored',
    conesDeleted,
    inventoryCatalogsSynced: catalogIds.length,
    boxAfter: {
      boxWeight: updated?.boxWeight,
      grossWeight: updated?.grossWeight,
      tearweight: updated?.tearweight,
      numberOfCones: updated?.numberOfCones,
      storedStatus: updated?.storedStatus,
      storageLocation: updated?.storageLocation,
      coneData: updated?.coneData ?? null,
    },
  };
}

/**
 * @returns {void}
 */
function printUsage() {
  // eslint-disable-next-line no-console
  console.error(
    'Usage: node src/scripts/restore-fresh-yarn-box-by-barcode.js --barcode=ID [--cones=18] [--net-weight=20.29] [--gross-weight=22.7] [--dry-run|--apply] [--force] [--mongo-url=]'
  );
}

async function main() {
  const barcodes = splitList(getArg('--barcode='));
  const boxIds = splitList(getArg('--box-id='));
  const numberOfCones = parseRequiredNumber(getArg('--cones=') ?? '18', '--cones');
  const netWeight = parseRequiredNumber(getArg('--net-weight=') ?? '20.29', '--net-weight');
  const grossWeight = parseRequiredNumber(getArg('--gross-weight=') ?? '22.7', '--gross-weight');

  if (barcodes.length === 0 && boxIds.length === 0) {
    printUsage();
    process.exit(1);
  }

  if (grossWeight < netWeight) {
    throw new Error(`--gross-weight (${grossWeight}) must be >= --net-weight (${netWeight})`);
  }

  await connectMongo();

  try {
    const boxes = await resolveBoxes({ barcodes, boxIds });
    if (boxes.length === 0) {
      throw new Error('No matching YarnBox documents found');
    }

    logger.info(
      `Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} | boxes=${boxes.length} | cones=${numberOfCones} | net=${netWeight} | gross=${grossWeight}`
    );

    /** @type {Record<string, unknown>[]} */
    const results = [];
    for (const box of boxes) {
      results.push(
        await processBox({
          box,
          apply: APPLY,
          force: FORCE,
          netWeight,
          grossWeight,
          numberOfCones,
        })
      );
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, mode: APPLY ? 'apply' : 'dry-run', results }, null, 2));

    if (!APPLY) {
      // eslint-disable-next-line no-console
      console.log('(No writes: pass --apply to persist.)');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
