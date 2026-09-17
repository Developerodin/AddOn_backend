#!/usr/bin/env node

/**
 * Zero ghost LT leftover on box barcode `69941f899c9936ad06eb4929`
 * (BOX-PO-2026-993-MU2410221-1771315081697-54).
 *
 * Carton was opened (39 YarnCone docs, conesIssued). Remaining-math then
 * rewrote boxWeight = initialBoxWeight − ST slotted coneWeight (38.55 − 17.966
 * = 20.584) because header numberOfCones=40 blocked the empty-carton gate.
 *
 * This script does NOT touch YarnCone rows. It:
 *   - sets boxWeight=0, storedStatus=false, unsets storageLocation
 *   - sets numberOfCones to the live YarnCone count so later cone saves
 *     cannot re-inflate leftover (39 >= 39 → fullyTransferred)
 *   - optionally resyncs YarnInventory for the catalog
 *
 * Dry-run by default.
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/fix-ghost-lt-box-69941f89.js
 *   NODE_ENV=development node src/scripts/fix-ghost-lt-box-69941f89.js --apply
 *   NODE_ENV=development node src/scripts/fix-ghost-lt-box-69941f89.js --barcode=69941f899c9936ad06eb4929 --apply
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnCone } from '../models/index.js';
import { syncInventoriesFromStorageForCatalogIds } from '../services/yarnManagement/yarnInventory.service.js';

const DEFAULT_BARCODE = '69941f899c9936ad06eb4929';
const APPLY = process.argv.includes('--apply');
const SKIP_INVENTORY = process.argv.includes('--skip-inventory');
const FORCE = process.argv.includes('--force');

/**
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
 * @param {unknown} v
 * @returns {number}
 */
function num(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Snapshot carton + cone math for the report (read-only).
 * @param {object} box
 * @returns {Promise<object>}
 */
async function snapshot(box) {
  const cones = await YarnCone.find({ boxId: box.boxId })
    .select('barcode coneWeight tearWeight issueStatus coneStorageId returnedToVendorAt')
    .lean();
  const active = cones.filter((c) => c.returnedToVendorAt == null);
  const st = active.filter((c) => c.coneStorageId != null && String(c.coneStorageId).trim() !== '');
  const stSum = st.reduce((s, c) => s + num(c.coneWeight), 0);
  const byStatus = active.reduce((acc, c) => {
    const k = String(c.issueStatus || 'unknown');
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  return {
    _id: String(box._id),
    barcode: box.barcode,
    boxId: box.boxId,
    poNumber: box.poNumber,
    yarnName: box.yarnName,
    yarnCatalogId: box.yarnCatalogId ? String(box.yarnCatalogId) : null,
    lotNumber: box.lotNumber,
    boxWeight: num(box.boxWeight),
    initialBoxWeight: box.initialBoxWeight != null ? num(box.initialBoxWeight) : null,
    numberOfConesHeader: box.numberOfCones ?? null,
    coneData: box.coneData || null,
    storageLocation: box.storageLocation || null,
    storedStatus: box.storedStatus === true,
    coneDocs: cones.length,
    byStatus,
    stSlotted: st.length,
    stConeWeightSum: Math.round(stSum * 1000) / 1000,
    ghostMath:
      box.initialBoxWeight != null
        ? Math.round((num(box.initialBoxWeight) - stSum) * 1000) / 1000
        : null,
  };
}

/**
 * Persist empty-carton fields without going through YarnBox.save hooks.
 * @param {object} box
 * @param {number} movedConeCount
 * @returns {Promise<void>}
 */
async function zeroGhostCarton(box, movedConeCount) {
  const existing = box.coneData && typeof box.coneData === 'object' ? box.coneData : {};
  const coneCount = movedConeCount > 0 ? movedConeCount : num(existing.numberOfCones);
  await YarnBox.updateOne(
    { _id: box._id },
    {
      $set: {
        boxWeight: 0,
        storedStatus: false,
        numberOfCones: coneCount,
        coneData: {
          ...existing,
          conesIssued: true,
          numberOfCones: coneCount || existing.numberOfCones,
          coneIssueDate: existing.coneIssueDate || new Date(),
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
  const barcode = String(getArg('--barcode=') || DEFAULT_BARCODE).trim();
  const { url, source } = resolveMongoConnectionString();
  if (!url) throw new Error('MongoDB URL missing. Set MONGODB_URL or pass --mongo-url=');

  logger.info(
    `[fix-ghost-lt-box] Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} (${source}) barcode=${barcode}`
  );
  await mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    const box = await YarnBox.findOne({ barcode }).lean();
    if (!box) throw new Error(`YarnBox not found for barcode ${barcode}`);

    const before = await snapshot(box);
    const reasons = [];
    if (before.coneDocs <= 0) reasons.push('no YarnCone docs — refusing to zero an unopened carton');
    if (!FORCE && !box.coneData?.conesIssued && before.coneDocs <= 0) {
      reasons.push('conesIssued is false');
    }
    if (!FORCE && num(box.boxWeight) <= 0 && !box.storageLocation) {
      reasons.push('already boxWeight=0 and unslotted');
    }
    if (reasons.length) {
      logger.warn(`[fix-ghost-lt-box] SKIP: ${reasons.join('; ')}`);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', skipped: true, reasons, before }, null, 2));
      return;
    }

    if (APPLY) {
      await zeroGhostCarton(box, before.coneDocs);
      if (!SKIP_INVENTORY && before.yarnCatalogId) {
        await syncInventoriesFromStorageForCatalogIds([before.yarnCatalogId]);
      }
    }

    const afterBox = APPLY ? await YarnBox.findById(box._id).lean() : box;
    const afterLive = APPLY ? await snapshot(afterBox) : before;
    const after = APPLY
      ? afterLive
      : {
          ...before,
          boxWeight: 0,
          storedStatus: false,
          storageLocation: null,
          numberOfConesHeader: before.coneDocs,
          coneData: {
            ...(before.coneData || {}),
            conesIssued: true,
            numberOfCones: before.coneDocs,
          },
          planned: true,
        };

    const summary = {
      mode: APPLY ? 'apply' : 'dry-run',
      mongoSource: source,
      wouldWrite: true,
      written: APPLY,
      inventorySynced: Boolean(APPLY && !SKIP_INVENTORY && before.yarnCatalogId),
      note:
        'Ghost kg = initialBoxWeight − current ST slotted coneWeight. Used cones (weight 0) are ignored by remaining-math; this write zeros the carton and aligns header cone count to YarnCone docs so the gate cannot re-inflate.',
      before,
      after,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
    if (!APPLY) logger.warn('DRY RUN — no DB writes. Re-run with --apply to commit.');
  } finally {
    await mongoose.disconnect();
  }
  process.exit(0);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
