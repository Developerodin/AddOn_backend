#!/usr/bin/env node

/**
 * Remove LT YarnBoxes from rack storage when cones were already transferred to ST.
 *
 * Matches boxes still showing on LT (storedStatus + storageLocation + boxWeight) while
 * active cones sit on ST racks for the same boxId. Does NOT modify cones.
 *
 * Per box (same rules as storageSlot auto-fix + backfillLtBoxWeightFromStCones):
 *   - Recompute remaining LT weight from ST cone gross weights
 *   - storedStatus → false, $unset storageLocation (remove from LT slot)
 *   - boxWeight → 0 when fully transferred, else remaining kg
 *   - coneData.conesIssued → true, numberOfCones → active ST cone count
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/fix-lt-boxes-transferred-to-st.js --dry-run
 *   NODE_ENV=development node src/scripts/fix-lt-boxes-transferred-to-st.js --apply
 *   NODE_ENV=development node src/scripts/fix-lt-boxes-transferred-to-st.js --apply --po=PO-2026-997
 *   NODE_ENV=production node src/scripts/fix-lt-boxes-transferred-to-st.js --mongo-url="$PROD_MONGODB_URL" --dry-run
 *
 * Flags:
 *   --dry-run              Default unless --apply
 *   --apply                Persist updates + inventory sync
 *   --po=PO-NUMBER         Limit to one PO
 *   --box-barcode=ID       Repeatable or comma-separated box barcodes
 *   --out-dir=PATH         Report output (default ./reports/fix-lt-transferred-<timestamp>)
 *   --mongo-url=URL
 */

import './lib/mongoUrlParsePatch.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox } from '../models/index.js';
import { syncInventoriesFromStorageForCatalogIds } from '../services/yarnManagement/yarnInventory.service.js';
import { computeLtRemainingBoxWeight } from '../services/yarnManagement/yarnBoxLtRemaining.helper.js';
import { WEIGHT_EPS_KG, num } from './lib/yarnLtStAuditHelpers.js';
import {
  findLtBoxesWithStCones,
  buildLtBoxWithStConesRow,
} from './lib/ltBoxesWithStCones.lib.js';

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

const PO_FILTER = getArg('--po=');
const OUT_DIR_ARG = getArg('--out-dir=');
const APPLY = process.argv.includes('--apply');
const MONGO_URL = getArg('--mongo-url=');

/**
 * Collects `--box-barcode=` values (repeat flag or comma-separated).
 * @returns {string[]}
 */
function collectBoxBarcodes() {
  /** @type {string[]} */
  const barcodes = [];
  for (const arg of process.argv) {
    if (!arg.startsWith('--box-barcode=')) continue;
    const raw = arg.slice('--box-barcode='.length).trim();
    for (const part of raw.split(',')) {
      const b = part.trim();
      if (b) barcodes.push(b);
    }
  }
  return barcodes;
}

const BOX_BARCODES = collectBoxBarcodes();

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
 * Resolves MongoDB connection string.
 * @returns {{ url: string, source: string }}
 */
function resolveMongoConnectionString() {
  const cli = sanitizeMongoUrl(MONGO_URL || '');
  if (cli) return { url: cli, source: '--mongo-url' };
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) return { url: cfg, source: 'config.mongoose.url' };
  const env = sanitizeMongoUrl(String(process.env.MONGODB_URL || process.env.ATLAS_MONGODB_URL || ''));
  return { url: env, source: 'process.env' };
}

/**
 * Builds target after-state for an LT box whose cones are on ST.
 * @param {import('./lib/ltBoxesWithStCones.lib.js').LtBoxWithStConesCandidate} candidate
 * @returns {{ after: Record<string, unknown>, fullyTransferred: boolean, remaining: number, baseWeight: number }}
 */
