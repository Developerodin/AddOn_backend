#!/usr/bin/env node
/**
 * Creates a minimal vendor PO + box and syncs VendorProductionFlow to **secondaryChecking**
 * (same as production: box create → syncBoxToProductionFlow).
 *
 * Usage:
 *   node src/scripts/seed-vendor-order-to-secondary-checking.js
 *   node src/scripts/seed-vendor-order-to-secondary-checking.js --units=150
 *   node src/scripts/seed-vendor-order-to-secondary-checking.js --product-id=<24hex>
 *
 * Uses MONGODB_URL from .env when it is valid; otherwise falls back to mongodb://127.0.0.1:27017/addon.
 * Override: --mongo-uri="mongodb://..."
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
import * as vendorProductionFlowService from '../services/vendorManagement/vendorProductionFlow.service.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const LOCAL_FALLBACK = 'mongodb://127.0.0.1:27017/addon';

/** Trim .env noise; empty or placeholder strings should not win over fallback. */
function normalizeEnvMongoUrl(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function parseArgs(argv) {
  const out = { units: 100, productId: null, mongoUri: null };
  for (const a of argv) {
    if (a.startsWith('--units=')) {
      const n = Number(a.split('=')[1]);
      if (Number.isFinite(n) && n > 0) out.units = Math.floor(n);
    }
    if (a.startsWith('--product-id=')) {
      const id = a.split('=')[1]?.trim();
      if (id) out.productId = id;
    }
    if (a.startsWith('--mongo-uri=')) {
      const u = a.slice('--mongo-uri='.length).trim();
      if (u) out.mongoUri = u;
    }
  }
  return out;
}

function isLikelyMongoParseError(err) {
  const name = err?.name || '';
  const msg = String(err?.message || '');
  return name === 'MongoParseError' || /malformed|Invalid connection string/i.test(msg);
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
      if (url === LOCAL_FALLBACK && fromEnv && fromEnv !== url) {
        console.warn(
          'Note: MONGODB_URL in .env is missing or invalid; connected with local fallback.',
          LOCAL_FALLBACK
        );
      }
      return url;
    } catch (e) {
      lastErr = e;
      if (isLikelyMongoParseError(e)) {
        console.warn(`Skipping unparsable Mongo URI (first 48 chars): ${url.slice(0, 48)}…`);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function resolveProduct(productIdArg) {
  if (productIdArg && mongoose.isValidObjectId(productIdArg)) {
    const p = await Product.findById(productIdArg);
    if (p) return p;
    console.warn(`Product ${productIdArg} not found; creating/finding fallback.`);
  }
  let product = await Product.findOne().sort({ createdAt: 1 });
  if (!product) {
    const suffix = Date.now();
    product = await Product.create({
      name: `Seed SC Product ${suffix}`,
      softwareCode: `SEED-SC-${suffix}`,
    });
    console.log('Created Product:', String(product._id));
  }
  return product;
}

async function main() {
  const { units, productId: productIdArg, mongoUri } = parseArgs(process.argv.slice(2));

  console.log('Connecting to MongoDB...');
  const usedUrl = await connectMongo(mongoUri);
  console.log(`Connected${usedUrl === LOCAL_FALLBACK ? ' (local fallback)' : ''}.\n`);

  const ts = Date.now();
  const product = await resolveProduct(productIdArg);

  const vendorCode = `TSC${ts}`.toUpperCase().slice(0, 16);
  const vendor = await VendorManagement.create({
    header: {
      vendorCode,
      vendorName: `Test Secondary Checking ${ts}`,
      status: 'active',
    },
    contactPersons: [{ contactName: 'Seed Script', phone: '1234567890' }],
    products: [product._id],
  });
  console.log('VendorManagement:', String(vendor._id), vendorCode);

  const vpoNumber = `VPO-TSC-${ts}`;
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
  console.log('VendorPurchaseOrder:', String(vpo._id), vpoNumber);

  const boxId = `VBOX-TSC-${ts}`;
  const lotNumber = `LOT-TSC-${ts}`;
  const box = await VendorBox.create({
    boxId,
    vpoNumber,
    vendorPurchaseOrderId: vpo._id,
    vendor: vendor._id,
    vendorPoItemId: poItemId,
    productId: product._id,
    productName: product.name,
    lotNumber,
    numberOfUnits: units,
  });
  console.log('VendorBox:', String(box._id), boxId);

  await vendorProductionFlowService.syncBoxToProductionFlow(box, units);

  const flow = await VendorProductionFlow.findOne({
    vendor: vendor._id,
    vendorPurchaseOrder: vpo._id,
    product: product._id,
  }).lean();

  console.log('\n--- VendorProductionFlow (secondary checking) ---');
  if (flow) {
    console.log('flowId:', String(flow._id));
    console.log('currentFloorKey:', flow.currentFloorKey);
    console.log('plannedQuantity:', flow.plannedQuantity);
    console.log('secondaryChecking:', JSON.stringify(flow.floorQuantities?.secondaryChecking, null, 2));
  } else {
    console.log('ERROR: flow not found after sync');
    process.exitCode = 1;
  }

  console.log('\nUse flowId with PATCH .../vendor-production-flow/:flowId/floor/secondaryChecking');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    console.log('\nDisconnected.');
  });
