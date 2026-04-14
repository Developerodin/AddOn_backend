#!/usr/bin/env node
/**
 * End-to-end behavior test: vendor PO → secondary checking → containers → branding →
 * final checking (styleCode/brand lines) → confirm → dispatch.
 *
 * Mirrors `src/docs/vendor-production-flow-frontend-api.md` using the same services as HTTP routes.
 *
 * Usage:
 *   node src/scripts/test-vendor-production-flow-containers-e2e.js
 *   node src/scripts/test-vendor-production-flow-containers-e2e.js --units=120
 *   node src/scripts/test-vendor-production-flow-containers-e2e.js --mongo-uri="mongodb://127.0.0.1:27017/addon"
 *
 * Requires MongoDB (replica set optional; code falls back off transactions like production).
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
import InwardReceive, { InwardReceiveSource } from '../models/whms/inwardReceive.model.js';
import { ContainerStatus } from '../models/production/enums.js';
import * as vendorProductionFlowService from '../services/vendorManagement/vendorProductionFlow.service.js';
import * as vendorProductionFlowReceive from '../services/vendorManagement/vendorProductionFlowReceive.service.js';
import * as containersMasterService from '../services/production/containersMaster.service.js';
import ApiError from '../utils/ApiError.js';
import {
  assertValidFloorState,
  computeDerivedForFloor,
  pickFloorSnapshot,
} from '../services/vendorManagement/vendorProductionFlowFloorPatch.js';
import { promoteVendorDispatchToInwardReceive } from '../services/whms/inwardReceiveFromVendorDispatch.helper.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const LOCAL_FALLBACK = 'mongodb://127.0.0.1:27017/addon';

function normalizeEnvMongoUrl(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function parseArgs(argv) {
  const out = { units: 120, mongoUri: null };
  for (const a of argv) {
    if (a.startsWith('--units=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n > 0) out.units = Math.floor(n);
    }
    if (a.startsWith('--mongo-uri=')) {
      const u = a.slice('--mongo-uri='.length).trim();
      if (u) out.mongoUri = u;
    }
  }
  return out;
}

async function connectMongo(preferredUrl) {
  const fromEnv = normalizeEnvMongoUrl(process.env.MONGODB_URL);
  const candidates = [preferredUrl, fromEnv, LOCAL_FALLBACK].filter((u) => typeof u === 'string' && u.length > 0);
  const tried = new Set();
  let lastErr;
  for (const url of candidates) {
    if (tried.has(url)) continue;
    tried.add(url);
    try {
      await mongoose.connect(url);
      return url;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function floor(flow, key) {
  return flow?.floorQuantities?.[key] || {};
}

async function reloadFlow(flowId) {
  return VendorProductionFlow.findById(flowId).lean();
}

/**
 * Sets floor numbers without running {@link vendorProductionFlowService.updateVendorProductionFlowFloorById},
 * because that helper's `maybeAutoTransferVendorFloor` runs on any `completed` / `completedDelta` / M1 increase
 * and would require container + style payload for branding→FC.
 */
async function applyFloorSnapshot(flowId, floorKey, mutator) {
  const flow = await VendorProductionFlow.findById(flowId);
  if (!flow) throw new Error('flow not found');
  if (!flow.floorQuantities[floorKey]) {
    flow.floorQuantities[floorKey] = {};
  }
  const snap = pickFloorSnapshot(flow, floorKey);
  mutator(snap);
  assertValidFloorState(floorKey, snap);
  const derived = computeDerivedForFloor(floorKey, snap);
  Object.assign(flow.floorQuantities[floorKey], snap, derived);
  flow.markModified(`floorQuantities.${floorKey}`);
  await flow.save();
  return flow;
}

async function expectRejects(label, fn, substr) {
  try {
    await fn();
    throw new Error(`[${label}] expected rejection containing "${substr}"`);
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes(substr)) return;
    throw new Error(`[${label}] wrong error (want "${substr}"): ${msg}`);
  }
}

function assertApprox(label, a, b, eps = 0.0001) {
  if (Math.abs(Number(a) - Number(b)) > eps) {
    throw new Error(`[${label}] expected ${b}, got ${a}`);
  }
}