export function buildLtDetachPayload(candidate) {
  const { box, stCones, allConesInSlots, returnedVendorCones } = candidate;
  const { remaining, fullyTransferred, baseWeight } = computeLtRemainingBoxWeight(
    box,
    allConesInSlots,
    returnedVendorCones
  );

  const boxWeightAfter = fullyTransferred ? 0 : remaining;
  const existingConeData =
    box.coneData && typeof box.coneData === 'object' ? /** @type {Record<string, unknown>} */ (box.coneData) : {};

  const after = {
    boxWeight: boxWeightAfter,
    storedStatus: false,
    storageLocation: '',
    coneData: {
      ...existingConeData,
      conesIssued: true,
      numberOfCones: stCones.length,
      coneIssueDate: new Date(),
    },
  };

  return { after, fullyTransferred, remaining, baseWeight };
}

/**
 * Applies LT detach update for one candidate box.
 * @param {import('./lib/ltBoxesWithStCones.lib.js').LtBoxWithStConesCandidate} candidate
 * @param {boolean} apply
 * @returns {Promise<{ status: string, message?: string, after?: Record<string, unknown> }>}
 */
export async function applyLtDetach(candidate, apply) {
  const { box } = candidate;
  const { after, fullyTransferred, remaining, baseWeight } = buildLtDetachPayload(candidate);

  const before = {
    boxWeight: num(box.boxWeight),
    storedStatus: box.storedStatus === true,
    storageLocation: String(box.storageLocation ?? ''),
    conesIssued: box.coneData?.conesIssued === true,
  };

  if (
    before.storedStatus === false &&
    before.storageLocation === '' &&
    Math.abs(before.boxWeight - after.boxWeight) <= WEIGHT_EPS_KG
  ) {
    return { status: 'already_fixed', after, message: 'already_detached' };
  }

  if (!apply) {
    return { status: 'would_update', after, fullyTransferred, remaining, baseWeight, before };
  }

  try {
    await YarnBox.updateOne(
      { _id: box._id },
      {
        $set: {
          boxWeight: after.boxWeight,
          storedStatus: false,
          coneData: after.coneData,
        },
        $unset: { storageLocation: '' },
      }
    );
    return { status: 'updated', after, fullyTransferred, remaining, baseWeight, before };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
      before,
    };
  }
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {object[]} rows
 * @returns {string}
 */
function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(',')),
  ].join('\n');
}

/**
 * Writes fix reports to outDir.
 * @param {string} outDir
 * @param {Record<string, unknown>[]} results
 * @param {Record<string, unknown>} summary
 * @returns {Record<string, string>}
 */
function writeReports(outDir, results, summary) {
  fs.mkdirSync(outDir, { recursive: true });

  const updated = results.filter((r) => ['updated', 'would_update'].includes(String(r.status)));
  const alreadyFixed = results.filter((r) => r.status === 'already_fixed');
  const errors = results.filter((r) => r.status === 'error');

  const paths = {
    fixed: path.join(outDir, 'lt-boxes-detached.csv'),
    alreadyFixed: path.join(outDir, 'lt-boxes-already-fixed.csv'),
    errors: path.join(outDir, 'lt-boxes-errors.csv'),
    summary: path.join(outDir, 'summary.json'),
  };

  fs.writeFileSync(paths.fixed, toCsv(updated.length ? updated : [{ note: 'No rows' }]), 'utf8');
  fs.writeFileSync(
    paths.alreadyFixed,
    toCsv(alreadyFixed.length ? alreadyFixed : [{ note: 'No rows' }]),
    'utf8'
  );
  fs.writeFileSync(paths.errors, toCsv(errors.length ? errors : [{ note: 'No rows' }]), 'utf8');
  fs.writeFileSync(paths.summary, JSON.stringify(summary, null, 2), 'utf8');

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(updated.length ? updated : [{ note: 'No rows' }]), 'Fixed');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(errors.length ? errors : [{ note: 'No rows' }]),
    'Errors'
  );
  XLSX.writeFile(wb, path.join(outDir, 'lt-boxes-detached.xlsx'));

  return paths;
}

/**
 * Flattens a fix result row for CSV export.
 * @param {Record<string, unknown>} r
 * @returns {Record<string, unknown>}
 */
