#!/usr/bin/env node
/* eslint-disable import/first, no-underscore-dangle, no-restricted-syntax, no-await-in-loop, no-continue --
   url.parse patch must run before mongoose loads; sequential per-barcode updates */

/**
 * Mark one or more YarnBox documents as returned to vendor: zero net weight/cones,
 * detach storage, set `returnedToVendorAt`.
 *
 * Uses `updateOne` + `$set` (same rationale as `zero-out-yarn-boxes-from-excel.js`):
 * avoids pre/post-save hooks that would touch inventory / initialBoxWeight capture.
 *
 * Does **not** delete or update YarnCone rows; run cone-return flows separately if those
 * still exist in DB.
 *
 * `returnedToVendorAt` / `vendorReturnId` are filled automatically when you omit CLI overrides:
 *   1) `--vendor-return-id` / `--returned-at` if passed
 *   2) existing fields on the YarnBox
 *   3) any YarnCone with the same `boxId` that already has `vendorReturnId` (vendor finalize sets cones, not boxes)
 *   4) newest completed YarnPoVendorReturn whose `lines` include this `boxId`
 *   5) `returned-at` falls back to that session's `completedAt`, cone timestamps, box timestamp, or `new Date()`
 *
 * Usage:
 *   node src/scripts/mark-yarn-box-returned-to-vendor-by-barcode.js --barcode=69a156e280445e52870b2af0
 *   node src/scripts/mark-yarn-box-returned-to-vendor-by-barcode.js --barcode=id1,id2 --apply
 *   node src/scripts/mark-yarn-box-returned-to-vendor-by-barcode.js --barcode=id1 --returned-at=2026-05-15T10:00:00.000Z --apply
 *   node src/scripts/mark-yarn-box-returned-to-vendor-by-barcode.js --barcode=id1 --vendor-return-id=507f1f77bcf86cd799439011 --apply
 *
 * Flags:
 *   --barcode=ID[,ID...]   Required. YarnBox.barcode value(s).
 *   --apply                Perform writes (default is dry-run).
 *   --returned-at=ISO      Optional. Overrides inferred return timestamp.
 *   --vendor-return-id=    Optional. Overrides inferred YarnPoVendorReturn _id.
 *   --mongo-url=URL        Override MongoDB URI (else config / MONGODB_URL).
 */

// Node 25+ url.parse patch for legacy driver (same as other yarn scripts).
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
import logger from '../config/logger.js';
import { YarnBox, YarnCone, YarnPoVendorReturn } from '../models/index.js';

const APPLY = process.argv.includes('--apply');

/**
 * Parse `--key=value` from argv.
 * @param {string} prefix
 * @returns {string|null}
 */
function getArg(prefix) {
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) return null;
  return found.slice(prefix.length).trim() || null;
}

const BARCODE_ARG = getArg('--barcode=');
const RETURNED_AT_ARG = getArg('--returned-at=');
const VENDOR_RETURN_ID_ARG = getArg('--vendor-return-id=');

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
  if (u.endsWith('>')) u = u.slice(0, -1);
  return u;
}

/**
 * Resolve Mongo connection string.
 * @returns {{ url: string, source: string }}
 */
function resolveMongoConnectionString() {
  const cli = getArg('--mongo-url=');
  if (cli) return { url: sanitizeMongoUrl(cli), source: '--mongo-url' };
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) return { url: cfg, source: 'config.mongoose.url' };
  return { url: sanitizeMongoUrl(String(process.env.MONGODB_URL || '')), source: 'process.env.MONGODB_URL' };
}

const MONGO_CONNECT_OPTIONS = { useNewUrlParser: true, useUnifiedTopology: true };

/**
 * Connect to MongoDB.
 * @returns {Promise<void>}
 */
async function connectMongo() {
  const { url: u, source } = resolveMongoConnectionString();
  if (!u) throw new Error('MongoDB URL is empty. Set MONGODB_URL or pass --mongo-url=');
  const redacted = u.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`Connecting to MongoDB (${source}): ${redacted}`);
  await mongoose.connect(u, MONGO_CONNECT_OPTIONS);
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
 * Find YarnBox by barcode (exact, then case-insensitive regex).
 * @param {string} barcode
 * @returns {Promise<import('mongoose').Document|null>}
 */
