#!/usr/bin/env node

/**
 * Mark YarnBoxes as consumed (boxWeight=0, detach slot, conesIssued=true)
 * without touching YarnCone documents.
 *
 * Reads barcodes from Excel (column "Barcode") and/or --barcodes=.
 * Default files: data-correction-needed unallocated + used-box sheets.
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/mark-empty-yarn-boxes-used-by-barcode.js
 *   NODE_ENV=development node src/scripts/mark-empty-yarn-boxes-used-by-barcode.js --apply
 *   NODE_ENV=production node src/scripts/mark-empty-yarn-boxes-used-by-barcode.js --mongo-url='...' --apply
 *   NODE_ENV=development node src/scripts/mark-empty-yarn-boxes-used-by-barcode.js --file=./a.xlsx --file=./b.xlsx --apply
 */

import './lib/mongoUrlParsePatch.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnCone } from '../models/index.js';
import { syncInventoriesFromStorageForCatalogIds } from '../services/yarnManagement/yarnInventory.service.js';

const DEFAULT_FILES = [
  'data-correction-needed/unallocated list pending.xlsx',
  'data-correction-needed/used Box showing.xlsx',
];

/**
 * @param {string} prefix
 * @returns {string|null}
 */
function getArg(prefix) {
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) return null;
  return found.slice(prefix.length).trim() || null;
}

const APPLY = process.argv.includes('--apply');
const SKIP_INVENTORY = process.argv.includes('--skip-inventory');
const FORCE = process.argv.includes('--force');
const CLI_BARCODES = String(getArg('--barcodes=') || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const FILE_ARGS = process.argv
  .filter((a) => a.startsWith('--file='))
  .map((a) => a.slice('--file='.length).trim())
  .filter(Boolean);

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
  const cli = sanitizeMongoUrl(getArg('--mongo-url=') || '');
  if (cli) return { url: cli, source: '--mongo-url' };
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) return { url: cfg, source: 'config.mongoose.url' };
  return {
    url: sanitizeMongoUrl(String(process.env.MONGODB_URL || process.env.ATLAS_MONGODB_URL || '')),
    source: 'process.env',
  };
}

/**
 * Normalize a barcode / boxId cell.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Read unique barcodes from an xlsx (Barcode column, else Box ID).
 * @param {string} filePath
 * @returns {string[]}
 */
