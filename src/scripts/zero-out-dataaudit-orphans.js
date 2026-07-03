#!/usr/bin/env node

/**
 * Zero Out DATAAUDIT Orphans (Phase 2) — clear phantom rack stock from not-in-excel exports.
 *
 * Reads cones-not-in-excel.xlsx / boxes-not-in-excel.xlsx, re-validates live DB state,
 * marks safe cones as used (zero weight, clear rack), zeros LT boxes, blocks issued/production
 * cones, and separates LT boxes that still have ST cones for manual follow-up.
 *
 * For the full one-shot cleanup (cones + all box force modes), use:
 *   node src/scripts/apply-dataaudit-orphan-cleanup.js --from-sync-dir=... --apply
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/zero-out-dataaudit-orphans.js --dry-run
 *   NODE_ENV=development node src/scripts/zero-out-dataaudit-orphans.js --from-sync-dir=./reports/dataaudit-sync-... --apply
 *   NODE_ENV=development node src/scripts/zero-out-dataaudit-orphans.js --from-sync-dir=... --full-cleanup --apply
 *
 * Flags:
 *   --from-sync-dir=PATH   Directory with cones/boxes-not-in-excel.xlsx (default: latest reports/dataaudit-sync-*)
 *   --cones-file=PATH      Override cone xlsx
 *   --boxes-file=PATH      Override box xlsx
 *   --cones-only / --boxes-only
 *   --out-dir=PATH         Report output (default ./reports/dataaudit-zero-out-<timestamp>)
 *   --dry-run              Default unless --apply
 *   --apply                Persist updates + inventory sync
 *   --full-cleanup         Enable --force-lt-with-st-cones + --force-issued-cones-on-box (used by apply-dataaudit-orphan-cleanup.js)
 *   --force-lt-with-st-cones       Zero ST cones on box first, then zero LT box (confirmed fully used)
 *   --force-issued-cones-on-box    Zero box even when issued cones remain (issued cones untouched)
 *   --mongo-url=URL
 */

import './lib/mongoUrlParsePatch.js';
import path from 'path';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { syncInventoriesFromStorageForCatalogIds } from '../services/yarnManagement/yarnInventory.service.js';
import {
  parseOrphanXlsx,
  dedupeOrphanRows,
  resolveInputFiles,
} from './zero-out-dataaudit-orphans.parse.js';
import {
  classifyAllCones,
  classifyAllBoxes,
  summarizeBuckets,
} from './zero-out-dataaudit-orphans.classify.js';
import { processCones, processBoxes } from './zero-out-dataaudit-orphans.apply.js';
import { writeAllReports } from './zero-out-dataaudit-orphans.reports.js';

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

const FROM_SYNC_DIR = getArg('--from-sync-dir=');
const CONES_FILE = getArg('--cones-file=');
const BOXES_FILE = getArg('--boxes-file=');
const OUT_DIR_ARG = getArg('--out-dir=');
const APPLY = process.argv.includes('--apply');
const FULL_CLEANUP = process.argv.includes('--full-cleanup');
const FORCE_LT_WITH_ST_CONES =
  process.argv.includes('--force-lt-with-st-cones') || FULL_CLEANUP;
const FORCE_ISSUED_CONES_ON_BOX =
  process.argv.includes('--force-issued-cones-on-box') || FULL_CLEANUP;
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
 * Connects to MongoDB.
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
 * Builds default output directory path.
 * @returns {string}
 */
function defaultOutDir() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.resolve(process.cwd(), `reports/dataaudit-zero-out-${ts}`);
}

