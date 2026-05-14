#!/usr/bin/env node

/**
 * One-off / ops: set every `receivedLotDetails` entry on a Yarn PO to `lot_accepted` and
 * align `YarnBox` rows for each `(poNumber, lotNumber)` to `qcData.status: qc_approved`.
 *
 * Mirrors `yarnPurchaseOrderService.qcApproveAllLotsForPo` (same as PATCH .../qc-approve-all).
 *
 * Caveats (see models + service):
 * - Boxes are updated only per lot when `YarnBox` documents match `poNumber` AND `lotNumber`.
 *   If `lotNumber` on boxes is wrong/empty, use `--force-all-boxes-qc` (approves every box on the PO).
 * - `updateMany` does not fire `YarnBox` post-save hooks; LT inventory may need `--resave-lt-boxes`.
 * - PO `currentStatus` is not changed by the service; use `--promote-po-status` + `--user-id`
 *   if the UI still shows `qc_pending` at the PO level.
 *
 * Usage (from AddOn_backend):
 *   node src/scripts/qc-approve-all-lots-yarn-po.js --po=PO-510iwnmat --dry-run
 *   node src/scripts/qc-approve-all-lots-yarn-po.js --po=PO-510iwnmat
 *   node src/scripts/qc-approve-all-lots-yarn-po.js --po=PO-510iwnmat --force-all-boxes-qc --resave-lt-boxes
 *   node src/scripts/qc-approve-all-lots-yarn-po.js --po=PO-510iwnmat --promote-po-status --user-id=<24hex>
 *
 * DB connection (same as `audit-yarn-estimation.js`): `mongoose.connect(config.mongoose.url, config.mongoose.options)`.
 * Override URL only if needed: `--mongo-url=mongodb+srv://...`
 */

// Node 25+ url.parse + mongodb 3.x driver compatibility — must load before mongoose (see lib).
import './lib/mongoUrlParsePatch.js';

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnPurchaseOrder } from '../models/index.js';
import * as yarnPurchaseOrderService from '../services/yarnManagement/yarnPurchaseOrder.service.js';
import { LT_SECTION_CODES } from '../models/storageManagement/storageSlot.model.js';

const LT_STORAGE_PATTERN = new RegExp(`^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`, 'i');

/**
 * Normalize URL for CLI overrides (quotes, BOM, stray CR).
 * @param {string} rawUrl
 * @returns {string}
 */
function sanitizeMongoUrl(rawUrl) {
  let u = String(rawUrl || '').replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  if (u.endsWith('>')) {
    u = u.slice(0, -1);
  }
  return u;
}

/**
 * Same pattern as `audit-yarn-estimation.js`: `config.mongoose.url` + `config.mongoose.options`.
 * Optional override: `--mongo-url=...` (uses same options object from config).
 * @returns {Promise<void>}
 */
async function connectMongo() {
  logger.info('Connecting to MongoDB...');
  const cliArg = process.argv.find((a) => a.startsWith('--mongo-url='));
  const raw = cliArg
    ? sanitizeMongoUrl(cliArg.slice('--mongo-url='.length))
    : String(config?.mongoose?.url || '').trim();
  if (!raw) {
    throw new Error('MongoDB URL is empty. Set MONGODB_URL in .env (loaded via config) or pass --mongo-url=');
  }
  const source = cliArg ? '--mongo-url' : 'config.mongoose.url (from MONGODB_URL in .env)';
  const redactedUrl = raw.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`MongoDB URL (${source}): ${redactedUrl}`);
  await mongoose.connect(raw, config.mongoose.options);
}

/**
 * @param {string} name
 * @param {string} [def]
 * @returns {string}
 */
function argValue(name, def = '') {
  const p = process.argv.find((a) => a.startsWith(`${name}=`));
  return p ? String(p.slice(name.length + 1)).trim() : def;
}

/**
 * @returns {boolean}
 */
