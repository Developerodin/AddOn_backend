#!/usr/bin/env node
/**
 * Targeted test: dispatch.remaining must equal (received − transferred) after every operation.
 *
 * Tests two FC → dispatch paths:
 *   Path A: FC PATCH with transferredData + existingContainerBarcode (auto-transfer + container staging)
 *           → dispatch container accept → assert dispatch.remaining === dispatch.received
 *   Path B: confirmVendorProductionFlowById (bulk confirm)
 *           → assert dispatch.remaining === dispatch.received
 *
 * Also tests dispatch → warehouse transfer reduces remaining correctly.
 *
 * Usage:
 *   node src/scripts/test-dispatch-remaining-fix.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import {
  Product,
  VendorManagement,
  VendorPurchaseOrder,
  VendorBox,
  VendorProductionFlow,
} from '../models/index.js';
import { ContainerStatus } from '../models/production/enums.js';
import * as vendorProductionFlowService from '../services/vendorManagement/vendorProductionFlow.service.js';
import * as containersMasterService from '../services/production/containersMaster.service.js';
import {
  assertValidFloorState,
  computeDerivedForFloor,
  pickFloorSnapshot,
} from '../services/vendorManagement/vendorProductionFlowFloorPatch.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const UNITS = 200;
let passed = 0;
let failed = 0;

function floor(flow, key) {
  return flow?.floorQuantities?.[key] || {};
}

async function reloadFlow(flowId) {
  return VendorProductionFlow.findById(flowId).lean();
}

function assert(label, actual, expected) {
  if (Math.abs(Number(actual) - Number(expected)) > 0.001) {
    console.error(`  ✗ ${label}: expected ${expected}, got ${actual}`);
    failed++;
  } else {
    console.log(`  ✓ ${label}: ${actual}`);
    passed++;
  }
}

async function applyFloorSnapshot(flowId, floorKey, mutator) {
  const flow = await VendorProductionFlow.findById(flowId);
  if (!flow.floorQuantities[floorKey]) flow.floorQuantities[floorKey] = {};
  const snap = pickFloorSnapshot(flow, floorKey);
  mutator(snap);
  assertValidFloorState(floorKey, snap);
  const derived = computeDerivedForFloor(floorKey, snap);
  Object.assign(flow.floorQuantities[floorKey], snap, derived);
  flow.markModified(`floorQuantities.${floorKey}`);
  await flow.save();
  return flow;
}

async function seedFlow(label) {
  const ts = Date.now();
  let product = await Product.findOne().sort({ createdAt: 1 });
  if (!product) {
    product = await Product.create({
      name: `TEST-DISP-${ts}`,
      softwareCode: `TEST-DISP-${ts}`,
      factoryCode: `FC-TD-${ts}`,
    });
  } else if (!String(product.factoryCode || '').trim()) {
    await Product.updateOne({ _id: product._id }, { $set: { factoryCode: `FC-FIX-${ts}` } });
    product = await Product.findById(product._id);
  }
  const vendorCode = `TD${ts}`.slice(0, 16);
  const vendor = await VendorManagement.create({
    header: { vendorCode, vendorName: `Test ${label}`, status: 'active' },
    contactPersons: [{ contactName: 'Test', phone: '0000000000' }],
    products: [product._id],
  });
  const vpo = await VendorPurchaseOrder.create({
    vpoNumber: `VPO-TD-${ts}`,
    vendor: vendor._id,
    poItems: [{ productId: product._id, productName: product.name, quantity: UNITS, rate: 1, gstRate: 0 }],
    subTotal: UNITS, gst: 0, total: UNITS,
    currentStatus: 'goods_received',
  });
  const box = await VendorBox.create({
    boxId: `VBOX-TD-${ts}`,
    vpoNumber: vpo.vpoNumber,
    vendorPurchaseOrderId: vpo._id,
    vendor: vendor._id,
    vendorPoItemId: vpo.poItems[0]._id,
    productId: product._id,
    productName: product.name,
    lotNumber: `LOT-TD-${ts}`,
    numberOfUnits: UNITS,
  });
  await vendorProductionFlowService.syncBoxToProductionFlow(box, UNITS);
  const flowDoc = await VendorProductionFlow.findOne({ vendor: vendor._id, product: product._id });
  return flowDoc._id.toString();
}

/**
 * @param {string} flowId
 * @returns {Promise<string>} container barcode
 */