function barcodesFromExcel(filePath) {
  const abs = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Excel file not found: ${abs}`);
  }
  const wb = XLSX.readFile(abs);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const ids = [];
  for (const row of rows) {
    const barcode = normalizeId(row.Barcode ?? row.barcode ?? row['Yarn Box Barcode']);
    if (barcode) ids.push(barcode);
  }
  logger.info(`[mark-empty-boxes-used] ${path.basename(abs)}: ${ids.length} barcode(s)`);
  return ids;
}

/**
 * True when the carton still occupies LT/Unallocated or is not stamped used.
 * @param {object} box
 * @returns {boolean}
 */
function needsMarkUsed(box) {
  const wt = Number(box.boxWeight ?? 0);
  const loc = box.storageLocation != null ? String(box.storageLocation).trim() : '';
  const issued = box.coneData?.conesIssued === true;
  const stored = box.storedStatus === true;
  return wt > 0 || loc !== '' || stored || !issued;
}

/**
 * Snapshot YarnBox fields; cone count is read-only.
 * @param {object} box
 * @returns {Promise<object>}
 */
async function snapshotBox(box) {
  const coneCount = await YarnCone.countDocuments({ boxId: box.boxId });
  return {
    barcode: box.barcode,
    boxId: box.boxId,
    boxWeight: box.boxWeight,
    initialBoxWeight: box.initialBoxWeight ?? null,
    storageLocation: box.storageLocation || null,
    storedStatus: box.storedStatus === true,
    conesIssued: box.coneData?.conesIssued === true,
    numberOfCones: box.numberOfCones,
    yarnCatalogId: box.yarnCatalogId ? String(box.yarnCatalogId) : '',
    yarnConeDocs: coneCount,
    needsWrite: needsMarkUsed(box),
  };
}

/**
 * Persist consumed-carton fields on YarnBox only.
 * @param {object} box
 * @returns {Promise<void>}
 */
async function markBoxUsed(box) {
  const existingInitial = Number(box.initialBoxWeight ?? 0);
  const fallbackInitial = Number(box.boxWeight ?? box.grossWeight ?? 0);
  const initialBoxWeight =
    Number.isFinite(existingInitial) && existingInitial > 0
      ? existingInitial
      : Number.isFinite(fallbackInitial) && fallbackInitial > 0
        ? fallbackInitial
        : existingInitial;
  const existingConeData = box.coneData && typeof box.coneData === 'object' ? box.coneData : {};

  await YarnBox.updateOne(
    { _id: box._id },
    {
      $set: {
        boxWeight: 0,
        storedStatus: false,
        initialBoxWeight,
        coneData: {
          ...existingConeData,
          conesIssued: true,
          coneIssueDate: existingConeData.coneIssueDate || new Date(),
        },
      },
      $unset: { storageLocation: '' },
    }
  );
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const filePaths = FILE_ARGS.length ? FILE_ARGS : CLI_BARCODES.length ? [] : DEFAULT_FILES;
  const fromExcel = filePaths.flatMap((f) => barcodesFromExcel(f));
  const barcodes = [...new Set([...CLI_BARCODES, ...fromExcel])];
  if (!barcodes.length) {
    throw new Error('No barcodes. Pass --barcodes= or --file=.xlsx');
  }

  const { url, source } = resolveMongoConnectionString();
  if (!url) throw new Error('MongoDB URL missing. Set MONGODB_URL or pass --mongo-url=');

  logger.info(
    `[mark-empty-boxes-used] Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} (${source}) barcodes=${barcodes.length} skipInventory=${SKIP_INVENTORY}`
  );
  await mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    const boxes = await YarnBox.find({ barcode: { $in: barcodes } }).lean();
    const found = new Set(boxes.map((b) => String(b.barcode).toLowerCase()));
    const missing = barcodes.filter((bc) => !found.has(bc));
    if (missing.length) logger.warn(`[mark-empty-boxes-used] Missing: ${missing.join(',')}`);

    const before = [];
    const toWrite = [];
    const catalogIds = new Set();
    for (const box of boxes) {
      // eslint-disable-next-line no-await-in-loop -- report needs per-box cone count
      const snap = await snapshotBox(box);
      before.push(snap);
      const write = FORCE || snap.needsWrite;
      if (write) {
        toWrite.push(box);
        if (snap.yarnCatalogId) catalogIds.add(snap.yarnCatalogId);
      }
      logger.info(
        `[mark-empty-boxes-used] ${snap.barcode} wt=${snap.boxWeight} loc=${snap.storageLocation || '(none)'} conesDocs=${snap.yarnConeDocs} ${write ? 'WRITE' : 'SKIP already used'}`
      );
    }

    let written = 0;
    if (APPLY && toWrite.length) {
      for (const box of toWrite) {
        // eslint-disable-next-line no-await-in-loop -- small list, serial Atlas writes
        await markBoxUsed(box);
        written += 1;
      }
      if (!SKIP_INVENTORY && catalogIds.size) {
        logger.info(`[mark-empty-boxes-used] Inventory sync ${catalogIds.size} catalog(s)`);
        await syncInventoriesFromStorageForCatalogIds([...catalogIds]);
      }
    }

    const afterBoxes = APPLY ? await YarnBox.find({ barcode: { $in: barcodes } }).lean() : boxes;
    const after = [];
    for (const box of afterBoxes) {
      // eslint-disable-next-line no-await-in-loop
      after.push(await snapshotBox(box));
    }

    const summary = {
      mode: APPLY ? 'apply' : 'dry-run',
      mongoSource: source,
      candidates: barcodes.length,
      found: boxes.length,
      missing,
      wouldWrite: toWrite.length,
      written,
      yarnConeDocsUnchanged: before.every((b) => {
        const a = after.find((x) => String(x.barcode).toLowerCase() === String(b.barcode).toLowerCase());
        return a ? a.yarnConeDocs === b.yarnConeDocs : false;
      }),
      before,
      after,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
    if (!APPLY) logger.warn('DRY RUN — no DB writes. Re-run with --apply to commit.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
