#!/usr/bin/env node
/* eslint-disable import/first, no-underscore-dangle, no-restricted-syntax, no-await-in-loop, no-continue --
   mongoUrlParsePatch must load before mongoose */

/**
 * Re-link YarnBox (and its cones + related transactions) to the correct yarn catalog.
 * Use when a box was created under the wrong PO item / yarnName (e.g. GRN revision mismatch).
 *
 * Uses `updateOne` / `bulkWrite` — does not run YarnBox pre/post-save hooks.
 * After writes, recalculates inventory for affected old + new yarnCatalogIds.
 *
 * Single box:
 *   node src/scripts/fix-yarn-box-yarn-assignment.js \
 *     --barcode=6a1fb6479ad6499102dbcf70 \
 *     --to-yarn-name="20/70-Brown-Brown-Nylon/Spandex" \
 *     --from-yarn-name="70/2-Brown-Brown-Nylon/Nylon"
 *
 * Apply (production — pass prod URI explicitly):
 *   node src/scripts/fix-yarn-box-yarn-assignment.js \
 *     --mongo-url="$PROD_MONGODB_URL" \
 *     --csv=reports/fix-yarn-box-assignments.csv \
 *     --apply
 *
 * Flags:
 *   --barcode=ID[,ID...]       One or more YarnBox.barcode values (single-box mode)
 *   --box-id=ID                Alternative lookup by YarnBox.boxId
 *   --to-yarn-name=NAME        Target YarnCatalog.yarnName (required unless --to-yarn-catalog-id)
 *   --to-yarn-catalog-id=ID    Target YarnCatalog _id (skips name lookup)
 *   --from-yarn-name=NAME      Optional safety check — skip row if current yarnName differs
 *   --csv=PATH                 Batch mode: columns barcode,toYarnName[,fromYarnName,note]
 *   --apply                    Persist writes (default is dry-run)
 *   --mongo-url=URL            Override MongoDB URI (use for production)
 *   --json                     Emit JSON summary to stdout
 *   --out=PATH                 With --json --apply, also write JSON report to file
 *
 * @file
 */

import './lib/mongoUrlParsePatch.js';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnCone, YarnTransaction, YarnCatalog } from '../models/index.js';
import { syncInventoriesFromStorageForCatalogIds } from '../services/yarnManagement/yarnInventory.service.js';
import { activeYarnBoxMatch, activeYarnConeMatch } from '../services/yarnManagement/yarnStockActiveFilters.js';

const APPLY = process.argv.includes('--apply');
const JSON_OUT = process.argv.includes('--json');

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
 * @returns {{ url: string; source: string }}
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
 * Resolve YarnBox by barcode (exact, case-insensitive, or Mongo _id fallback).
 * @param {string} barcode
 * @returns {Promise<import('mongoose').LeanDocument | null>}
 */
async function findBoxByBarcode(barcode) {
  const trimmed = String(barcode || '').trim();
  if (!trimmed) return null;

  let box = await YarnBox.findOne({ barcode: trimmed, ...activeYarnBoxMatch }).lean();
  if (!box) {
    const esc = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    box = await YarnBox.findOne({ barcode: new RegExp(`^${esc}$`, 'i'), ...activeYarnBoxMatch }).lean();
  }
  if (!box && mongoose.Types.ObjectId.isValid(trimmed)) {
    const byId = await YarnBox.findById(trimmed).lean();
    if (byId && !byId.returnedToVendorAt) return byId;
  }
  return box;
}

/**
 * Resolve YarnBox from barcode or boxId.
 * @param {{ barcode?: string | null; boxId?: string | null }} params
 * @returns {Promise<import('mongoose').LeanDocument | null>}
 */
async function resolveBox({ barcode, boxId }) {
  if (barcode) {
    const found = await findBoxByBarcode(barcode);
    if (found) return found;
  }
  if (boxId) {
    return YarnBox.findOne({ boxId: String(boxId).trim(), ...activeYarnBoxMatch }).lean();
  }
  return null;
}

/**
 * Resolve YarnCatalog by ObjectId or exact yarnName (case-insensitive).
 * @param {{ catalogId?: string | null; yarnName?: string | null }} params
 * @returns {Promise<{ _id: import('mongoose').Types.ObjectId; yarnName: string } | null>}
 */
async function resolveTargetCatalog({ catalogId, yarnName }) {
  if (catalogId && mongoose.Types.ObjectId.isValid(catalogId)) {
    const cat = await YarnCatalog.findById(catalogId).select('yarnName status').lean();
    if (cat && cat.status !== 'deleted') {
      return { _id: cat._id, yarnName: String(cat.yarnName || '').trim() };
    }
  }
  const name = String(yarnName || '').trim();
  if (!name) return null;

  let cat = await YarnCatalog.findOne({ yarnName: name, status: { $ne: 'deleted' } }).select('yarnName').lean();
  if (!cat) {
    cat = await YarnCatalog.findOne({
      yarnName: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      status: { $ne: 'deleted' },
    })
      .select('yarnName')
      .lean();
  }
  if (!cat) return null;
  return { _id: cat._id, yarnName: String(cat.yarnName || name).trim() };
}