function hasFlag(name) {
  return process.argv.includes(name);
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @returns {string}
 */
function resolvePoNumber() {
  const v = argValue('--po', '');
  if (v) return v;
  const rest = process.argv
    .slice(2)
    .filter(
      (a) =>
        !a.startsWith('--mongo-url=') &&
        !a.startsWith('--user-id=') &&
        !a.startsWith('--remarks=') &&
        !a.startsWith('--notes=') &&
        a !== '--dry-run' &&
        a !== '--force-all-boxes-qc' &&
        a !== '--resave-lt-boxes' &&
        a !== '--promote-po-status'
    );
  const pos = rest.find((x) => !String(x).startsWith('-'));
  return pos ? String(pos).trim() : '';
}

/**
 * Build `updated_by` payload for QC service (optional; omit unless you pass `--username` / `--user-id`).
 * Passing no flags avoids writing `qcData.user` / `receivedBy.user` with an empty string.
 * @returns {{ username: string, user_id: string } | null}
 */
function resolveUpdatedByForQc() {
  const username = argValue('--username', '').trim();
  const userId = argValue('--user-id', '').trim();
  if (!username && !userId) {
    return null;
  }
  const out = {
    username: username || 'script:qc-approve-all-lots-yarn-po',
    user_id: userId,
  };
  if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
    delete out.user_id;
  }
  return out;
}

/**
 * Re-save LT stored QC-approved boxes so post-save inventory hook runs (same idea as yarnBox.service).
 * @param {string} poNumber
 * @returns {Promise<{ attempted: number, errors: string[] }>}
 */
async function resaveLtBoxesForInventoryHook(poNumber) {
  const boxes = await YarnBox.find({ poNumber }).exec();
  const errors = [];
  let attempted = 0;
  for (const box of boxes) {
    const isLt = box.storageLocation && LT_STORAGE_PATTERN.test(box.storageLocation);
    const stored = box.storedStatus === true;
    const qcOk = box.qcData?.status === 'qc_approved';
    const hasWeight = Number(box.boxWeight ?? 0) > 0;
    if (!isLt || !stored || !qcOk || !hasWeight) {
      continue;
    }
    attempted += 1;
    try {
      await box.save();
    } catch (e) {
      errors.push(`${box.boxId}: ${e?.message || String(e)}`);
    }
  }
  return { attempted, errors };
}

/**
 * Finds the PO doc for a CLI `poNumber`: exact match, then common `O-…` vs `PO-…` typo, then a single fuzzy hit.
 *
 * @param {string} input - Value from `--po` / positional argument
 * @returns {Promise<{ po: Record<string, unknown>; resolvedPoNumber: string; correctedFrom?: string }>}
 */