async function findBoxByBarcode(barcode) {
  const esc = barcode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let box = await YarnBox.findOne({ barcode });
  if (!box) box = await YarnBox.findOne({ barcode: new RegExp(`^${esc}$`, 'i') });
  return box;
}

/**
 * Build the `$set` payload for vendor return.
 * @param {{ returnedAt: Date, vendorReturnId: mongoose.Types.ObjectId|null }} opts
 * @returns {Record<string, unknown>}
 */
function buildVendorReturnSet(opts) {
  /** @type {Record<string, unknown>} */
  const set = {
    boxWeight: 0,
    grossWeight: 0,
    numberOfCones: 0,
    storedStatus: false,
    storageLocation: '',
    returnedToVendorAt: opts.returnedAt,
    'coneData.conesIssued': false,
    'coneData.numberOfCones': 0,
    'coneData.coneIssueDate': null,
  };
  if (opts.vendorReturnId) {
    set.vendorReturnId = opts.vendorReturnId;
  }
  return set;
}

/**
 * Parse optional `--vendor-return-id` as ObjectId.
 * @param {string|null} raw
 * @returns {mongoose.Types.ObjectId|null}
 */
function parseOptionalVendorReturnId(raw) {
  if (raw == null || raw === '') return null;
  if (!mongoose.Types.ObjectId.isValid(raw)) {
    throw new Error(`Invalid --vendor-return-id (not a valid ObjectId): ${raw}`);
  }
  return new mongoose.Types.ObjectId(raw);
}

/**
 * Parse optional `--returned-at` ISO date.
 * @param {string|null} raw
 * @returns {Date}
 */
