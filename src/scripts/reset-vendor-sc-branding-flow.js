#!/usr/bin/env node
/**
 * Reset vendor secondary-checking + branding test state for one VPO:
 * - Deletes VendorGrn records and clears VPO grnHistory
 * - Un-accepts all boxes (SC scan can run again)
 * - Zeros SC received/M1–M4; restores pendingFromBoxes from plannedQuantity
 * - Clears branding (and downstream) floor progress on flows
 * - Clears vendor-staged container activeItems for those flows
 *
 * Usage:
 *   node src/scripts/reset-vendor-sc-branding-flow.js --vpo=VPO-2026-0001           # dry-run
 *   node src/scripts/reset-vendor-sc-branding-flow.js --vpo=VPO-2026-0001 --execute # apply
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import { connectMongooseForScript } from '../../scripts/lib/mongoScriptConnect.js';
import VendorGrn from '../models/vendorManagement/vendorGrn.model.js';
import VendorPurchaseOrder from '../models/vendorManagement/vendorPurchaseOrder.model.js';
import VendorProductionFlow from '../models/vendorManagement/vendorProductionFlow.model.js';
import VendorBox from '../models/vendorManagement/vendorBox.model.js';
import ContainersMaster from '../models/production/containersMaster.model.js';
import { RepairStatus } from '../models/production/enums.js';

/**
 * @param {string[]} argv
 * @returns {{ vpoNumber: string, execute: boolean }}
 */
function parseArgs(argv) {
  const vpoArg = argv.find((a) => a.startsWith('--vpo='));
  const vpoNumber = vpoArg ? vpoArg.slice('--vpo='.length).trim() : '';
  if (!vpoNumber) {
    throw new Error('Pass --vpo=VPO-YYYY-NNNN');
  }
  return { vpoNumber, execute: argv.includes('--execute') };
}

/**
 * Default empty branding floor snapshot.
 * @returns {object}
 */
function emptyBrandingFloor() {
  return {
    received: 0,
    completed: 0,
    remaining: 0,
    transferred: 0,
    repairReceived: 0,
    receivedData: [],
    transferredData: [],
  };
}

/**
 * Default empty checking floor (final checking shape).
 * @returns {object}
 */
function emptyFinalCheckingFloor() {
  return {
    received: 0,
    completed: 0,
    remaining: 0,
    transferred: 0,
    m1Quantity: 0,
    m2Quantity: 0,
    m4Quantity: 0,
    m1Transferred: 0,
    m2Transferred: 0,
    repairStatus: RepairStatus.NOT_REQUIRED,
    repairRemarks: '',
    receivedData: [],
    transferredData: [],
  };
}

/**
 * Reset secondary checking to pre-scan state while keeping planned batch size.
 * @param {number} plannedQuantity
 * @param {Array<object>} [receivedData]
 * @returns {object}
 */
function resetSecondaryCheckingFloor(plannedQuantity, receivedData = []) {
  const planned = Math.max(0, Number(plannedQuantity) || 0);
  return {
    received: 0,
    completed: 0,
    remaining: 0,
    transferred: 0,
    pendingFromBoxes: planned,
    m1Quantity: 0,
    m2Quantity: 0,
    m3Quantity: 0,
    m4Quantity: 0,
    m1Transferred: 0,
    m2Transferred: 0,
    repairStatus: RepairStatus.NOT_REQUIRED,
    repairRemarks: '',
    receivedData: Array.isArray(receivedData) ? receivedData : [],
  };
}

async function main() {
  const { vpoNumber, execute } = parseArgs(process.argv.slice(2));
  await connectMongooseForScript(config);

  const vpo = await VendorPurchaseOrder.findOne({ vpoNumber }).lean();
  if (!vpo) {
    throw new Error(`VPO not found: ${vpoNumber}`);
  }

  const flows = await VendorProductionFlow.find({ vendorPurchaseOrder: vpo._id }).lean();
  const flowIdStrs = flows.map((f) => String(f._id));
  const grns = await VendorGrn.find({ vendorPurchaseOrder: vpo._id }).select('grnNumber status').lean();
  const boxCount = await VendorBox.countDocuments({ vpoNumber });
  const acceptedBoxCount = await VendorBox.countDocuments({
    vpoNumber,
    secondaryCheckingAccepted: true,
  });

  const containers = await ContainersMaster.find({
    'activeItems.vendorProductionFlow': { $in: flowIdStrs.map((id) => new mongoose.Types.ObjectId(id)) },
  }).select('barcode activeFloor activeItems').lean();

  console.log(`\n${execute ? 'EXECUTE' : 'DRY-RUN'} reset for ${vpoNumber}`);
  console.log(`  GRNs to delete: ${grns.length}`, grns.map((g) => g.grnNumber));
  console.log(`  Flows: ${flows.length}`);
  console.log(`  Boxes: ${boxCount} (${acceptedBoxCount} SC-accepted)`);
  console.log(`  Staged containers: ${containers.length}`);

  if (!execute) {
    console.log('\nRe-run with --execute to apply.\n');
    await mongoose.disconnect();
    return;
  }

  const grnDelete = await VendorGrn.deleteMany({ vendorPurchaseOrder: vpo._id });
  await VendorPurchaseOrder.updateOne({ _id: vpo._id }, { $set: { grnHistory: [] } });

  const boxUpdate = await VendorBox.updateMany(
    { vpoNumber },
    { $set: { secondaryCheckingAccepted: false }, $unset: { secondaryCheckingAcceptedAt: '' } }
  );

  for (const flow of flows) {
    const sc = flow.floorQuantities?.secondaryChecking || {};
    const lotOnlyReceivedData = (sc.receivedData || []).filter((r) => r?.lotNumber || r?.boxId);
    const uniqueLots = [];
    const seenLots = new Set();
    for (const row of lotOnlyReceivedData) {
      const lot = String(row.lotNumber || '').trim();
      if (lot && !seenLots.has(lot)) {
        seenLots.add(lot);
        uniqueLots.push({
          receivedStatusFromPreviousFloor: row.receivedStatusFromPreviousFloor || `lot:${lot}`,
          lotNumber: lot,
          boxId: '',
          receivedInContainerId: null,
          receivedTimestamp: null,
        });
      }
    }

    await VendorProductionFlow.updateOne(
      { _id: flow._id },
      {
        $set: {
          currentFloorKey: 'secondaryChecking',
          'floorQuantities.secondaryChecking': resetSecondaryCheckingFloor(
            flow.plannedQuantity,
            uniqueLots
          ),
          'floorQuantities.branding': emptyBrandingFloor(),
          'floorQuantities.finalChecking': emptyFinalCheckingFloor(),
          'floorQuantities.dispatch': {
            received: 0,
            completed: 0,
            remaining: 0,
            transferred: 0,
            repairReceived: 0,
            receivedData: [],
            transferredData: [],
          },
        },
      }
    );
  }

  let containersCleared = 0;
  for (const c of containers) {
    await ContainersMaster.updateOne(
      { _id: c._id },
      { $set: { activeItems: [], activeFloor: '' } }
    );
    containersCleared += 1;
  }

  console.log('\nDone:');
  console.log(`  GRNs deleted: ${grnDelete.deletedCount}`);
  console.log(`  Boxes reset: ${boxUpdate.modifiedCount ?? boxUpdate.nModified ?? boxUpdate.matchedCount ?? 0}`);
  console.log(`  Flows reset: ${flows.length}`);
  console.log(`  Containers cleared: ${containersCleared}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
