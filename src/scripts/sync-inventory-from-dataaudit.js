#!/usr/bin/env node

/**
 * DATAAUDIT Inventory Sync — align YarnCone / YarnBox weights and rack locations
 * from physical audit Excel files, export mismatches and not-in-excel candidates.
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/sync-inventory-from-dataaudit.js --dry-run
 *   NODE_ENV=development node src/scripts/sync-inventory-from-dataaudit.js --apply
 *
 * Flags:
 *   --cones-file=PATH   Default: src/DATAAUDIT/Cone-Temp 26.06.2026.xlsx
 *   --boxes-file=PATH   Default: src/DATAAUDIT/Box-Temp 25.06.2026.xlsx
 *   --out-dir=PATH      Default: ./reports/dataaudit-sync-<timestamp>
 *   --cones-only        Process cones only
 *   --boxes-only        Process boxes only
 *   --dry-run           Default unless --apply
 *   --apply             Persist updates + inventory sync
 *   --mongo-url=URL     Override MongoDB connection string
 */

import './lib/mongoUrlParsePatch.js';
import path from 'path';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { syncInventoriesFromStorageForCatalogIds } from '../services/yarnManagement/yarnInventory.service.js';
import {
  parseConeExcel,
  parseBoxExcel,
  collectUniqueBarcodes,
} from './sync-inventory-dataaudit.parse.js';
import {
  loadStorageSlotIndex,
  loadConesByBarcodes,
  loadBoxesByBarcodes,
  processConeRows,
  processBoxRows,
  findConesNotInExcel,
  findBoxesNotInExcel,
  summarizeResults,
} from './sync-inventory-dataaudit.apply.js';
import { writeAllReports } from './sync-inventory-dataaudit.reports.js';

const DEFAULT_CONES_FILE = 'src/DATAAUDIT/Cone-Temp 26.06.2026.xlsx';
const DEFAULT_BOXES_FILE = 'src/DATAAUDIT/Box-Temp 25.06.2026.xlsx';

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

const CONES_FILE = getArg('--cones-file=') || DEFAULT_CONES_FILE;
const BOXES_FILE = getArg('--boxes-file=') || DEFAULT_BOXES_FILE;
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

async function main() {
  logger.info(`Mode: ${APPLY ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}`);

  /** @type {import('./sync-inventory-dataaudit.parse.js').ParsedConeRow[]} */
  let coneRows = [];
  /** @type {import('./sync-inventory-dataaudit.parse.js').ParsedBoxRow[]} */
  let boxRows = [];

  if (PROCESS_CONES) {
    coneRows = parseConeExcel(path.resolve(process.cwd(), CONES_FILE));
    logger.info(`Parsed ${coneRows.length} cone row(s) from ${CONES_FILE}`);
  }

  if (PROCESS_BOXES) {
    boxRows = parseBoxExcel(path.resolve(process.cwd(), BOXES_FILE));
    logger.info(`Parsed ${boxRows.length} box row(s) from ${BOXES_FILE}`);
  }

  await connectMongo();

  const slotIndex = await loadStorageSlotIndex();
  logger.info(`Loaded ${slotIndex.size} storage slot(s)`);

  /** @type {import('./sync-inventory-dataaudit.apply.js').SyncRowResult[]} */
  const allResults = [];
  /** @type {Set<string>} */
  const catalogIds = new Set();

  if (PROCESS_CONES && coneRows.length > 0) {
    const barcodes = [...collectUniqueBarcodes(coneRows)];
    logger.info(`Looking up ${barcodes.length} unique cone barcode(s)…`);
    const coneMap = await loadConesByBarcodes(barcodes);
    const { results, catalogIds: coneCatalogIds } = await processConeRows(
      coneRows,
      coneMap,
      slotIndex,
      APPLY
    );
    allResults.push(...results);
    for (const id of coneCatalogIds) catalogIds.add(id);
    logger.info(`Cone processing done: ${JSON.stringify(summarizeResults(results))}`);
  }

  if (PROCESS_BOXES && boxRows.length > 0) {
    const barcodes = [...collectUniqueBarcodes(boxRows)];
    logger.info(`Looking up ${barcodes.length} unique box barcode(s)…`);
    const boxMap = await loadBoxesByBarcodes(barcodes);
    const { results, catalogIds: boxCatalogIds } = await processBoxRows(
      boxRows,
      boxMap,
      slotIndex,
      APPLY
    );
    allResults.push(...results);
    for (const id of boxCatalogIds) catalogIds.add(id);
    logger.info(`Box processing done: ${JSON.stringify(summarizeResults(results))}`);
  }

  if (APPLY && catalogIds.size > 0) {
    logger.info(`Syncing YarnInventory for ${catalogIds.size} catalog(s)…`);
    try {
      await syncInventoriesFromStorageForCatalogIds([...catalogIds]);
    } catch (err) {
      logger.error('[sync-inventory-from-dataaudit] Inventory sync failed:', err?.message || err);
    }
  }

  const coneExcelBarcodes = PROCESS_CONES ? collectUniqueBarcodes(coneRows) : new Set();
  const boxExcelBarcodes = PROCESS_BOXES ? collectUniqueBarcodes(boxRows) : new Set();

  const conesNotInExcel = PROCESS_CONES ? await findConesNotInExcel(coneExcelBarcodes) : [];
  const boxesNotInExcel = PROCESS_BOXES ? await findBoxesNotInExcel(boxExcelBarcodes) : [];

  const outDir =
    OUT_DIR_ARG ||
    path.resolve(process.cwd(), `reports/dataaudit-sync-${Date.now()}`);

  const reportPaths = writeAllReports(outDir, allResults, conesNotInExcel, boxesNotInExcel);

  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    conesExcelRows: coneRows.length,
    boxesExcelRows: boxRows.length,
    resultCounts: summarizeResults(allResults),
    conesNotInExcel: conesNotInExcel.length,
    boxesNotInExcel: boxesNotInExcel.length,
    catalogsSynced: APPLY ? catalogIds.size : 0,
    reports: reportPaths,
  };

  // eslint-disable-next-line no-console
  console.log('\n=== DATAAUDIT inventory sync summary ===');
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