async function seedVendorAndFlow(units) {
  const ts = Date.now();
  let product = await Product.findOne().sort({ createdAt: 1 });
  if (!product) {
    product = await Product.create({
      name: `VPF-E2E-${ts}`,
      softwareCode: `VPF-E2E-${ts}`,
      factoryCode: `FC-VPF-E2E-${ts}`,
    });
  } else if (!String(product.factoryCode || '').trim()) {
    await Product.updateOne({ _id: product._id }, { $set: { factoryCode: `FC-VPF-FIX-${ts}` } });
    product = await Product.findById(product._id);
  }

  const vendorCode = `VPF${ts}`.toUpperCase().slice(0, 16);
  const vendor = await VendorManagement.create({
    header: { vendorCode, vendorName: `VPF E2E ${ts}`, status: 'active' },
    contactPersons: [{ contactName: 'E2E', phone: '1234567890' }],
    products: [product._id],
  });

  const vpoNumber = `VPO-VPF-${ts}`;
  const vpo = await VendorPurchaseOrder.create({
    vpoNumber,
    vendor: vendor._id,
    poItems: [
      {
        productId: product._id,
        productName: product.name,
        quantity: units,
        rate: 1,
        gstRate: 0,
      },
    ],
    subTotal: units,
    gst: 0,
    total: units,
    currentStatus: 'goods_received',
  });
  const poItemId = vpo.poItems[0]._id;

  const box = await VendorBox.create({
    boxId: `VBOX-VPF-${ts}`,
    vpoNumber,
    vendorPurchaseOrderId: vpo._id,
    vendor: vendor._id,
    vendorPoItemId: poItemId,
    productId: product._id,
    productName: product.name,
    lotNumber: `LOT-VPF-${ts}`,
    numberOfUnits: units,
  });

  await vendorProductionFlowService.syncBoxToProductionFlow(box, units);
  const flowDoc = await VendorProductionFlow.findOne({
    vendor: vendor._id,
    vendorPurchaseOrder: vpo._id,
    product: product._id,
  });
  if (!flowDoc) throw new Error('VendorProductionFlow missing after sync');

  return { vendor, vpo, box, flowId: flowDoc._id.toString(), units };
}

