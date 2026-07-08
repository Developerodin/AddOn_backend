#!/usr/bin/env node
/**
 * Reset all YarnCone rows for a box to `not_issued` with zero weight (fresh/new cone state).
 * Clears issue/return/ST metadata and optionally realigns YarnBox.coneData.
 *
 * Usage:
 *   node src/scripts/reset-yarn-box-cones-not-issued.js --barcode=69d3641e2614366a5d879559 --dry-run
 *   node src/scripts/reset-yarn-box-cones-not-issued.js --barcode=69d3641e2614366a5d879559 --apply
 *   node src/scripts/reset-yarn-box-cones-not-issued.js --box-id="BOX-PO-..." --apply
 *
 * Flags:
 *   --barcode=    YarnBox.barcode (Mongo _id string)
 *   --box-id=     YarnBox.boxId / YarnCone.boxId (required if --barcode omitted)
 *   --dry-run     Preview only (default unless --apply)
 *   --apply       Persist updates + inventory sync
 *   --mongo-url=  Override Mongo URL
 *   --no-box      Skip YarnBox coneData alignment
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
 * Resolve YarnBox from barcode or boxId.
 * @param {{ barcode?: string | null; boxId?: string | null }} params
 * @returns {Promise<import('mongoose').LeanDocument<import('../models/yarnReq/yarnBox.model.js').default>> | null>}
 */
async function resolveBox({ barcode, boxId }) {
  if (barcode) {
    const byBarcode = await YarnBox.findOne({ barcode: String(barcode).trim(), ...activeYarnBoxMatch }).lean();
    if (byBarcode) return byBarcode;
    if (mongoose.Types.ObjectId.isValid(barcode)) {
      const byId = await YarnBox.findById(barcode).lean();
      if (byId && !byId.returnedToVendorAt) return byId;
    }
  }
  if (boxId) {
    return YarnBox.findOne({ boxId: String(boxId).trim(), ...activeYarnBoxMatch }).lean();
  }
  return null;
}

/**
 * Collect YarnCatalog ids for inventory sync.
 * @param {Array<{ yarnCatalogId?: import('mongoose').Types.ObjectId | null; yarnName?: string | null }>} cones
 * @returns {Promise<string[]>}
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
    'Usage: node src/scripts/reset-yarn-box-cones-not-issued.js --barcode=... | --box-id=... [--dry-run|--apply] [--mongo-url=] [--no-box]'
  );
}

async function main() {
  const barcode = getArg('--barcode=');
  const boxIdArg = getArg('--box-id=');
  const APPLY = process.argv.includes('--apply');
  const DRY_RUN = !APPLY || process.argv.includes('--dry-run');
  const skipBox = process.argv.includes('--no-box');

  if (!barcode && !boxIdArg) {
    printUsage();
    process.exit(1);
  }

  await connectMongo();

  try {
    const box = await resolveBox({ barcode, boxId: boxIdArg });
    if (!box) {
      throw new Error(`YarnBox not found for barcode=${barcode || '-'} boxId=${boxIdArg || '-'}`);
    }

    const boxId = String(box.boxId);
    const cones = await YarnCone.find({ boxId, ...activeYarnConeMatch }).sort({ _id: 1 }).lean();

    logger.info(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} | boxId=${boxId} | barcode=${box.barcode} | cones=${cones.length}`);

    if (cones.length === 0) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ boxId, barcode: box.barcode, cones: 0, message: 'no matching cones' }, null, 2));
      return;
    }

    const issueSummary = cones.reduce((acc, c) => {
      const st = String(c.issueStatus || 'unknown');
      acc[st] = (acc[st] || 0) + 1;
      return acc;
    }, /** @type {Record<string, number>} */ ({}));

    /** @type {{ _id: string; barcode?: string; before: object; after: object }[]} */
    const preview = cones.slice(0, 10).map((c) => ({
      _id: String(c._id),
      barcode: c.barcode,
      before: {
        issueStatus: c.issueStatus,
        returnStatus: c.returnStatus,
        coneWeight: c.coneWeight,
        tearWeight: c.tearWeight,
        coneStorageId: c.coneStorageId ?? null,
      },
      after: {
        issueStatus: 'not_issued',
        returnStatus: 'not_returned',
        coneWeight: 0,
        tearWeight: 0,
        coneStorageId: null,
      },
    }));

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          boxId,
          barcode: box.barcode,
          poNumber: box.poNumber,
          yarnName: box.yarnName,
          count: cones.length,
          issueSummaryBefore: issueSummary,
          sample: preview,
        },
        null,
        2
      )
    );

    if (DRY_RUN || !APPLY) {
      // eslint-disable-next-line no-console
      console.log('(No writes: pass --apply to persist.)');
      return;
    }

    const ops = cones.map((c) => ({
      updateOne: {
        filter: { _id: c._id },
        update: {
          $set: {
            issueStatus: 'not_issued',
            returnStatus: 'not_returned',
            coneWeight: 0,
            tearWeight: 0,
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
    }));

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
        { boxId, ...activeYarnBoxMatch },
        {
          $set: {
            numberOfCones: n,
            'coneData.numberOfCones': n,
            'coneData.conesIssued': false,
          },
          $unset: {
            'coneData.coneIssueDate': '',
            'coneData.coneIssueBy': '',
          },
        }
      );
      logger.info(`YarnBox updated: numberOfCones=${n}, coneData.conesIssued=false`);
    }

    const afterCones = await YarnCone.find({ boxId, ...activeYarnConeMatch }).lean();
    const afterSummary = afterCones.reduce((acc, c) => {
      const st = String(c.issueStatus || 'unknown');
      acc[st] = (acc[st] || 0) + 1;
      return acc;
    }, /** @type {Record<string, number>} */ ({}));

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          boxId,
          barcode: box.barcode,
          conesUpdated: cones.length,
          issueSummaryAfter: afterSummary,
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