/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean}
 */
function yarnNamesEqual(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
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
 * @typedef {Object} FixRow
 * @property {string} barcode
 * @property {string} toYarnName
 * @property {string} [fromYarnName]
 * @property {string} [toYarnCatalogId]
 * @property {string} [note]
 */

/**
 * Parse CSV batch file (header: barcode,toYarnName[,fromYarnName,note]).
 * @param {string} csvPath
 * @returns {Promise<FixRow[]>}
 */
async function parseCsvRows(csvPath) {
  const abs = path.resolve(csvPath);
  const raw = await fs.readFile(abs, 'utf8');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const barcodeIdx = header.indexOf('barcode');
  const toNameIdx = header.indexOf('toyarnname');
  const fromNameIdx = header.indexOf('fromyarnname');
  const toCatIdx = header.indexOf('toyarncatalogid');
  const noteIdx = header.indexOf('note');

  if (barcodeIdx < 0 || (toNameIdx < 0 && toCatIdx < 0)) {
    throw new Error(`CSV ${abs} must include header columns: barcode,toYarnName (or toYarnCatalogId)`);
  }

  /** @type {FixRow[]} */
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const barcode = cols[barcodeIdx];
    if (!barcode || barcode.startsWith('#')) continue;
    rows.push({
      barcode,
      toYarnName: toNameIdx >= 0 ? cols[toNameIdx] || '' : '',
      fromYarnName: fromNameIdx >= 0 ? cols[fromNameIdx] || '' : '',
      toYarnCatalogId: toCatIdx >= 0 ? cols[toCatIdx] || '' : '',
      note: noteIdx >= 0 ? cols[noteIdx] || '' : '',
    });
  }
  return rows;
}

/**
 * Preview or apply yarn reassignment for one box.
 * @param {FixRow & { apply: boolean }} params
 * @returns {Promise<Record<string, unknown>>}
 */
async function processRow({ barcode, toYarnName, fromYarnName, toYarnCatalogId, note, apply }) {
  const box = await findBoxByBarcode(barcode);
  if (!box) {
    return { barcode, status: 'not_found', note };
  }

  if (fromYarnName && !yarnNamesEqual(box.yarnName, fromYarnName)) {
    return {
      barcode,
      status: 'skipped_from_mismatch',
      note,
      boxId: box.boxId,
      currentYarnName: box.yarnName,
      expectedFromYarnName: fromYarnName,
    };
  }

  const target = await resolveTargetCatalog({ catalogId: toYarnCatalogId, yarnName: toYarnName });
  if (!target) {
    return {
      barcode,
      status: 'target_catalog_not_found',
      note,
      toYarnName,
      toYarnCatalogId,
    };
  }

  const oldCatalogId = box.yarnCatalogId ? String(box.yarnCatalogId) : '';
  const newCatalogId = String(target._id);

  if (yarnNamesEqual(box.yarnName, target.yarnName) && oldCatalogId === newCatalogId) {
    return {
      barcode,
      status: 'already_correct',
      note,
      boxId: box.boxId,
      yarnName: box.yarnName,
      yarnCatalogId: newCatalogId,
    };
  }

  const boxId = String(box.boxId);
  const cones = await YarnCone.find({ boxId, ...activeYarnConeMatch }).lean();
  const coneIds = cones.map((c) => c._id);
  const txFilter = buildTransactionFilter(boxId, coneIds);
  const txCount = txFilter ? await YarnTransaction.countDocuments(txFilter) : 0;

  const preview = {
    barcode: box.barcode,
    boxId,
    poNumber: box.poNumber,
    lotNumber: box.lotNumber,
    note,
    from: {
      yarnName: box.yarnName,
      yarnCatalogId: oldCatalogId || null,
    },
    to: {
      yarnName: target.yarnName,
      yarnCatalogId: newCatalogId,
    },
    storedStatus: box.storedStatus,
    storageLocation: box.storageLocation,
    boxWeight: box.boxWeight,
    numberOfCones: box.numberOfCones,
    coneCount: cones.length,
    transactionCount: txCount,
  };

  if (!apply) {
    return { ...preview, status: 'would_update' };
  }

  const boxRes = await YarnBox.updateOne(
    { _id: box._id },
    { $set: { yarnName: target.yarnName, yarnCatalogId: target._id } }
  );

  let conesModified = 0;
  if (cones.length) {
    const coneOps = cones.map((c) => ({
      updateOne: {
        filter: { _id: c._id },
        update: { $set: { yarnName: target.yarnName, yarnCatalogId: target._id } },
      },
    }));
    const bulk = await YarnCone.bulkWrite(coneOps, { ordered: false });
    conesModified = bulk.modifiedCount;
  }

  let txModified = 0;
  if (txFilter) {
    const txRes = await YarnTransaction.updateMany(txFilter, {
      $set: { yarnName: target.yarnName, yarnCatalogId: target._id },
    });
    txModified = txRes.modifiedCount;
  }

  const catalogIdsToSync = [...new Set([oldCatalogId, newCatalogId].filter(Boolean))];
  if (catalogIdsToSync.length) {
    await syncInventoriesFromStorageForCatalogIds(
      catalogIdsToSync.map((id) => new mongoose.Types.ObjectId(id))
    );
  }

  return {
    ...preview,
    status: 'updated',
    boxModified: boxRes.modifiedCount,
    conesModified,
    transactionsModified: txModified,
    inventoryCatalogsSynced: catalogIdsToSync,
  };
}