async function main() {
  const { units, mongoUri } = parseArgs(process.argv.slice(2));
  console.log(`\n=== Vendor production flow (containers) E2E — ${units} units ===\n`);

  const usedUrl = await connectMongo(mongoUri);
  console.log('Mongo:', usedUrl === LOCAL_FALLBACK ? `${usedUrl} (fallback)` : usedUrl);

  const { flowId } = await seedVendorAndFlow(units);
  const [bagA, bagB] = await Promise.all([
    containersMasterService.createContainersMaster({
      containerName: `VPF-BAG-A-${Date.now()}`,
      status: ContainerStatus.ACTIVE,
    }),
    containersMasterService.createContainersMaster({
      containerName: `VPF-BAG-B-${Date.now()}`,
      status: ContainerStatus.ACTIVE,
    }),
  ]);
  const barcodeA = bagA.barcode || bagA._id.toString();
  const barcodeB = bagB.barcode || bagB._id.toString();

  const style1 = { styleCode: 'STY-A', brand: 'BR-X' };
  const style2 = { styleCode: 'STY-B', brand: 'BR-Y' };

  // --- Validation edge cases ---
  await expectRejects('backward transfer', () =>
    vendorProductionFlowService.transferVendorProductionFlowQuantity(flowId, 'branding', 'secondaryChecking', 1, {
      existingContainerBarcode: barcodeA,
    })
  , 'Destination floor must be after source floor');

  await expectRejects('SC→branding without barcode', () =>
    vendorProductionFlowService.transferVendorProductionFlowQuantity(flowId, 'secondaryChecking', 'branding', 5)
  , 'existingContainerBarcode is required');

  await expectRejects('non-positive qty', () =>
    vendorProductionFlowService.transferVendorProductionFlowQuantity(flowId, 'secondaryChecking', 'branding', 0, {
      existingContainerBarcode: barcodeA,
    })
  , 'Transfer quantity must be greater than 0');

  await expectRejects('over M1 transfer (before M1 set)', () =>
    vendorProductionFlowService.transferVendorProductionFlowQuantity(flowId, 'secondaryChecking', 'branding', 5, {
      existingContainerBarcode: barcodeA,
    })
  , 'M1 quantity available to transfer');

  // Secondary checking: raising M1 triggers auto-transfer to branding (needs existingContainerBarcode) — vendorProductionFlow.service `maybeAutoTransferVendorFloor`
  await vendorProductionFlowService.updateVendorProductionFlowFloorById(flowId, 'secondaryChecking', {
    mode: 'replace',
    m1Quantity: units,
    m2Quantity: 0,
    m4Quantity: 0,
    repairStatus: 'Not Required',
    repairRemarks: '',
    existingContainerBarcode: barcodeA,
  });

  let flow = await reloadFlow(flowId);
  assertApprox('SC.m1', floor(flow, 'secondaryChecking').m1Quantity, units);
  assertApprox('SC.received', floor(flow, 'secondaryChecking').received, units);
  assertApprox('SC.transferred after M1 auto-stage', floor(flow, 'secondaryChecking').transferred, units);

  await containersMasterService.acceptContainerByBarcode(barcodeA);

  flow = await reloadFlow(flowId);
  assertApprox('branding.received', floor(flow, 'branding').received, units);
  assertApprox('SC.transferred', floor(flow, 'secondaryChecking').transferred, units);

  await expectRejects('over M1 transfer (pool exhausted)', () =>
    vendorProductionFlowService.transferVendorProductionFlowQuantity(flowId, 'secondaryChecking', 'branding', 1, {
      existingContainerBarcode: barcodeB,
    })
  , 'M1 quantity available to transfer');

  await applyFloorSnapshot(flowId, 'branding', (s) => {
    s.completed = units;
  });

  await expectRejects('branding→FC without transferItems', () =>
    vendorProductionFlowService.transferVendorProductionFlowQuantity(flowId, 'branding', 'finalChecking', 10, {
      existingContainerBarcode: barcodeA,
    })
  , 'transferItems');

  await expectRejects('transferItems sum mismatch', () =>
    vendorProductionFlowService.transferVendorProductionFlowQuantity(flowId, 'branding', 'finalChecking', 10, {
      existingContainerBarcode: barcodeA,
      transferItems: [{ transferred: 3, ...style1 }, { transferred: 3, ...style2 }],
    })
  , 'transferItems sum');

  // Branding → final checking: styleCode/brand lines, two containers + reuse bagA
  const fcThird = Math.max(1, Math.floor(units / 3));
  const fcMid = Math.max(1, Math.floor((units - fcThird) / 2));
  const fcLast = units - fcThird - fcMid;
  const halfThird = Math.floor(fcThird / 2);
  const tItems1 = [
    { transferred: halfThird, ...style1 },
    { transferred: fcThird - halfThird, ...style2 },
  ];
  const tItems2 = [
    { transferred: Math.floor(fcMid / 2), ...style1 },
    { transferred: fcMid - Math.floor(fcMid / 2), ...style2 },
  ];
  const tItems3 = [
    { transferred: Math.floor(fcLast / 2), ...style1 },
    { transferred: fcLast - Math.floor(fcLast / 2), ...style2 },
  ];

  await vendorProductionFlowService.transferVendorProductionFlowQuantity(flowId, 'branding', 'finalChecking', fcThird, {
    existingContainerBarcode: barcodeA,
    transferItems: tItems1,
  });
  await containersMasterService.acceptContainerByBarcode(barcodeA);

  await vendorProductionFlowService.transferVendorProductionFlowQuantity(flowId, 'branding', 'finalChecking', fcMid, {
    existingContainerBarcode: barcodeB,
    transferItems: tItems2,
  });
  await containersMasterService.acceptContainerByBarcode(barcodeB);

  await vendorProductionFlowService.transferVendorProductionFlowQuantity(flowId, 'branding', 'finalChecking', fcLast, {
    existingContainerBarcode: barcodeA,
    transferItems: tItems3,
  });
  await containersMasterService.acceptContainerByBarcode(barcodeA);

  flow = await reloadFlow(flowId);
  assertApprox('branding.transferred', floor(flow, 'branding').transferred, units);
  assertApprox('FC.received', floor(flow, 'finalChecking').received, units);

  const rd = floor(flow, 'finalChecking').receivedData || [];
  const sumStyle = (sc, br) =>
    rd.filter((r) => r.styleCode === sc && r.brand === br).reduce((s, r) => s + (r.transferred || 0), 0);
  const aggS1 = sumStyle(style1.styleCode, style1.brand);
  const aggS2 = sumStyle(style2.styleCode, style2.brand);
  assertApprox('FC receivedData STY-A', aggS1, halfThird + Math.floor(fcMid / 2) + Math.floor(fcLast / 2));
  assertApprox(
    'FC receivedData STY-B',
    aggS2,
    fcThird - halfThird + (fcMid - Math.floor(fcMid / 2)) + (fcLast - Math.floor(fcLast / 2))
  );

  // Style key not in branding outbound (same validator as container accept) — direct receive API
  const { flowId: capFlow } = await seedVendorAndFlow(30);
  const bagZ = await containersMasterService.createContainersMaster({
    containerName: `VPF-Z-${Date.now()}`,
    status: ContainerStatus.ACTIVE,
  });
  const bz = bagZ.barcode || bagZ._id.toString();
  await vendorProductionFlowService.updateVendorProductionFlowFloorById(capFlow, 'secondaryChecking', {
    mode: 'replace',
    m1Quantity: 30,
    m2Quantity: 0,
    m4Quantity: 0,
    repairStatus: 'Not Required',
    repairRemarks: '',
    existingContainerBarcode: bz,
  });
  // M1 patch already auto-staged all M1 on `bz`; only accept (do not transfer again).
  await containersMasterService.acceptContainerByBarcode(bz);
  await applyFloorSnapshot(capFlow, 'branding', (s) => {
    s.completed = 30;
  });
  await vendorProductionFlowService.transferVendorProductionFlowQuantity(capFlow, 'branding', 'finalChecking', 30, {
    existingContainerBarcode: bz,
    transferItems: [{ transferred: 30, styleCode: 'GOOD', brand: 'GB' }],
  });
  await containersMasterService.acceptContainerByBarcode(bz);
  await expectRejects('FC receive style not in branding.transferredData', () =>
    vendorProductionFlowReceive.updateVendorProductionFlowFloorReceivedData(capFlow, {
      floor: 'finalChecking',
      receivedTransferItems: [{ transferred: 1, styleCode: 'NOSUCH', brand: 'NB' }],
      receivedData: { receivedStatusFromPreviousFloor: 'test' },
    })
  , 'not present in branding outbound');

  const capFlowReload = await reloadFlow(capFlow);
  assertApprox('capFlow FC.received still 30', floor(capFlowReload, 'finalChecking').received, 30);

  await expectRejects('FC cumulative receive over branding cap for style', () =>
    vendorProductionFlowReceive.updateVendorProductionFlowFloorReceivedData(capFlow, {
      floor: 'finalChecking',
      receivedTransferItems: [{ transferred: 1, styleCode: 'GOOD', brand: 'GB' }],
      receivedData: { receivedStatusFromPreviousFloor: 'test-over' },
    })
  , 'cumulative');

  await applyFloorSnapshot(flowId, 'finalChecking', (s) => {
    s.m1Quantity = units;
    s.m2Quantity = 0;
    s.m4Quantity = 0;
    s.completed = units;
    s.repairStatus = 'Not Required';
    s.repairRemarks = '';
  });

  flow = await reloadFlow(flowId);
  assertApprox('FC.completed', floor(flow, 'finalChecking').completed, units);

  await vendorProductionFlowService.confirmVendorProductionFlowById(flowId, 'e2e confirm');
  flow = await reloadFlow(flowId);
  assertApprox('dispatch.received', floor(flow, 'dispatch').received, units);
  if (flow.currentFloorKey !== 'dispatch') {
    throw new Error(`expected currentFloorKey dispatch, got ${flow.currentFloorKey}`);
  }
  if (!flow.finalQualityConfirmed) {
    throw new Error('expected finalQualityConfirmed');
  }

  const inwardAfterConfirm = await InwardReceive.countDocuments({
    vendorProductionFlowId: flow._id,
    inwardSource: InwardReceiveSource.VENDOR,
  });
  const dispatchRd = floor(flow, 'dispatch').receivedData || [];
  if (inwardAfterConfirm !== 0) {
    throw new Error(
      `expected 0 vendor InwardReceive after confirm (promote at WHMS), got ${inwardAfterConfirm}`
    );
  }
  await promoteVendorDispatchToInwardReceive(flowId, {});
  const inwardAfterPromote = await InwardReceive.countDocuments({
    vendorProductionFlowId: flow._id,
    inwardSource: InwardReceiveSource.VENDOR,
  });
  if (inwardAfterPromote < dispatchRd.length) {
    throw new Error(
      `expected at least ${dispatchRd.length} vendor InwardReceive row(s) after promote, got ${inwardAfterPromote}`
    );
  }

  // FC→dispatch accept, then dispatch→warehouse transfer + WHMS scan accept (inward via warehouse handoff)
  const { flowId: dispatchOnlyFlowId } = await seedVendorAndFlow(5);
  const bagD = await containersMasterService.createContainersMaster({
    containerName: `VPF-DISPATCH-${Date.now()}`,
    status: ContainerStatus.ACTIVE,
  });
  const barcodeD = bagD.barcode || bagD._id.toString();
  await vendorProductionFlowService.updateVendorProductionFlowFloorById(dispatchOnlyFlowId, 'secondaryChecking', {
    mode: 'replace',
    m1Quantity: 5,
    m2Quantity: 0,
    m4Quantity: 0,
    repairStatus: 'Not Required',
    repairRemarks: '',
    existingContainerBarcode: barcodeD,
  });
  await containersMasterService.acceptContainerByBarcode(barcodeD);
  await applyFloorSnapshot(dispatchOnlyFlowId, 'branding', (s) => {
    s.completed = 5;
  });
  await vendorProductionFlowService.transferVendorProductionFlowQuantity(
    dispatchOnlyFlowId,
    'branding',
    'finalChecking',
    5,
    {
      existingContainerBarcode: barcodeD,
      transferItems: [{ transferred: 5, styleCode: 'STY-D', brand: 'BR-D' }],
    }
  );
  await containersMasterService.acceptContainerByBarcode(barcodeD);
  await applyFloorSnapshot(dispatchOnlyFlowId, 'finalChecking', (s) => {
    s.m1Quantity = 5;
    s.m2Quantity = 0;
    s.m4Quantity = 0;
    s.completed = 5;
    s.repairStatus = 'Not Required';
    s.repairRemarks = '';
  });
  await vendorProductionFlowService.transferVendorProductionFlowQuantity(
    dispatchOnlyFlowId,
    'finalChecking',
    'dispatch',
    5,
    {
      existingContainerBarcode: barcodeD,
      transferItems: [{ transferred: 5, styleCode: 'STY-D', brand: 'BR-D' }],
    }
  );
  const inwardBeforeAccept = await InwardReceive.countDocuments({
    vendorProductionFlowId: dispatchOnlyFlowId,
    inwardSource: InwardReceiveSource.VENDOR,
  });
  await containersMasterService.acceptContainerByBarcode(barcodeD);
  const inwardAfterAccept = await InwardReceive.countDocuments({
    vendorProductionFlowId: dispatchOnlyFlowId,
    inwardSource: InwardReceiveSource.VENDOR,
  });
  if (inwardAfterAccept !== inwardBeforeAccept) {
    throw new Error(
      `expected no vendor InwardReceive until WHMS handoff (before ${inwardBeforeAccept}, after dispatch accept ${inwardAfterAccept})`
    );
  }

  const bagW = await containersMasterService.createContainersMaster({
    containerName: `VPF-WHMS-${Date.now()}`,
    status: ContainerStatus.ACTIVE,
  });
  const barcodeW = bagW.barcode || bagW._id.toString();
  await vendorProductionFlowService.transferVendorProductionFlowQuantity(
    dispatchOnlyFlowId,
    'dispatch',
    'warehouse',
    5,
    {
      existingContainerBarcode: barcodeW,
      transferItems: [{ transferred: 5, styleCode: 'STY-D', brand: 'BR-D' }],
    }
  );
  await containersMasterService.acceptContainerByBarcode(barcodeW);
  const inwardAfterWhScan = await InwardReceive.countDocuments({
    vendorProductionFlowId: dispatchOnlyFlowId,
    inwardSource: InwardReceiveSource.VENDOR,
  });
  if (inwardAfterWhScan <= inwardAfterAccept) {
    throw new Error(
      `expected vendor InwardReceive after WHMS container accept (before ${inwardAfterAccept}, after ${inwardAfterWhScan})`
    );
  }

  console.log('\nOK — validations + multi-container SC→branding + style split branding→FC + confirm/dispatch.');
  console.log('   main flowId:', flowId);
  console.log('   cap-validation flowId:', capFlow);
  console.log('   dispatch-container inward flowId:', dispatchOnlyFlowId);
}

main()
  .catch((e) => {
    if (e instanceof ApiError) {
      console.error('ApiError', e.statusCode, e.message);
    } else {
      console.error(e);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
