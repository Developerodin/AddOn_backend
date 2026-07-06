#!/usr/bin/env node
/**
 * Clear warehouse fulfilment order data for a fresh E2E flow test.
 *
 * Deletes ALL documents in:
 *   - WarehouseReturn, WhmsInvoice, ScanSession, PickList
 *   - DispatchApproval, VarianceApproval (type=order only)
 *   - ConsolidationBatch, WhmsOrder (legacy), WarehouseOrder
 *
 * Does NOT touch: warehouse clients, inward/receive, inventory stock levels,
 * or inventory logs (picks already deducted stock — re-seed stock separately if needed).
 *
 * Usage:
 *   node src/scripts/clear-whms-orders.js            # dry-run (counts only)
 *   node src/scripts/clear-whms-orders.js --execute  # irreversible delete
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import { connectMongooseForScript } from '../../scripts/lib/mongoScriptConnect.js';
import WarehouseOrder from '../models/whms/warehouseOrder.model.js';
import PickList from '../models/whms/pickList.model.js';
import ScanSession from '../models/whms/scanSession.model.js';
import WhmsInvoice from '../models/whms/invoice.model.js';
import WarehouseReturn from '../models/whms/warehouseReturn.model.js';
import WhmsOrder from '../models/whms/whmsOrder.model.js';
import DispatchApproval from '../models/whms/dispatchApproval.model.js';
import VarianceApproval from '../models/whms/varianceApproval.model.js';
import ConsolidationBatch from '../models/whms/consolidationBatch.model.js';

const execute = process.argv.includes('--execute');

/** @type {Array<[string, import('mongoose').Model<unknown>, object?]>} */
const TARGETS = [
  ['Returns (RTO/RTV)', WarehouseReturn],
  ['Invoices', WhmsInvoice],
  ['Scan sessions', ScanSession],
  ['Pick list rows', PickList],
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
    console.log('Note: inventory stock / pick logs are NOT reset — only order fulfilment docs.\n');
    await mongoose.disconnect();
    return;
  }

  console.log('\nDeleting…');
  for (const [label, Model, filter] of TARGETS) {
    // eslint-disable-next-line no-await-in-loop
    await runTarget(label, Model, filter, true);
  }

  console.log('\nDone — warehouse orders and fulfilment data cleared.\n');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