/**
 * @returns {void}
 */
function printUsage() {
  // eslint-disable-next-line no-console
  console.error(`
Usage:
  node src/scripts/fix-yarn-box-yarn-assignment.js --barcode=ID --to-yarn-name=NAME [--from-yarn-name=NAME] [--apply]
  node src/scripts/fix-yarn-box-yarn-assignment.js --csv=reports/fix-yarn-box-assignments.csv [--apply] [--mongo-url=]

Example (PO-2026-1191 lot EW76244/26 box 2):
  node src/scripts/fix-yarn-box-yarn-assignment.js \\
    --barcode=6a1fb6479ad6499102dbcf70 \\
    --to-yarn-name="20/70-Brown-Brown-Nylon/Spandex" \\
    --from-yarn-name="70/2-Brown-Brown-Nylon/Nylon"
`);
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const csvPath = getArg('--csv=');
  const outPath = getArg('--out=');
  const barcodeArg = getArg('--barcode=');
  const boxIdArg = getArg('--box-id=');
  const toYarnName = getArg('--to-yarn-name=');
  const toYarnCatalogId = getArg('--to-yarn-catalog-id=');
  const fromYarnName = getArg('--from-yarn-name=');

  /** @type {FixRow[]} */
  let rows = [];

  if (csvPath) {
    rows = await parseCsvRows(csvPath);
  } else if (barcodeArg) {
    rows = barcodeArg.split(',').map((b) => ({
      barcode: b.trim(),
      toYarnName: toYarnName || '',
      fromYarnName: fromYarnName || '',
      toYarnCatalogId: toYarnCatalogId || '',
    }));
  } else if (boxIdArg) {
    await connectMongo();
    const box = await resolveBox({ boxId: boxIdArg });
    if (!box) {
      throw new Error(`No active YarnBox for box-id=${boxIdArg}`);
    }
    rows = [{
      barcode: String(box.barcode),
      toYarnName: toYarnName || '',
      fromYarnName: fromYarnName || '',
      toYarnCatalogId: toYarnCatalogId || '',
    }];
  } else {
    printUsage();
    process.exit(1);
  }

  if (!rows.length) {
    throw new Error('No rows to process.');
  }

  if (!csvPath && !boxIdArg) {
    await connectMongo();
  } else if (csvPath) {
    await connectMongo();
  }

  for (const row of rows) {
    if (!row.toYarnName && !row.toYarnCatalogId) {
      throw new Error(`Row ${row.barcode}: provide toYarnName or toYarnCatalogId`);
    }
  }

  /** @type {Record<string, unknown>[]} */
  const results = [];
  for (const row of rows) {
    const result = await processRow({ ...row, apply: APPLY });
    results.push(result);
    if (!JSON_OUT) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result, null, 2));
    }
  }

  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    rowCount: results.length,
    updated: results.filter((r) => r.status === 'updated').length,
    wouldUpdate: results.filter((r) => r.status === 'would_update').length,
    skipped: results.filter((r) => String(r.status).startsWith('skipped')).length,
    errors: results.filter((r) => ['not_found', 'target_catalog_not_found'].includes(String(r.status))).length,
    results,
  };

  if (JSON_OUT) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n--- Summary (${summary.mode}) ---`);
    // eslint-disable-next-line no-console
    console.log(
      `rows=${summary.rowCount} updated=${summary.updated} wouldUpdate=${summary.wouldUpdate} skipped=${summary.skipped} errors=${summary.errors}`
    );
    if (!APPLY) {
      // eslint-disable-next-line no-console
      console.log('(No writes: pass --apply to persist.)');
    }
  }

  if (outPath && APPLY) {
    const absOut = path.resolve(outPath);
    await fs.mkdir(path.dirname(absOut), { recursive: true });
    await fs.writeFile(absOut, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    logger.info(`Wrote report: ${absOut}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