async function main() {
  logger.info(`Mode: ${APPLY ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}`);
  if (FULL_CLEANUP) {
    logger.info('Full cleanup: cones (skip issued) + all boxes (force LT ST cones + force issued-on-box)');
  }

  const { conesFile, boxesFile, syncDirUsed } = resolveInputFiles({
    fromSyncDir: FROM_SYNC_DIR,
    conesFile: CONES_FILE,
    boxesFile: BOXES_FILE,
  });

  if (syncDirUsed) {
    logger.info(`Using sync report dir: ${syncDirUsed}`);
  }

  /** @type {import('./zero-out-dataaudit-orphans.parse.js').ParsedOrphanRow[]} */
  let coneRows = [];
  /** @type {import('./zero-out-dataaudit-orphans.parse.js').ParsedOrphanRow[]} */
  let boxRows = [];

  if (PROCESS_CONES) {
    if (!conesFile) {
      throw new Error(
        'No cones-not-in-excel.xlsx found. Pass --cones-file=PATH or --from-sync-dir=PATH with export files.'
      );
    }
    const raw = parseOrphanXlsx(conesFile, 'cone');
    const { unique, duplicateCount } = dedupeOrphanRows(raw);
    coneRows = unique;
    logger.info(`Parsed ${raw.length} cone row(s) from ${conesFile} (${duplicateCount} duplicate(s) skipped)`);
  }

  if (PROCESS_BOXES) {
    if (!boxesFile) {
      throw new Error(
        'No boxes-not-in-excel.xlsx found. Pass --boxes-file=PATH or --from-sync-dir=PATH with export files.'
      );
    }
    const raw = parseOrphanXlsx(boxesFile, 'box');
    const { unique, duplicateCount } = dedupeOrphanRows(raw);
    boxRows = unique;
    logger.info(`Parsed ${raw.length} box row(s) from ${boxesFile} (${duplicateCount} duplicate(s) skipped)`);
  }

  await connectMongo();

  /** @type {Record<string, unknown>[]} */
  let coneResults = [];
  /** @type {Record<string, unknown>[]} */
  let boxResults = [];
  /** @type {Set<string>} */
  let catalogIds = new Set();

  if (PROCESS_CONES && coneRows.length > 0) {
    logger.info(`Classifying ${coneRows.length} cone(s)…`);
    const classified = await classifyAllCones(coneRows);
    logger.info(`Cone buckets: ${JSON.stringify(summarizeBuckets(classified))}`);
    const { results, catalogIds: coneCatalogIds } = await processCones(classified, APPLY);
    coneResults = results;
    catalogIds = new Set([...catalogIds, ...coneCatalogIds]);
  }

  if (PROCESS_BOXES && boxRows.length > 0) {
    logger.info(`Classifying ${boxRows.length} box(es)…`);
    const classified = await classifyAllBoxes(boxRows);
    logger.info(`Box buckets: ${JSON.stringify(summarizeBuckets(classified))}`);
    const { results, catalogIds: boxCatalogIds } = await processBoxes(classified, APPLY, {
      forceLtWithStCones: FORCE_LT_WITH_ST_CONES,
      forceIssuedConesOnBox: FORCE_ISSUED_CONES_ON_BOX,
    });
    boxResults = results;
    catalogIds = new Set([...catalogIds, ...boxCatalogIds]);
  }

  if (APPLY && catalogIds.size > 0) {
    const ids = [...catalogIds];
    logger.info(`Syncing YarnInventory for ${ids.length} catalog(s)…`);
    try {
      await syncInventoriesFromStorageForCatalogIds(ids);
    } catch (err) {
      logger.error('[zero-out-dataaudit-orphans] Inventory sync failed:', err?.message || err);
    }
  }

  const outDir = OUT_DIR_ARG ? path.resolve(process.cwd(), OUT_DIR_ARG) : defaultOutDir();
  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    fullCleanup: FULL_CLEANUP,
    forceLtWithStCones: FORCE_LT_WITH_ST_CONES,
    forceIssuedConesOnBox: FORCE_ISSUED_CONES_ON_BOX,
    syncDirUsed: syncDirUsed ?? null,
    conesFile: conesFile ?? null,
    boxesFile: boxesFile ?? null,
    coneInputRows: coneRows.length,
    boxInputRows: boxRows.length,
    coneBuckets: summarizeBuckets(coneResults),
    boxBuckets: summarizeBuckets(boxResults),
    conesUpdated: coneResults.filter((r) => r.status === 'updated').length,
    conesWouldUpdate: coneResults.filter((r) => r.status === 'would_update').length,
    conesApplyErrors: coneResults.filter((r) => r.status === 'error').length,
    boxesUpdated: boxResults.filter((r) => r.status === 'updated').length,
    boxesWouldUpdate: boxResults.filter((r) => r.status === 'would_update').length,
    boxesApplyErrors: boxResults.filter((r) => r.status === 'error').length,
    catalogIdsSynced: APPLY ? catalogIds.size : 0,
  };

  const reportPaths = writeAllReports(outDir, coneResults, boxResults, summary);

  // eslint-disable-next-line no-console
  console.log('\n=== DATAAUDIT orphan zero-out summary ===');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
  // eslint-disable-next-line no-console
  console.log('\nReports written to:', outDir);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(reportPaths, null, 2));

  if (!APPLY) {
    logger.warn('DRY RUN — no DB writes performed. Re-run with --apply to commit.');
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