async function findPurchaseOrderByPoCli(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) {
    throw new Error('poNumber is empty');
  }

  let po = await YarnPurchaseOrder.findOne({ poNumber: trimmed }).lean();
  if (po) {
    return { po, resolvedPoNumber: trimmed };
  }

  // Typo/copy: "O-2026-510" vs stored "PO-2026-510" (leading "P" dropped)
  const withPoPrefix = trimmed.replace(/^O(?=-)/i, 'PO');
  if (withPoPrefix !== trimmed) {
    po = await YarnPurchaseOrder.findOne({ poNumber: withPoPrefix }).lean();
    if (po) {
      logger.warn(`Resolved poNumber "${trimmed}" → "${withPoPrefix}" (O-… treated as PO-…)`);
      return { po, resolvedPoNumber: withPoPrefix, correctedFrom: trimmed };
    }
  }

  const token = trimmed.split(/[-/]/).filter(Boolean).pop() || trimmed;
  const fuzzy = await YarnPurchaseOrder.find({
    poNumber: { $regex: escapeRegex(token), $options: 'i' },
  })
    .select('poNumber')
    .limit(25)
    .lean();
  const uniq = [...new Set(fuzzy.map((d) => d.poNumber).filter(Boolean))];

  if (uniq.length === 1) {
    const resolved = String(uniq[0]);
    po = await YarnPurchaseOrder.findOne({ poNumber: resolved }).lean();
    if (po) {
      logger.warn(`Resolved poNumber "${trimmed}" → "${resolved}" (only one fuzzy DB match for token "${token}")`);
      return { po, resolvedPoNumber: resolved, correctedFrom: trimmed };
    }
  }

  const hint =
    uniq.length > 0
      ? ` Close poNumber match(es) in DB: ${uniq.join(', ')}. Pick one explicitly with --po=...`
      : ' No fuzzy poNumber matches; confirm the exact string in Mongo.';
  throw new Error(`YarnPurchaseOrder not found for poNumber=${trimmed}.${hint}`);
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const poNumber = resolvePoNumber();
  if (!poNumber) {
    console.error(
      'Usage: node src/scripts/qc-approve-all-lots-yarn-po.js --po=PO-... [--dry-run] [--force-all-boxes-qc] [--resave-lt-boxes] [--promote-po-status --user-id=...]'
    );
    process.exit(1);
  }

  const dryRun = hasFlag('--dry-run');
  const forceAllBoxes = hasFlag('--force-all-boxes-qc');
  const resaveLt = hasFlag('--resave-lt-boxes');
  const promotePo = hasFlag('--promote-po-status');
  const promoteUserId = argValue('--user-id', '');

  if (promotePo && (!promoteUserId || !mongoose.Types.ObjectId.isValid(promoteUserId))) {
    throw new Error('--promote-po-status requires a valid --user-id (MongoDB ObjectId) for statusLogs.updatedBy.user');
  }

  await connectMongo();

  const { po, resolvedPoNumber, correctedFrom } = await findPurchaseOrderByPoCli(poNumber);

  const lots = po.receivedLotDetails || [];
  const allBoxes = await YarnBox.find({ poNumber: resolvedPoNumber })
    .select('boxId lotNumber qcData.status')
    .lean();

  const summary = {
    poNumberInput: poNumber,
    poNumber: resolvedPoNumber,
    ...(correctedFrom && { poNumberCorrectedFrom: correctedFrom }),
    purchaseOrderId: po._id.toString(),
    currentStatus: po.currentStatus,
    lots: lots.map((l) => ({
      lotNumber: l.lotNumber,
      status: l.status,
      boxesForLot: allBoxes.filter((b) => String(b.lotNumber || '').trim() === String(l.lotNumber || '').trim())
        .length,
    })),
    totalBoxesOnPo: allBoxes.length,
    boxesNotQcApproved: allBoxes.filter((b) => b.qcData?.status !== 'qc_approved').length,
  };

  console.log(JSON.stringify({ phase: dryRun ? 'dry_run' : 'preview', ...summary }, null, 2));

  if (dryRun) {
    logger.info('Dry run: no writes.');
    await mongoose.disconnect();
    return;
  }

  const updatedBy = resolveUpdatedByForQc();
  const notes = argValue('--notes', 'Script: QC approve all lots');
  const remarks = argValue('--remarks', 'Backfill: mark lots and box QC approved');

  const result = await yarnPurchaseOrderService.qcApproveAllLotsForPo(
    po._id.toString(),
    updatedBy,
    notes,
    remarks
  );

  console.log(JSON.stringify({ phase: 'qcApproveAllLotsForPo', result }, null, 2));

  if (forceAllBoxes) {
    const now = new Date();
    const upd = await YarnBox.updateMany(
      { poNumber: resolvedPoNumber },
      {
        $set: {
          'qcData.status': 'qc_approved',
          'qcData.date': now,
          ...(remarks !== undefined && { 'qcData.remarks': remarks }),
        },
      }
    );
    logger.info(`--force-all-boxes-qc: modifiedCount=${upd.modifiedCount}`);
  }

  if (resaveLt) {
    const r = await resaveLtBoxesForInventoryHook(resolvedPoNumber);
    logger.info(`--resave-lt-boxes: attempted=${r.attempted}, errors=${r.errors.length}`);
    if (r.errors.length) {
      console.error(JSON.stringify({ resaveLtErrors: r.errors }, null, 2));
    }
  }

  if (promotePo) {
    const fresh = await YarnPurchaseOrder.findById(po._id).lean();
    const rd = fresh?.receivedLotDetails || [];
    const allAccepted = rd.length > 0 && rd.every((l) => l.status === 'lot_accepted');
    const anyRejected = rd.some((l) => l.status === 'lot_rejected');
    let nextStatus = null;
    if (allAccepted && !anyRejected) {
      nextStatus = 'po_accepted';
    } else if (rd.some((l) => l.status === 'lot_accepted')) {
      nextStatus = 'po_accepted_partially';
    }
    if (nextStatus) {
      await yarnPurchaseOrderService.updatePurchaseOrderStatus(
        po._id.toString(),
        nextStatus,
        {
          username: argValue('--username', 'script:qc-approve-all-lots-yarn-po'),
          user_id: promoteUserId,
        },
        notes
      );
      logger.info(`Promoted PO currentStatus -> ${nextStatus}`);
    } else {
      logger.warn('promote-po-status: could not derive po_accepted / partial (check lot statuses)');
    }
  }

  await mongoose.disconnect();
  logger.info('Done.');
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
