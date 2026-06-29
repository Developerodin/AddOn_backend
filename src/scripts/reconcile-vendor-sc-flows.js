#!/usr/bin/env node
/**
 * Audit and repair vendor secondary-checking quantities on production flows.
 * Recomputes plannedQuantity / pendingFromBoxes / received from vendor boxes.
 *
 * Usage:
 *   node src/scripts/reconcile-vendor-sc-flows.js                    # dry-run all flows
 *   node src/scripts/reconcile-vendor-sc-flows.js --execute         # fix all drifted flows
 *   node src/scripts/reconcile-vendor-sc-flows.js --vpo=VPO-2026-0004 --execute
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import { connectMongooseForScript } from '../../scripts/lib/mongoScriptConnect.js';
import VendorPurchaseOrder from '../models/vendorManagement/vendorPurchaseOrder.model.js';
import VendorProductionFlow from '../models/vendorManagement/vendorProductionFlow.model.js';
import VendorBox from '../models/vendorManagement/vendorBox.model.js';
import Product from '../models/product.model.js';
import {
  auditSecondaryCheckingDrift,
  reconcileSecondaryCheckingFromBoxes,
} from '../services/vendorManagement/vendorProductionFlowBoxReconcile.util.js';

/**
 * @param {string[]} argv
 * @returns {{ vpoNumber: string, execute: boolean }}
 */
function parseArgs(argv) {
  const vpoArg = argv.find((a) => a.startsWith('--vpo='));
  return {
    vpoNumber: vpoArg ? vpoArg.slice('--vpo='.length).trim() : '',
    execute: argv.includes('--execute'),
  };
}

/**
 * Loads vendor boxes for a flow's article key.
 * @param {object} flow
 * @returns {Promise<object[]>}
 */
async function loadBoxesForFlow(flow) {
  return VendorBox.find({
    vendor: flow.vendor,
    vendorPurchaseOrderId: flow.vendorPurchaseOrder,
    productId: flow.product,
  }).lean();
}

async function main() {
  const { vpoNumber, execute } = parseArgs(process.argv.slice(2));
  await connectMongooseForScript(config);

  let flowFilter = {};
  if (vpoNumber) {
    const vpo = await VendorPurchaseOrder.findOne({ vpoNumber }).lean();
    if (!vpo) {
      throw new Error(`VPO not found: ${vpoNumber}`);
    }
    flowFilter = { vendorPurchaseOrder: vpo._id };
  }

  const flows = await VendorProductionFlow.find(flowFilter).lean();
  const drifted = [];

  for (const flow of flows) {
    const boxes = await loadBoxesForFlow(flow);
    if (!boxes.length && !(flow.plannedQuantity > 0)) continue;

    const report = auditSecondaryCheckingDrift(flow, boxes);
    if (!report.hasDrift) continue;

    const product = await Product.findById(flow.product).select('name').lean();
    const vpo = await VendorPurchaseOrder.findById(flow.vendorPurchaseOrder).select('vpoNumber').lean();

    drifted.push({
      flowId: String(flow._id),
      vpoNumber: vpo?.vpoNumber || '?',
      productName: product?.name || String(flow.product),
      expected: report.expected,
      actual: report.actual,
    });
  }

  console.log(`\nVendor SC flow reconcile — ${execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Examined ${flows.length} flow(s), found ${drifted.length} with drift.\n`);

  if (!drifted.length) {
    console.log('No drift detected. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  for (const row of drifted) {
    console.log(`— ${row.vpoNumber} / ${row.productName} (${row.flowId})`);
    console.log(`    planned:  ${row.actual.planned.toLocaleString()} → ${row.expected.planned.toLocaleString()}`);
    console.log(`    pending:  ${row.actual.pending.toLocaleString()} → ${row.expected.pending.toLocaleString()}`);
    console.log(`    received: ${row.actual.received.toLocaleString()} → ${row.expected.received.toLocaleString()}`);
  }

  if (!execute) {
    console.log('\nRe-run with --execute to apply fixes.');
    await mongoose.disconnect();
    return;
  }

  let fixed = 0;
  for (const row of drifted) {
    const flow = await VendorProductionFlow.findById(row.flowId).lean();
    if (!flow) continue;
    await reconcileSecondaryCheckingFromBoxes({
      vendor: flow.vendor,
      vendorPurchaseOrder: flow.vendorPurchaseOrder,
      product: flow.product,
    });
    fixed += 1;
  }

  console.log(`\nFixed ${fixed} flow(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