async function advanceToFinalChecking(flowId) {
  const bag = await containersMasterService.createContainersMaster({
    containerName: `BAG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: ContainerStatus.ACTIVE,
  });
  const barcode = bag.barcode || bag._id.toString();

  await vendorProductionFlowService.updateVendorProductionFlowFloorById(flowId, 'secondaryChecking', {
    mode: 'replace',
    m1Quantity: UNITS,
    m2Quantity: 0,
    m4Quantity: 0,
    repairStatus: 'Not Required',
    repairRemarks: '',
    existingContainerBarcode: barcode,
  });
  await containersMasterService.acceptContainerByBarcode(barcode);

  await applyFloorSnapshot(flowId, 'branding', (s) => { s.completed = UNITS; });
  await vendorProductionFlowService.transferVendorProductionFlowQuantity(
    flowId, 'branding', 'finalChecking', UNITS,
    { existingContainerBarcode: barcode, transferItems: [{ transferred: UNITS, styleCode: 'STY-1', brand: 'BR-1' }] },
  );
  await containersMasterService.acceptContainerByBarcode(barcode);

  await applyFloorSnapshot(flowId, 'finalChecking', (s) => {
    s.m1Quantity = UNITS;
    s.m2Quantity = 0;
    s.m4Quantity = 0;
    s.completed = UNITS;
    s.repairStatus = 'Not Required';
    s.repairRemarks = '';
  });

  return barcode;
}

async function testPathA_PatchWithContainer() {
  console.log('\n── Path A: FC PATCH with transferredData + existingContainerBarcode ──');
  const flowId = await seedFlow('PathA');
  const barcode = await advanceToFinalChecking(flowId);

  let flow = await reloadFlow(flowId);
  assert('FC.received', floor(flow, 'finalChecking').received, UNITS);
  assert('FC.completed', floor(flow, 'finalChecking').completed, UNITS);

  console.log('\n  Step: FC PATCH (transferredData + existingContainerBarcode) → stages container for dispatch');
  await vendorProductionFlowService.updateVendorProductionFlowFloorById(flowId, 'finalChecking', {
    transferredData: [{ transferred: UNITS, styleCode: 'STY-1', brand: 'BR-1' }],
    existingContainerBarcode: barcode,
  });

  flow = await reloadFlow(flowId);
  assert('FC.transferred after PATCH', floor(flow, 'finalChecking').transferred, UNITS);
  const dispAfterStage = floor(flow, 'dispatch');
  console.log('  [info] dispatch after FC staging (before accept):', JSON.stringify({
    received: dispAfterStage.received, completed: dispAfterStage.completed,
    remaining: dispAfterStage.remaining, transferred: dispAfterStage.transferred,
  }));

  console.log('\n  Step: Accept container on dispatch');
  await containersMasterService.acceptContainerByBarcode(barcode);

  flow = await reloadFlow(flowId);
  const dispAfterAccept = floor(flow, 'dispatch');
  console.log('  [info] dispatch after accept:', JSON.stringify({
    received: dispAfterAccept.received, completed: dispAfterAccept.completed,
    remaining: dispAfterAccept.remaining, transferred: dispAfterAccept.transferred,
  }));
  assert('dispatch.received', dispAfterAccept.received, UNITS);
  assert('dispatch.transferred', dispAfterAccept.transferred, 0);
  assert('dispatch.remaining = received − transferred', dispAfterAccept.remaining, UNITS);

  console.log('\n  Step: Dispatch → warehouse transfer (half)');
  const whBag = await containersMasterService.createContainersMaster({
    containerName: `WH-${Date.now()}`,
    status: ContainerStatus.ACTIVE,
  });
  const whBarcode = whBag.barcode || whBag._id.toString();
  const half = Math.floor(UNITS / 2);
  await vendorProductionFlowService.transferVendorProductionFlowQuantity(
    flowId, 'dispatch', 'warehouse', half,
    { existingContainerBarcode: whBarcode, transferItems: [{ transferred: half, styleCode: 'STY-1', brand: 'BR-1' }] },
  );

  flow = await reloadFlow(flowId);
  const dispAfterTransfer = floor(flow, 'dispatch');
  assert('dispatch.transferred after warehouse transfer', dispAfterTransfer.transferred, half);
  assert('dispatch.remaining after warehouse transfer', dispAfterTransfer.remaining, UNITS - half);

  return flowId;
}

async function testPathB_Confirm() {
  console.log('\n── Path B: confirmVendorProductionFlowById ──');
  const flowId = await seedFlow('PathB');
  await advanceToFinalChecking(flowId);

  console.log('\n  Step: Confirm (moves FC pending → dispatch)');
  await vendorProductionFlowService.confirmVendorProductionFlowById(flowId, 'test-confirm');

  const flow = await reloadFlow(flowId);
  const disp = floor(flow, 'dispatch');
  console.log('  [info] dispatch after confirm:', JSON.stringify({
    received: disp.received, completed: disp.completed,
    remaining: disp.remaining, transferred: disp.transferred,
  }));
  assert('dispatch.received', disp.received, UNITS);
  assert('dispatch.transferred', disp.transferred, 0);
  assert('dispatch.remaining = received − transferred', disp.remaining, UNITS);
  assert('currentFloorKey', flow.currentFloorKey, 'dispatch');

  return flowId;
}

async function testPathC_ExplicitTransferWithContainer() {
  console.log('\n── Path C: explicit transferVendorProductionFlowQuantity FC→dispatch with container ──');
  const flowId = await seedFlow('PathC');
  const barcode = await advanceToFinalChecking(flowId);

  console.log('\n  Step: Explicit FC → dispatch transfer with container');
  await vendorProductionFlowService.transferVendorProductionFlowQuantity(
    flowId, 'finalChecking', 'dispatch', UNITS,
    { existingContainerBarcode: barcode, transferItems: [{ transferred: UNITS, styleCode: 'STY-1', brand: 'BR-1' }] },
  );

  let flow = await reloadFlow(flowId);
  const dispBeforeAccept = floor(flow, 'dispatch');
  console.log('  [info] dispatch before accept:', JSON.stringify({
    received: dispBeforeAccept.received, completed: dispBeforeAccept.completed,
    remaining: dispBeforeAccept.remaining, transferred: dispBeforeAccept.transferred,
  }));

  console.log('\n  Step: Accept container on dispatch');
  await containersMasterService.acceptContainerByBarcode(barcode);

  flow = await reloadFlow(flowId);
  const disp = floor(flow, 'dispatch');
  console.log('  [info] dispatch after accept:', JSON.stringify({
    received: disp.received, completed: disp.completed,
    remaining: disp.remaining, transferred: disp.transferred,
  }));
  assert('dispatch.received', disp.received, UNITS);
  assert('dispatch.transferred', disp.transferred, 0);
  assert('dispatch.remaining = received − transferred', disp.remaining, UNITS);

  return flowId;
}

function normalizeMongoUrl(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (s.endsWith('>')) s = s.slice(0, -1).trim();
  return s;
}

async function main() {
  const candidates = [
    normalizeMongoUrl(process.env.MONGODB_URL),
    'mongodb://127.0.0.1:27017/addon',
  ].filter(Boolean);
  let connectedUri = '';
  for (const uri of candidates) {
    try {
      await mongoose.connect(uri);
      connectedUri = uri;
      break;
    } catch {
      /* try next */
    }
  }
  if (!connectedUri) throw new Error('Could not connect to any MongoDB');
  console.log('Connected:', connectedUri.includes('cluster') ? 'Atlas' : 'local');

  console.log(`\n════════════════════════════════════════════════════════`);
  console.log(`  dispatch.remaining fix — test suite (${UNITS} units)`);
  console.log(`════════════════════════════════════════════════════════`);

  const flowA = await testPathA_PatchWithContainer();
  const flowB = await testPathB_Confirm();
  const flowC = await testPathC_ExplicitTransferWithContainer();

  console.log('\n════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`  Flow IDs: A=${flowA}  B=${flowB}  C=${flowC}`);
  console.log('════════════════════════════════════════════════════════\n');

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
