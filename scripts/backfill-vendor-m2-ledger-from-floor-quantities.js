#!/usr/bin/env node
/**
 * Backfill vendor M2 Management ledger from existing QC floor m2Quantity on VendorProductionFlow.
 *
 * For each flow + QC floor (secondaryChecking, finalChecking) where m2Quantity > 0,
 * compares against open/partial ENTRY rows in vendor_m2_logs. Creates ENTRY for the gap.
 *
 * Usage:
 *   node scripts/backfill-vendor-m2-ledger-from-floor-quantities.js
 *   node scripts/backfill-vendor-m2-ledger-from-floor-quantities.js --apply
 *   node scripts/backfill-vendor-m2-ledger-from-floor-quantities.js --apply --reference REF-001
 *   node scripts/backfill-vendor-m2-ledger-from-floor-quantities.js --apply --limit 50
 */
import 'dotenv/config';
import VendorProductionFlow from '../src/models/vendorManagement/vendorProductionFlow.model.js';
import VendorM2Log from '../src/models/vendorManagement/vendorM2Log.model.js';
import { M2LogType, M2EntryStatus } from '../src/models/production/enums.js';
import { recordVendorM2Entry } from '../src/services/vendorManagement/vendorM2Management.service.js';
import { connectMongooseForScript } from './lib/mongoScriptConnect.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LIMIT_FLAG = args.indexOf('--limit');
const LIMIT = LIMIT_FLAG !== -1 ? parseInt(args[LIMIT_FLAG + 1] || '0', 10) || 0 : 0;
const REF_FLAG = args.indexOf('--reference');
const REFERENCE = REF_FLAG !== -1 ? String(args[REF_FLAG + 1] || '').trim() : '';

const QC_FLOOR_KEYS = ['secondaryChecking', 'finalChecking'];

/**
 * @param {number} value
 * @returns {number}
 */
const normalizeQty = (value) => Math.round(Number(value || 0));

/**
 * Sum open vendor M2 ledger qty for one flow on one QC floor.
 * @param {string} flowIdStr
 * @param {string} sourceFloor
 * @returns {Promise<number>}
 */
const sumOpenLedgerForFloor = async (flowIdStr, sourceFloor) => {
  const rows = await VendorM2Log.find({
    vendorProductionFlowId: flowIdStr,
    sourceFloor,
    type: M2LogType.ENTRY,
    status: { $in: [M2EntryStatus.OPEN, M2EntryStatus.PARTIAL] },
  })
    .select('remainingQuantity')
    .lean();
  return normalizeQty(rows.reduce((s, r) => s + (r.remainingQuantity || 0), 0));
};

/**
 * Build Mongo filter for flows with any QC floor m2Quantity > 0.
 * @returns {object}
 */
const buildFlowQuery = () => {
  const query = {
    $or: QC_FLOOR_KEYS.map((key) => ({
      [`floorQuantities.${key}.m2Quantity`]: { $gt: 0 },
    })),
  };
  if (REFERENCE) query.referenceCode = REFERENCE;
  return query;
};

async function main() {
  await connectMongooseForScript();

  const query = buildFlowQuery();
  let cursor = VendorProductionFlow.find(query).cursor();
  if (LIMIT > 0) {
    const ids = await VendorProductionFlow.find(query).limit(LIMIT).select('_id').lean();
    cursor = VendorProductionFlow.find({ _id: { $in: ids.map((d) => d._id) } }).cursor();
  }

  let scanned = 0;
  let entriesCreated = 0;
  let totalGap = 0;

  for await (const flow of cursor) {
    scanned += 1;
    const flowIdStr = flow._id.toString();

    for (const floorKey of QC_FLOOR_KEYS) {
      const floorM2 = normalizeQty(flow.floorQuantities?.[floorKey]?.m2Quantity);
      if (floorM2 <= 0) continue;

      const ledgerOpen = await sumOpenLedgerForFloor(flowIdStr, floorKey);
      const gap = normalizeQty(floorM2 - ledgerOpen);
      if (gap <= 0) continue;

      totalGap += gap;
      entriesCreated += 1;

      if (APPLY) {
        await recordVendorM2Entry({
          flow,
          sourceFloor: floorKey,
          deltaQuantity: gap,
          previousFloorTotal: ledgerOpen,
          newFloorTotal: floorM2,
          user: { id: 'backfill-script', name: 'Backfill Script' },
          remarks: `Backfill vendor M2 ledger gap on ${floorKey}`,
        });
        console.log(`[apply] flow ${flowIdStr} ${floorKey}: +${gap} (floor=${floorM2}, ledger=${ledgerOpen})`);
      } else {
        console.log(`[dry-run] flow ${flowIdStr} ${floorKey}: would create ENTRY +${gap}`);
      }
    }
  }

  console.log(
    `\nDone (${APPLY ? 'APPLY' : 'DRY-RUN'}): scanned=${scanned}, entries=${entriesCreated}, totalGap=${totalGap}`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
