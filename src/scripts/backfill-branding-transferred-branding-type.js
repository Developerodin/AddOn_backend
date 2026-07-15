/**
 * Backfill missing brandingType on branding.transferredData (legacy HT lines show without type label).
 *
 * Usage:
 *   node src/scripts/backfill-branding-transferred-branding-type.js                    # dry-run all
 *   node src/scripts/backfill-branding-transferred-branding-type.js --execute          # apply all
 *   node src/scripts/backfill-branding-transferred-branding-type.js --vpo=VPO-2026-0001 --execute
 */
import mongoose from 'mongoose';
import config from '../config/config.js';
import { VendorPurchaseOrder } from '../models/index.js';
import { backfillBrandingTransferredDataBrandingTypes } from '../services/vendorManagement/vendorProductionFlow.service.js';

/**
 * Parse CLI args for backfill script.
 * @param {string[]} argv
 * @returns {{ execute: boolean, vpoNumber: string }}
 */
function parseArgs(argv) {
  const vpoArg = argv.find((a) => a.startsWith('--vpo='));
  return {
    execute: argv.includes('--execute'),
    vpoNumber: vpoArg ? vpoArg.slice('--vpo='.length).trim() : '',
  };
}

async function main() {
  const { execute, vpoNumber } = parseArgs(process.argv.slice(2));
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  const options = { dryRun: !execute };
  if (vpoNumber) {
    const vpo = await VendorPurchaseOrder.findOne({ vpoNumber }).lean();
    if (!vpo) {
      throw new Error(`VPO not found: ${vpoNumber}`);
    }
    options.vendorPurchaseOrderId = String(vpo._id);
    console.log(`Filtering to VPO ${vpoNumber} (${options.vendorPurchaseOrderId})`);
  }

  const result = await backfillBrandingTransferredDataBrandingTypes(options);
  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