function parseReturnedAt(raw) {
  if (raw == null || raw === '') return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid --returned-at (not a valid ISO date): ${raw}`);
  }
  return d;
}

/**
 * True when `--returned-at=` was provided (value may be omitted → treated as now).
 * @returns {boolean}
 */
function hasExplicitReturnedAtArg() {
  return process.argv.some((a) => a.startsWith('--returned-at='));
}

/**
 * Resolve `returnedToVendorAt` and `vendorReturnId` so the box matches cones / YarnPoVendorReturn after finalize.
 *
 * @param {import('mongoose').Document} box
 * @param {{ cliVendorReturnId: mongoose.Types.ObjectId|null, explicitReturnedAt: Date|null }} cli
 * @returns {Promise<{ returnedAt: Date, vendorReturnId: mongoose.Types.ObjectId|null, provenance: Record<string, string> }>}
 */
async function resolveVendorReturnFields(box, cli) {
  const provenance = { vendorReturnId: 'unset', returnedAt: 'unset' };
  let vendorReturnId = cli.cliVendorReturnId || (box.vendorReturnId ? box.vendorReturnId : null);
  if (cli.cliVendorReturnId) {
    provenance.vendorReturnId = 'cli';
  } else if (box.vendorReturnId && String(box.vendorReturnId) === String(vendorReturnId)) {
    provenance.vendorReturnId = 'yarn_box';
  }

  /** @type {Record<string, unknown>|null} */
  let fromCone = null;
  if (!vendorReturnId) {
    fromCone = await YarnCone.findOne({
      boxId: box.boxId,
      vendorReturnId: { $nin: [null, undefined] },
    })
      .sort({ returnedToVendorAt: -1 })
      .select('vendorReturnId returnedToVendorAt')
      .lean();
    if (fromCone?.vendorReturnId) {
      vendorReturnId = fromCone.vendorReturnId;
      provenance.vendorReturnId = 'yarn_cone';
    }
  }

  /** @type {Record<string, unknown>|null} */
  let fromVrByLine = null;
  if (!vendorReturnId) {
    fromVrByLine = await YarnPoVendorReturn.findOne({
      status: 'completed',
      'lines.boxId': box.boxId,
    })
      .sort({ completedAt: -1 })
      .select('_id completedAt')
      .lean();
    if (fromVrByLine?._id) {
      vendorReturnId = fromVrByLine._id;
      provenance.vendorReturnId = 'yarn_po_vendor_return.lines';
    }
  }

  /** @type {Record<string, unknown>|null} */
  let vrById = null;
  if (vendorReturnId) {
    if (fromVrByLine && String(fromVrByLine._id) === String(vendorReturnId)) {
      vrById = fromVrByLine;
    } else {
      vrById = await YarnPoVendorReturn.findById(vendorReturnId).select('completedAt status').lean();
    }
  }

  let returnedAt = cli.explicitReturnedAt;
  if (returnedAt) {
    provenance.returnedAt = 'cli';
  } else if (vrById?.completedAt) {
    returnedAt = vrById.completedAt;
    provenance.returnedAt = 'yarn_po_vendor_return.completedAt';
  } else if (fromCone?.returnedToVendorAt) {
    returnedAt = fromCone.returnedToVendorAt;
    provenance.returnedAt = 'yarn_cone.returnedToVendorAt';
  } else if (box.returnedToVendorAt) {
    returnedAt = box.returnedToVendorAt;
    provenance.returnedAt = 'yarn_box.returnedToVendorAt';
  } else {
    returnedAt = new Date();
    provenance.returnedAt = 'fallback_now';
  }

  if (!vendorReturnId) {
    provenance.vendorReturnId = 'none';
  }

  return { returnedAt, vendorReturnId, provenance };
}

async function main() {
  if (!BARCODE_ARG) {
    // eslint-disable-next-line no-console
    console.error(
      'Usage: node src/scripts/mark-yarn-box-returned-to-vendor-by-barcode.js --barcode=<id>[,<id>...] [--apply] [--returned-at=ISO] [--vendor-return-id=OID] [--mongo-url=...]'
    );
    process.exit(1);
  }

  const barcodes = parseBarcodes(BARCODE_ARG);
  const cliVendorReturnId = parseOptionalVendorReturnId(VENDOR_RETURN_ID_ARG);
  const explicitReturnedAt = hasExplicitReturnedAtArg() ? parseReturnedAt(RETURNED_AT_ARG) : null;

  logger.info(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}`);

  await connectMongo();

  for (const barcode of barcodes) {
    const box = await findBoxByBarcode(barcode);
    if (!box) {
      logger.warn(`[${barcode}] YarnBox not found`);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ barcode, status: 'not_found' }, null, 2));
      continue;
    }

    const before = {
      barcode: box.barcode,
      boxId: box.boxId,
      boxWeight: box.boxWeight,
      grossWeight: box.grossWeight,
      numberOfCones: box.numberOfCones,
      storedStatus: box.storedStatus,
      storageLocation: box.storageLocation,
      returnedToVendorAt: box.returnedToVendorAt,
      vendorReturnId: box.vendorReturnId,
      coneData: box.coneData,
    };

    const { returnedAt, vendorReturnId, provenance } = await resolveVendorReturnFields(box, {
      cliVendorReturnId,
      explicitReturnedAt,
    });

    if (!APPLY) {
      const previewSet = buildVendorReturnSet({ returnedAt, vendorReturnId });
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            barcode: box.barcode,
            status: 'would_update',
            before,
            after: previewSet,
            unset: ['coneData.coneIssueBy'],
            vendorReturnProvenance: provenance,
          },
          null,
          2
        )
      );
      continue;
    }

    const setPayload = buildVendorReturnSet({ returnedAt, vendorReturnId });
    /** @type {import('mongoose').UpdateQuery<unknown>} */
    const update = {
      $set: setPayload,
      $unset: { 'coneData.coneIssueBy': '' },
    };

    const res = await YarnBox.updateOne({ barcode: box.barcode }, update);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          barcode: box.barcode,
          status: 'updated',
          matchedCount: res.matchedCount,
          modifiedCount: res.modifiedCount,
          before,
          set: setPayload,
          vendorReturnProvenance: provenance,
        },
        null,
        2
      )
    );
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
