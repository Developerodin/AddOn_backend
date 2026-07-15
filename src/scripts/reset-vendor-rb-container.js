#!/usr/bin/env node
/**
 * Reset one vendor re-boarding container accept so it reappears in RB Upcoming.
 * Rolls back reBoarding.received/receivedData for that container only, then re-stages the container.
 *
 * Usage:
 *   node src/scripts/reset-vendor-rb-container.js --container=699865138112b2ead703407e           # dry-run
 *   node src/scripts/reset-vendor-rb-container.js --container=699865138112b2ead703407e --execute
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import { connectMongooseForScript } from '../../scripts/lib/mongoScriptConnect.js';
import ContainersMaster from '../models/production/containersMaster.model.js';
import VendorProductionFlow from '../models/vendorManagement/vendorProductionFlow.model.js';
import { computeDerivedForFloor } from '../services/vendorManagement/vendorProductionFlowFloorPatch.js';

/**
 * @param {string[]} argv
 * @returns {{ containerId: string, execute: boolean }}
 */
function parseArgs(argv) {
  const arg = argv.find((a) => a.startsWith('--container='));
  const containerId = arg ? arg.slice('--container='.length).trim() : '';
  if (!containerId) {
    throw new Error('Pass --container=<containerObjectId or barcode>');
  }
  return { containerId, execute: argv.includes('--execute') };
}

/**
 * Find container by ObjectId or barcode.
 * @param {string} idOrBarcode
 * @returns {Promise<import('mongoose').Document|null>}
 */
async function findContainer(idOrBarcode) {
  if (/^[0-9a-fA-F]{24}$/.test(idOrBarcode)) {
    const byId = await ContainersMaster.findById(idOrBarcode);
    if (byId) return byId;
  }
  return ContainersMaster.findOne({ barcode: idOrBarcode });
}

/**
 * Re-stage container for re-boarding accept re-test.
 * @param {import('mongoose').Document} container
 * @param {string} flowId
 * @param {number} quantity
 * @param {Array<object>} transferItems
 */
function buildReBoardingStage(container, flowId, quantity, transferItems) {
  return {
    activeFloor: 'Re-Boarding',
    activeItems: [
      {
        vendorProductionFlow: new mongoose.Types.ObjectId(flowId),
        quantity,
        transferItems,
      },
    ],
  };
}

async function main() {
  const { containerId, execute } = parseArgs(process.argv.slice(2));
  await connectMongooseForScript(config);

  const container = await findContainer(containerId);
  if (!container) {
    throw new Error(`Container not found: ${containerId}`);
  }

  const cid = String(container._id);
  const flows = await VendorProductionFlow.find({
    'floorQuantities.reBoarding.receivedData.receivedInContainerId': container._id,
  }).lean();

  if (flows.length === 0) {
    throw new Error(
      `No flow has reBoarding.receivedData for container ${cid}. Cannot infer staging payload.`
    );
  }
  if (flows.length > 1) {
    throw new Error(`Multiple flows reference container ${cid} on reBoarding — aborting for safety.`);
  }

  const flow = flows[0];
  const flowId = String(flow._id);
  const rb = flow.floorQuantities?.reBoarding || {};
  const rbRowsForContainer = (rb.receivedData || []).filter(
    (r) => String(r.receivedInContainerId || '') === cid
  );
  if (rbRowsForContainer.length === 0) {
    throw new Error(`Flow ${flowId} has no reBoarding receivedData rows for container ${cid}`);
  }

  const rollbackQty = rbRowsForContainer.reduce((s, r) => s + Math.max(0, Number(r.transferred || 0)), 0);
  const transferItems = rbRowsForContainer.map((r) => {
    const row = {
      transferred: Math.max(0, Number(r.transferred || 0)),
      styleCode: String(r.styleCode || ''),
      brand: String(r.brand || ''),
    };
    const embroideryLine = (flow.floorQuantities?.branding?.transferredData || []).find(
      (t) =>
        t.brandingType === 'Embroidery' &&
        String(t.styleCode || '') === row.styleCode &&
        String(t.brand || '') === row.brand
    );
    if (embroideryLine) row.brandingType = 'Embroidery';
    return row;
  });

  const keptReceivedData = (rb.receivedData || []).filter(
    (r) => String(r.receivedInContainerId || '') !== cid
  );
  const newReceived = Math.max(
    0,
    Number(rb.received || 0) - rollbackQty
  );
  const newRbFloor = {
    ...rb,
    received: newReceived,
    receivedData: keptReceivedData,
    transferred: Number(rb.transferred || 0),
    completed: Math.min(Number(rb.completed || 0), newReceived),
  };
  const derived = computeDerivedForFloor('reBoarding', newRbFloor);
  Object.assign(newRbFloor, derived);

  console.log(`\n${execute ? 'EXECUTE' : 'DRY-RUN'} re-boarding container reset`);
  console.log(`  Container: ${cid} (${container.containerName || 'unnamed'})`);
  console.log(`  Flow: ${flowId}`);
  console.log(`  Rollback reBoarding received: ${rb.received} -> ${newReceived} (-${rollbackQty})`);
  console.log(`  Remove receivedData rows: ${rbRowsForContainer.length}`);
  console.log(`  Re-stage activeFloor: Re-Boarding, qty: ${rollbackQty}`);
  console.log(`  transferItems:`, JSON.stringify(transferItems, null, 2));

  if (!execute) {
    console.log('\nRe-run with --execute to apply.\n');
    await mongoose.disconnect();
    return;
  }

  await VendorProductionFlow.updateOne(
    { _id: flow._id },
    { $set: { 'floorQuantities.reBoarding': newRbFloor } }
  );

  const stage = buildReBoardingStage(container, flowId, rollbackQty, transferItems);
  await ContainersMaster.updateOne({ _id: container._id }, { $set: stage });

  const verifyContainer = await ContainersMaster.findById(container._id).lean();
  const verifyFlow = await VendorProductionFlow.findById(flow._id)
    .select('floorQuantities.reBoarding')
    .lean();

  console.log('\nDone. Verified state:');
  console.log(
    JSON.stringify(
      {
        container: {
          activeFloor: verifyContainer.activeFloor,
          activeItems: verifyContainer.activeItems,
        },
        reBoarding: verifyFlow.floorQuantities?.reBoarding,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
