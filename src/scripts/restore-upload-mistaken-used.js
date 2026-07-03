#!/usr/bin/env node

/**
 * Restore cones mistakenly marked `used` + clear LT boxes after ST upload.
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/restore-upload-mistaken-used.js --dry-run
 *   NODE_ENV=development node src/scripts/restore-upload-mistaken-used.js --apply
 *
 * Cones: used → not_issued, restore gross weight + ST rack from Excel.
 * Boxes: remove from LT (storedStatus false, clear location, boxWeight 0, conesIssued true).
 *
 * Flags:
 *   --file=PATH       Default: reports/For check upload data 3-07-2026.xlsx
 *   --out-dir=PATH    Default: ./reports/restore-upload-mistaken-used-<timestamp>
 *   --cones-only
 *   --boxes-only
 *   --dry-run         Default unless --apply
 *   --apply           Persist updates + inventory sync
 *   --mongo-url=URL
 */

import './lib/mongoUrlParsePatch.js';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { syncInventoriesFromStorageForCatalogIds } from '../services/yarnManagement/yarnInventory.service.js';
import { parseUploadWorkbook } from './restore-upload-mistaken-used.parse.js';
import {
  loadStorageSlotIndex,
  loadConesByBarcodes,
  processConeRestores,
  processBoxRestores,
  loadBoxesForUploadRows,
  summarizeRestoreResults,
} from './restore-upload-mistaken-used.apply.js';
import { toCsv } from './sync-inventory-dataaudit.reports.js';

const DEFAULT_FILE = 'reports/For check upload data 3-07-2026.xlsx';

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

const FILE = getArg('--file=') || DEFAULT_FILE;
const OUT_DIR_ARG = getArg('--out-dir=');
const APPLY = process.argv.includes('--apply');
const CONES_ONLY = process.argv.includes('--cones-only');
const BOXES_ONLY = process.argv.includes('--boxes-only');
const PROCESS_CONES = !BOXES_ONLY;
const PROCESS_BOXES = !CONES_ONLY;

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
  await mongoose.connect(u, { useNewUrlParser: true, useUnifiedTopology: true });
}

/**
 * Flattens a restore result for CSV export.
 * @param {import('./restore-upload-mistaken-used.apply.js').RestoreRowResult} r
 * @returns {Record<string, unknown>}
 */
function flattenRestoreResult(r) {
  const before = /** @type {Record<string, unknown>} */ (r.before || {});
  const after = /** @type {Record<string, unknown>} */ (r.after || {});
  return {
    entityType: r.entityType,
    rowIndex: r.rowIndex,
    barcode: r.barcode,
    boxId: r.boxId ?? '',
    status: r.status,
    message: r.message ?? '',
    docId: r.docId ?? '',
    beforeIssueStatus: before.issueStatus ?? before.conesIssued ?? '',
    beforeGrossWeight: before.coneWeight ?? before.grossWeight ?? '',
    beforeNetWeight: before.netWeight ?? before.boxWeight ?? '',
    beforeRack: before.coneStorageId ?? before.storageLocation ?? '',
    afterIssueStatus: after.issueStatus ?? after.conesIssued ?? '',
    afterGrossWeight: after.coneWeight ?? after.grossWeight ?? '',
    afterNetWeight: after.netWeight ?? after.boxWeight ?? '',
    afterRack: after.coneStorageId ?? after.storageLocation ?? '',
  };
}

async function main() {
  const filePath = path.resolve(process.cwd(), FILE);
  logger.info(`Mode: ${APPLY ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}`);
  logger.info(`Reading ${filePath}`);

  const { coneRows, boxRows } = parseUploadWorkbook(filePath);
  logger.info(`Parsed ${coneRows.length} cone row(s), ${boxRows.length} box row(s)`);

  await connectMongo();
  const slotIndex = await loadStorageSlotIndex();

  /** @type {import('./restore-upload-mistaken-used.apply.js').RestoreRowResult[]} */
  const allResults = [];
  /** @type {Set<string>} */
  const catalogIds = new Set();

  if (PROCESS_CONES && coneRows.length > 0) {
    const barcodes = [...new Set(coneRows.filter((r) => r.barcode && !r.isDup).map((r) => r.barcode))];
    const coneMap = await loadConesByBarcodes(barcodes);
    const { results, catalogIds: coneCatalogIds } = await processConeRestores(
      coneRows,
      coneMap,
      slotIndex,
      APPLY
    );
    allResults.push(...results);
    for (const id of coneCatalogIds) catalogIds.add(id);
    logger.info(`Cone restore: ${JSON.stringify(summarizeRestoreResults(results))}`);
  }

  if (PROCESS_BOXES && boxRows.length > 0) {
    const boxMap = await loadBoxesForUploadRows(boxRows);
    const { results, catalogIds: boxCatalogIds } = await processBoxRestores(
      boxRows,
      boxMap,
      APPLY
    );
    allResults.push(...results);
    for (const id of boxCatalogIds) catalogIds.add(id);
    logger.info(`Box restore: ${JSON.stringify(summarizeRestoreResults(results))}`);
  }

  if (APPLY && catalogIds.size > 0) {
    logger.info(`Syncing YarnInventory for ${catalogIds.size} catalog(s)…`);
    try {
      await syncInventoriesFromStorageForCatalogIds([...catalogIds]);
    } catch (err) {
      logger.error('[restore-upload-mistaken-used] Inventory sync failed:', err?.message || err);
    }
  }

  const outDir =
    OUT_DIR_ARG || path.resolve(process.cwd(), `reports/restore-upload-mistaken-used-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, 'restore-report.csv');
  fs.writeFileSync(reportPath, toCsv(allResults.map(flattenRestoreResult)), 'utf8');

  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    file: FILE,
    coneRows: coneRows.length,
    boxRows: boxRows.length,
    resultCounts: summarizeRestoreResults(allResults),
    catalogsSynced: APPLY ? catalogIds.size : 0,
    reportPath,
  };

  // eslint-disable-next-line no-console
  console.log('\n=== Restore upload mistaken-used summary ===');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));

  if (!APPLY) {
    logger.warn('DRY RUN — no DB writes. Re-run with --apply to commit.');
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
