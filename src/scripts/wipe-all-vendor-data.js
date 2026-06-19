#!/usr/bin/env node
/**
 * DANGER — wipe ALL vendor purchase-order data across every floor.
 *
 * Deletes (all documents, every VPO):
 *   - VendorPurchaseOrder        (the orders)
 *   - VendorBox                  (intake boxes)
 *   - VendorProductionFlow       (secondary checking / branding / final checking / dispatch)
 *   - VendorGrn                  (goods received notes)
 *   - VendorPoVendorReturn       (VM4 vendor returns)
 *   - VendorPoReturnChallan      (return challans)
 *   - VendorM2Log / M3Log / M4Log(floor logs)
 *   - VendorDispatchStockTransferNote (dispatch STNs)
 * Also strips vendor rows from ContainersMaster.activeItems (factory rows are kept).
 *
 * Does NOT touch: VendorManagement (vendor master profiles) or any factory/production data.
 *
 * Usage:
 *   node src/scripts/wipe-all-vendor-data.js            # dry-run (counts only)
 *   node src/scripts/wipe-all-vendor-data.js --execute  # actually delete (irreversible)
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import { connectMongooseForScript } from '../../scripts/lib/mongoScriptConnect.js';
import VendorPurchaseOrder from '../models/vendorManagement/vendorPurchaseOrder.model.js';
import VendorBox from '../models/vendorManagement/vendorBox.model.js';
import VendorProductionFlow from '../models/vendorManagement/vendorProductionFlow.model.js';
import VendorGrn from '../models/vendorManagement/vendorGrn.model.js';
import VendorPoVendorReturn from '../models/vendorManagement/vendorPoVendorReturn.model.js';
import VendorPoReturnChallan from '../models/vendorManagement/vendorPoReturnChallan.model.js';
import VendorM2Log from '../models/vendorManagement/vendorM2Log.model.js';
import VendorM3Log from '../models/vendorManagement/vendorM3Log.model.js';
import VendorM4Log from '../models/vendorManagement/vendorM4Log.model.js';
import VendorDispatchStockTransferNote from '../models/vendorManagement/vendorDispatchStockTransferNote.model.js';
import ContainersMaster from '../models/production/containersMaster.model.js';

const execute = process.argv.includes('--execute');

/** Collections wiped entirely (model + label). */
const TARGETS = [
  ['Purchase orders', VendorPurchaseOrder],
  ['Boxes', VendorBox],
  ['Production flows', VendorProductionFlow],
  ['GRNs', VendorGrn],
  ['Vendor returns (VM4)', VendorPoVendorReturn],
  ['Return challans', VendorPoReturnChallan],
  ['M2 logs', VendorM2Log],
  ['M3 logs', VendorM3Log],
  ['M4 logs', VendorM4Log],
  ['Dispatch STNs', VendorDispatchStockTransferNote],
];

async function main() {
  await connectMongooseForScript(config);
  const conn = mongoose.connection;
  console.log(`\nConnected to DB: ${conn.name} @ ${conn.host}`);
  console.log(`Mode: ${execute ? 'EXECUTE (irreversible)' : 'DRY-RUN'}\n`);

  // Counts first (always shown).
  for (const [label, Model] of TARGETS) {
    // eslint-disable-next-line no-await-in-loop -- sequential count for clean ordered output
    const count = await Model.estimatedDocumentCount();
    console.log(`  ${label}: ${count}`);
  }
  const containerVendorRows = await ContainersMaster.countDocuments({
    'activeItems.vendorProductionFlow': { $exists: true, $ne: null },
  });
  console.log(`  Containers with vendor rows to strip: ${containerVendorRows}`);

  if (!execute) {
    console.log('\nDry-run only. Re-run with --execute to delete everything above.\n');
    await mongoose.disconnect();
    return;
  }

  console.log('\nDeleting…');
  for (const [label, Model] of TARGETS) {
    // eslint-disable-next-line no-await-in-loop -- sequential deletes for clean ordered output
    const res = await Model.deleteMany({});
    console.log(`  ${label} deleted: ${res.deletedCount}`);
  }

  const containerRes = await ContainersMaster.updateMany(
    { 'activeItems.vendorProductionFlow': { $exists: true, $ne: null } },
    { $pull: { activeItems: { vendorProductionFlow: { $exists: true, $ne: null } } } }
  );
  console.log(`  Containers stripped of vendor rows: ${containerRes.modifiedCount ?? 0}`);

  console.log('\nDone — all vendor order data wiped.\n');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
