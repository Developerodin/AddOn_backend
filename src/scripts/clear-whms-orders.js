#!/usr/bin/env node
/**
 * Clear warehouse fulfilment order-flow data (fresh start for orders pipeline).
 *
 * Deletes ALL documents in:
 *   - WarehouseReturn (RTO/RTV)
 *   - WhmsInvoice (billing)
 *   - ScanSession (scan history)
 *   - PickList + PickListBatch (pick & pack)
 *   - DispatchApproval, VarianceApproval (type=order only)
 *   - ConsolidationBatch, WhmsOrder (legacy)
 *   - WarehouseOrder (main WHMS orders)
 *
 * Does NOT touch:
 *   - Warehouse clients, inward/receive, factory requirements
 *   - Warehouse inventory stock levels or inventory logs
 *   (picks may have deducted stock — re-seed/adjust stock separately if needed)
 *
 * Usage (from AddOn_backend/):
 *   node src/scripts/clear-whms-orders.js            # dry-run (counts only)
 *   node src/scripts/clear-whms-orders.js --execute  # irreversible delete
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import { connectMongooseForScript } from '../../scripts/lib/mongoScriptConnect.js';
import WarehouseOrder from '../models/whms/warehouseOrder.model.js';
import PickList from '../models/whms/pickList.model.js';
import PickListBatch from '../models/whms/pickListBatch.model.js';
import ScanSession from '../models/whms/scanSession.model.js';
import WhmsInvoice from '../models/whms/invoice.model.js';
import WarehouseReturn from '../models/whms/warehouseReturn.model.js';
import WhmsOrder from '../models/whms/whmsOrder.model.js';
import DispatchApproval from '../models/whms/dispatchApproval.model.js';
import VarianceApproval from '../models/whms/varianceApproval.model.js';
import ConsolidationBatch from '../models/whms/consolidationBatch.model.js';

const execute = process.argv.includes('--execute');

/** Child collections first, warehouse orders last. */
/** @type {Array<[string, import('mongoose').Model<unknown>, object?]>} */
const TARGETS = [
  ['Returns (RTO/RTV)', WarehouseReturn],
  ['Invoices (billing)', WhmsInvoice],
  ['Scan sessions (scan history)', ScanSession],
  ['Pick list rows', PickList],
  ['Pick list batches (combined pick)', PickListBatch],
  ['Dispatch approvals (legacy)', DispatchApproval],
  ['Variance approvals (orders)', VarianceApproval, { type: 'order' }],
  ['Consolidation batches (legacy)', ConsolidationBatch],
  ['Legacy WhmsOrder', WhmsOrder],
  ['Warehouse orders', WarehouseOrder],
];

/**
 * Count or delete one target collection.
 * @param {string} label
 * @param {import('mongoose').Model<unknown>} Model
 * @param {object} [filter]
 * @param {boolean} doDelete
 */
async function runTarget(label, Model, filter = {}, doDelete) {
  const count = await Model.countDocuments(filter);
  console.log(`  ${label}: ${count}`);
  if (doDelete && count > 0) {
    const res = await Model.deleteMany(filter);
    console.log(`    → deleted: ${res.deletedCount}`);
  }
}

async function main() {
  await connectMongooseForScript(config);
  const conn = mongoose.connection;
  console.log(`\nConnected to DB: ${conn.name} @ ${conn.host}`);
  console.log(`Mode: ${execute ? 'EXECUTE (irreversible)' : 'DRY-RUN'}\n`);

  for (const [label, Model, filter] of TARGETS) {
    // eslint-disable-next-line no-await-in-loop -- ordered output
    await runTarget(label, Model, filter, false);
  }

  if (!execute) {
    console.log('\nDry-run only. Re-run with --execute to delete everything above.');
    console.log('Example: node src/scripts/clear-whms-orders.js --execute');
    console.log('Note: inventory stock / inventory logs are NOT reset — only order fulfilment docs.\n');
    await mongoose.disconnect();
    return;
  }

  console.log('\nDeleting…');
  let totalDeleted = 0;
  for (const [label, Model, filter] of TARGETS) {
    // eslint-disable-next-line no-await-in-loop
    const count = await Model.countDocuments(filter);
    if (count > 0) {
      const res = await Model.deleteMany(filter);
      totalDeleted += res.deletedCount || 0;
      console.log(`  ${label}: deleted ${res.deletedCount}`);
    }
  }

  console.log(`\nDone — cleared ${totalDeleted} warehouse fulfilment document(s).\n`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
