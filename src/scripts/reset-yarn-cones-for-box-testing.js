#!/usr/bin/env node
/**
 * Reset all YarnCone rows for a box to a **test-friendly** state: `not_issued`, random
 * cone/tear weights, cleared ST slot + issue metadata. Then recalculates YarnInventory ST
 * from storage (same pattern as `mark-yarn-cones-used-from-excel.js`).
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/reset-yarn-cones-for-box-testing.js \
 *     --box-id="BOX-PO-2026-1013-NC/1516-1772181218639-4" --dry-run
 *   NODE_ENV=development node src/scripts/reset-yarn-cones-for-box-testing.js \
 *     --box-id="BOX-PO-2026-1013-NC/1516-1772181218639-4" --apply
 *
 * Flags:
 *   --box-id=     Required YarnBox.boxId / YarnCone.boxId string.
 *   --dry-run     Default unless --apply is passed. Prints preview only.
 *   --apply       Persist updates + inventory sync + optional box coneData refresh.
 *   --mongo-url=  Override Mongo URL (else config.mongoose.url / MONGODB_URL).
 *   --seed=N      Optional integer seed for deterministic pseudo-random weights.
 *   --no-box      Skip YarnBox `numberOfCones` / `coneData` alignment for this boxId.
 *
 * @file
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnCone, YarnBox, YarnCatalog } from '../models/index.js';
import { syncInventoriesFromStorageForCatalogIds } from '../services/yarnManagement/yarnInventory.service.js';
import { activeYarnBoxMatch, activeYarnConeMatch } from '../services/yarnManagement/yarnStockActiveFilters.js';

const CONE_WEIGHT_MIN = 0.18;
const CONE_WEIGHT_MAX = 0.42;
const TEAR_WEIGHT_MIN = 0.09;
const TEAR_WEIGHT_MAX = 0.11;

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
 * Deterministic PRNG (mulberry32) for repeatable test weights.
 * @param {number} seed
 * @returns {() => number} Returns floats in [0, 1).
 */
function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {() => number} rng
 * @param {number} min
 * @param {number} max
 * @param {number} decimals
 * @returns {number}
 */
function rndBetween(rng, min, max, decimals) {
  const v = min + rng() * (max - min);
  return Number(v.toFixed(decimals));
}

/**
 * Collect YarnCatalog ids to pass to inventory sync (resolve by yarnName when missing on cones).
 * @param {Array<{ yarnCatalogId?: import('mongoose').Types.ObjectId | null; yarnName?: string | null }>} cones
 * @returns {Promise<string[]>} Unique valid catalog id hex strings.
 */
async function resolveCatalogIdsForSync(cones) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const c of cones) {
    const id = c.yarnCatalogId;
    if (id != null && mongoose.Types.ObjectId.isValid(id)) {
      out.add(String(id));
    }
  }
  if (out.size > 0) return [...out];
  const name = cones.find((c) => c.yarnName && String(c.yarnName).trim())?.yarnName;
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
 * @returns {void}
 */
function printUsage() {
  // eslint-disable-next-line no-console
  console.error(
    'Usage: node src/scripts/reset-yarn-cones-for-box-testing.js --box-id="BOX-..." [--dry-run|--apply] [--mongo-url=] [--seed=N] [--no-box]'
  );
}

async function main() {
  const boxId = getArg('--box-id=');
  const APPLY = process.argv.includes('--apply');
  const DRY_RUN = !APPLY || process.argv.includes('--dry-run');
  const skipBox = process.argv.includes('--no-box');
  const seedRaw = getArg('--seed=');
  const seed = seedRaw != null && seedRaw !== '' ? Number.parseInt(seedRaw, 10) : null;

  if (!boxId || !String(boxId).trim()) {
    printUsage();
    process.exit(1);
  }

  const filter = { boxId: String(boxId).trim(), ...activeYarnConeMatch };

  await connectMongo();

  try {
    const cones = await YarnCone.find(filter).sort({ _id: 1 }).lean();
    const rng = Number.isFinite(seed) ? createRng(seed) : () => Math.random();

    logger.info(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} | boxId=${filter.boxId} | cones=${cones.length}`);

    if (cones.length === 0) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ boxId: filter.boxId, cones: 0, message: 'no matching cones' }, null, 2));
      return;
    }

    /** @type {{ coneWeight: number; tearWeight: number }[]} */
    const weights = cones.map(() => ({
      coneWeight: rndBetween(rng, CONE_WEIGHT_MIN, CONE_WEIGHT_MAX, 3),
      tearWeight: rndBetween(rng, TEAR_WEIGHT_MIN, TEAR_WEIGHT_MAX, 3),
    }));

    /** @type {{ _id: string; barcode?: string; before: object; after: object }[]} */
    const preview = cones.slice(0, 15).map((c, i) => {
      const w = weights[i];
      return {
        _id: String(c._id),
        barcode: c.barcode,
        before: {
          coneWeight: c.coneWeight,
          tearWeight: c.tearWeight,
          issueStatus: c.issueStatus,
          coneStorageId: c.coneStorageId ?? null,
        },
        after: {
          coneWeight: w.coneWeight,
          tearWeight: w.tearWeight,
          issueStatus: 'not_issued',
          coneStorageId: null,
        },
      };
    });

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ boxId: filter.boxId, count: cones.length, sample: preview, seed: seed ?? 'random' }, null, 2));

    if (DRY_RUN || !APPLY) {
      // eslint-disable-next-line no-console
      console.log('(No writes: pass --apply to persist.)');
      return;
    }

    const ops = cones.map((c, i) => {
      const { coneWeight: cw, tearWeight: tw } = weights[i];
      return {
        updateOne: {
          filter: { _id: c._id },
          update: {
            $set: {
              issueStatus: 'not_issued',
              coneWeight: cw,
              tearWeight: tw,
            },
            $unset: {
              coneStorageId: '',
              issueDate: '',
              issueWeight: '',
              issuedBy: '',
              orderId: '',
              articleId: '',
              returnDate: '',
              returnWeight: '',
              returnBy: '',
            },
          },
        },
      };
    });

    const bulkRes = await YarnCone.bulkWrite(ops, { ordered: false });
    logger.info(`bulkWrite: matched=${bulkRes.matchedCount} modified=${bulkRes.modifiedCount}`);

    const catalogIds = await resolveCatalogIdsForSync(cones);
    if (catalogIds.length > 0) {
      logger.info(`syncInventoriesFromStorageForCatalogIds: ${catalogIds.length} catalog(s)`);
      await syncInventoriesFromStorageForCatalogIds(catalogIds.map((id) => new mongoose.Types.ObjectId(id)));
    } else {
      logger.warn('No yarnCatalogId resolved for inventory sync; ST totals may be stale until the next inventory recompute.');
    }

    if (!skipBox) {
      const n = cones.length;
      await YarnBox.updateOne(
        { boxId: filter.boxId, ...activeYarnBoxMatch },
        {
          $set: {
            numberOfCones: n,
            'coneData.numberOfCones': n,
            'coneData.conesIssued': false,
          },
          $unset: {
            'coneData.coneIssueDate': '',
          },
        }
      );
      logger.info(`YarnBox updated: numberOfCones=${n}, coneData.conesIssued=false`);
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          boxId: filter.boxId,
          conesUpdated: cones.length,
          bulkWrite: {
            matchedCount: bulkRes.matchedCount,
            modifiedCount: bulkRes.modifiedCount,
          },
          inventoryCatalogsSynced: catalogIds.length,
          boxAligned: !skipBox,
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