function flattenResult(r) {
  const before = /** @type {Record<string, unknown>} */ (r.before || {});
  const after = /** @type {Record<string, unknown>} */ (r.after || {});
  return {
    status: r.status ?? '',
    boxBarcode: r.boxBarcode ?? '',
    boxId: r.boxId ?? '',
    poNumber: r.poNumber ?? '',
    yarnName: r.yarnName ?? '',
    yarnCatalogId: r.yarnCatalogId ?? '',
    stConeCount: r.stConeCount ?? '',
    fullyTransferred: r.fullyTransferred ?? '',
    baseWeight: r.baseWeight ?? '',
    remaining: r.remaining ?? '',
    beforeBoxWeight: before.boxWeight ?? '',
    beforeStorageLocation: before.storageLocation ?? '',
    beforeStoredStatus: before.storedStatus ?? '',
    afterBoxWeight: after.boxWeight ?? '',
    afterStorageLocation: after.storageLocation ?? '',
    afterStoredStatus: after.storedStatus ?? '',
    message: r.message ?? '',
  };
}

/**
 * Main entry.
 * @returns {Promise<void>}
 */
async function main() {
  const { url, source } = resolveMongoConnectionString();
  if (!url) throw new Error('MongoDB URL missing. Set MONGODB_URL or pass --mongo-url=');

  logger.info(`[fix-lt-boxes-transferred-to-st] Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} (${source})`);
  await mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    const candidates = await findLtBoxesWithStCones({
      poFilter: PO_FILTER,
      boxBarcodes: BOX_BARCODES.length ? BOX_BARCODES : null,
    });

    logger.info(`Found ${candidates.length} LT box(es) with active ST cones`);

    /** @type {Set<string>} */
    const catalogIds = new Set();
    /** @type {Record<string, unknown>[]} */
    const results = [];

    for (const candidate of candidates) {
      const applyResult = await applyLtDetach(candidate, APPLY);
      const row = buildLtBoxWithStConesRow(candidate);
      if (candidate.box.yarnCatalogId) catalogIds.add(String(candidate.box.yarnCatalogId));
      results.push({
        ...row,
        ...applyResult,
        fullyTransferred: applyResult.fullyTransferred,
        remaining: applyResult.remaining,
        baseWeight: applyResult.baseWeight,
        before: applyResult.before,
      });
    }

    if (APPLY && catalogIds.size > 0) {
      logger.info(`Syncing YarnInventory for ${catalogIds.size} catalog(s)…`);
      try {
        await syncInventoriesFromStorageForCatalogIds([...catalogIds]);
      } catch (err) {
        logger.error('[fix-lt-boxes-transferred-to-st] Inventory sync failed:', err?.message || err);
      }
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outDir = OUT_DIR_ARG
      ? path.resolve(process.cwd(), OUT_DIR_ARG)
      : path.resolve(process.cwd(), `reports/fix-lt-transferred-${ts}`);

    const flatResults = results.map(flattenResult);
    const summary = {
      mode: APPLY ? 'apply' : 'dry-run',
      candidates: candidates.length,
      updated: results.filter((r) => r.status === 'updated').length,
      wouldUpdate: results.filter((r) => r.status === 'would_update').length,
      alreadyFixed: results.filter((r) => r.status === 'already_fixed').length,
      errors: results.filter((r) => r.status === 'error').length,
      poFilter: PO_FILTER || null,
      boxBarcodeFilter: BOX_BARCODES.length ? BOX_BARCODES : null,
      catalogIdsSynced: APPLY ? catalogIds.size : 0,
    };

    const reportPaths = writeReports(outDir, flatResults, summary);

    // eslint-disable-next-line no-console
    console.log('\n=== Fix LT boxes transferred to ST ===');
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
    // eslint-disable-next-line no-console
    console.log('\nReports:', outDir);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(reportPaths, null, 2));

    if (!APPLY) {
      logger.warn('DRY RUN — no DB writes. Re-run with --apply to commit.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
