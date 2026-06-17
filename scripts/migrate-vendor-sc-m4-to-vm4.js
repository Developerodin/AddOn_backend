#!/usr/bin/env node
/**
 * Migrate legacy secondaryChecking.m4Quantity → vm4Quantity on vendor production flows.
 *
 * Usage:
 *   node scripts/migrate-vendor-sc-m4-to-vm4.js
 *   node scripts/migrate-vendor-sc-m4-to-vm4.js --apply
 */
import 'dotenv/config';
import VendorProductionFlow from '../src/models/vendorManagement/vendorProductionFlow.model.js';
import { connectMongooseForScript } from './lib/mongoScriptConnect.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  await connectMongooseForScript();

  const cursor = VendorProductionFlow.find({
    'floorQuantities.secondaryChecking.m4Quantity': { $gt: 0 },
  }).cursor();

  let scanned = 0;
  let migrated = 0;
  let totalQty = 0;

  for await (const flow of cursor) {
    scanned += 1;
    const legacyM4 = Number(flow.floorQuantities?.secondaryChecking?.m4Quantity ?? 0);
    if (!Number.isFinite(legacyM4) || legacyM4 <= 0) continue;

    migrated += 1;
    totalQty += legacyM4;

    if (APPLY) {
      await VendorProductionFlow.updateOne(
        { _id: flow._id },
        {
          $inc: { 'floorQuantities.secondaryChecking.vm4Quantity': legacyM4 },
          $unset: { 'floorQuantities.secondaryChecking.m4Quantity': '' },
        }
      );
      console.log(`[apply] flow ${flow._id}: moved m4Quantity=${legacyM4} → vm4Quantity`);
    } else {
      console.log(`[dry-run] flow ${flow._id}: would move m4Quantity=${legacyM4} → vm4Quantity`);
    }
  }

  console.log(
    `\nDone (${APPLY ? 'APPLY' : 'DRY-RUN'}): scanned=${scanned}, migrated=${migrated}, totalQty=${totalQty}`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
