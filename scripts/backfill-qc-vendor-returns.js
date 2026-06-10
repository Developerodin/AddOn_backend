#!/usr/bin/env node
/**
 * Backfill vendor returns + challans for PO lots already marked `lot_returned_to_vendor`
 * in QC but never run through the hybrid vendor-return pipeline.
 *
 * Usage:
 *   node scripts/backfill-qc-vendor-returns.js                 # dry run (default)
 *   node scripts/backfill-qc-vendor-returns.js --apply         # write returns/challans
 *   node scripts/backfill-qc-vendor-returns.js --apply --limit 10
 *   node scripts/backfill-qc-vendor-returns.js --po PO123       # single PO
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import { YarnPurchaseOrder } from '../src/models/index.js';
import { connectMongooseForScript } from './lib/mongoScriptConnect.js';
import { finalizeQcLotReturn } from '../src/services/yarnManagement/yarnPoVendorReturnQc.service.js';
import { classifyLotBoxesForReturn } from '../src/services/yarnManagement/yarnPoVendorReturnBoxClassifier.js';
import { partitionConesByStorage } from '../src/services/yarnManagement/yarnPoVendorReturnFinalize.lib.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PO_FLAG_IDX = args.indexOf('--po');
const PO_FILTER = PO_FLAG_IDX !== -1 ? String(args[PO_FLAG_IDX + 1] || '').trim() : '';
const LIMIT_FLAG_IDX = args.indexOf('--limit');
const LIMIT = LIMIT_FLAG_IDX !== -1 ? parseInt(args[LIMIT_FLAG_IDX + 1] || '0', 10) || 0 : 0;

const log = (msg, data) => {
  if (data === undefined) {
    console.log(msg);
    return;
  }
  console.log(msg, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
};

/**
 * Runs hybrid QC lot return for backfill (skips if no returnable boxes/cones remain).
 *
 * @param {string} poNumber
 * @param {string} lotNumber
 * @returns {Promise<'skipped'|'dry-run'|'applied'>}
 */
async function backfillLot(poNumber, lotNumber) {
  const { ltBoxes, stCones, excludedCones } = await classifyLotBoxesForReturn(poNumber, lotNumber);
  const { preStorage, inStorage } = partitionConesByStorage(stCones);
  const returnableCount = ltBoxes.length + preStorage.length + inStorage.length;

  if (returnableCount === 0 && excludedCones.length === 0) {
    log(`[skip] ${poNumber} lot ${lotNumber} — no active boxes/cones`);
    return 'skipped';
  }

  if (!APPLY) {
    log(
      `[dry-run] would finalize QC return for ${poNumber} lot ${lotNumber} (${ltBoxes.length} LT box(es), ${preStorage.length} pre-ST cone(s), ${inStorage.length} ST cone(s))`
    );
    return 'dry-run';
  }

  const result = await finalizeQcLotReturn({
    poNumber,
    lotNumber,
    remark: 'Backfill from lot_returned_to_vendor (script)',
    user: { username: 'backfill-script', userId: '' },
  });
  log(`[applied] ${poNumber} lot ${lotNumber}`, {
    autoReturnedBoxCount: result.autoReturnedBoxCount,
    autoReturnedCount: result.autoReturnedCount,
    pendingStCount: result.pendingStCount,
    challanNumber: result.challanNumber,
    boxChallanNumber: result.boxChallan?.challanNumber ?? null,
    coneChallanNumber: result.coneChallan?.challanNumber ?? null,
  });
  return 'applied';
}

const main = async () => {
  const redactedUri = await connectMongooseForScript(config);
  log(`[backfill-qc-vendor-returns] connected to ${redactedUri} (apply=${APPLY})`);

  const query = { 'receivedLotDetails.status': 'lot_returned_to_vendor' };
  if (PO_FILTER) query.poNumber = PO_FILTER;

  let cursor = YarnPurchaseOrder.find(query).select('poNumber receivedLotDetails').lean();
  if (LIMIT > 0) cursor = cursor.limit(LIMIT);
  const pos = await cursor;

  let applied = 0;
  let dryRun = 0;
  let skipped = 0;

  for (const po of pos) {
    for (const lot of po.receivedLotDetails || []) {
      if (lot.status !== 'lot_returned_to_vendor') continue;
      const ln = String(lot.lotNumber || '').trim();
      if (!ln) continue;

      const outcome = await backfillLot(po.poNumber, ln);
      if (outcome === 'applied') applied += 1;
      else if (outcome === 'dry-run') dryRun += 1;
      else skipped += 1;
    }
  }

  log(`[backfill-qc-vendor-returns] done applied=${applied} dry-run=${dryRun} skipped=${skipped}`);
  await mongoose.disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
