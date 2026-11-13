#!/usr/bin/env node
/**
 * Remove catalog Product rows by MongoDB _id (dry-run by default).
 *
 * Default IDs — duplicate seed items on production (override with --ids=id1,id2,...):
 *   6af6f539a4c7b78e8e727bfa
 *   6af6f549a4c7b78e8e727fd5
 *   6af6f549a4c7b78e8e727fd7
 *   6af6f549a4c7b78e8e727fd9
 *   6af6f549a4c7b78e8e727fdb
 *   6af6f549a4c7b78e8e727fdd
 *   6af6f549a4c7b78e8e727fe2
 *
 * Usage (from AddOn_backend):
 *   node src/scripts/delete-catalog-products-by-id.js
 *   node src/scripts/delete-catalog-products-by-id.js --apply
 *   node src/scripts/delete-catalog-products-by-id.js --ids=6af6f539a4c7b78e8e727bfa --apply
 *   node src/scripts/delete-catalog-products-by-id.js --apply --force
 *   node src/scripts/delete-catalog-products-by-id.js --mongo-url='mongodb://...'
 *
 * Flags:
 *   --ids=ID[,ID...]  Product _ids to delete (defaults above).
 *   --apply           Perform deletes (default is preview only).
 *   --force           Delete even when other collections reference the product.
 *   --mongo-url=URL   Override MONGODB_URL / config.
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { Product, Sales, Forecast, Replenishment, VendorPurchaseOrder, VendorBox, VendorProductionFlow, VendorGrn, VendorPoReturnChallan, VendorPoVendorReturn, VendorManagement } from '../models/index.js';
import WarehouseInventory from '../models/whms/warehouseInventory.model.js';
import WhmsOrder from '../models/whms/whmsOrder.model.js';
import InwardRecord from '../models/whms/inwardRecord.model.js';

const DEFAULT_PRODUCT_IDS = [
  '6af6f539a4c7b78e8e727bfa',
  '6af6f549a4c7b78e8e727fd5',
  '6af6f549a4c7b78e8e727fd7',
  '6af6f549a4c7b78e8e727fd9',
  '6af6f549a4c7b78e8e727fdb',
  '6af6f549a4c7b78e8e727fdd',
  '6af6f549a4c7b78e8e727fe2',
];

function getArg(prefix) {
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) return null;
  return found.slice(prefix.length).trim() || null;
}

function sanitizeMongoUrl(rawUrl) {
  let u = String(rawUrl || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  if (u.endsWith('>')) u = u.slice(0, -1);
  return u;
}

function resolveMongoConnectionString() {
  const cli = getArg('--mongo-url=');
  if (cli) return { url: sanitizeMongoUrl(cli), source: '--mongo-url' };
  const cfg = sanitizeMongoUrl(String(config?.mongoose?.url || ''));
  if (cfg) return { url: cfg, source: 'config.mongoose.url' };
  return { url: sanitizeMongoUrl(String(process.env.MONGODB_URL || '')), source: 'process.env.MONGODB_URL' };
}

async function connectMongo() {
  const { url: u, source } = resolveMongoConnectionString();
  if (!u) throw new Error('MongoDB URL is empty. Set MONGODB_URL or pass --mongo-url=');
  const redacted = u.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
  logger.info(`Connecting to MongoDB (${source}): ${redacted}`);
  await mongoose.connect(u, { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 30_000 });
}

function parseIds(raw) {
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
}

/**
 * @param {import('mongoose').Types.ObjectId} oid
 */
async function countProductReferences(oid) {
  const id = oid;
  const checks = await Promise.all([
    Sales.countDocuments({ materialCode: id }),
    Forecast.countDocuments({ product: id }),
    Replenishment.countDocuments({ product: id }),
    WarehouseInventory.countDocuments({ itemId: id }),
    WhmsOrder.countDocuments({ productId: id }),
    InwardRecord.countDocuments({ productId: id }),
    VendorPurchaseOrder.countDocuments({ 'items.productId': id }),
    VendorBox.countDocuments({ productId: id }),
    VendorProductionFlow.countDocuments({ product: id }),
    VendorGrn.countDocuments({ productId: id }),
    VendorPoReturnChallan.countDocuments({ productId: id }),
    VendorPoVendorReturn.countDocuments({ productId: id }),
    VendorManagement.countDocuments({ products: id }),
  ]);
  const labels = [
    'sales.materialCode',
    'forecast.product',
    'replenishment.product',
    'warehouseInventory.itemId',
    'whmsOrder.productId',
    'inwardRecord.productId',
    'vendorPurchaseOrder.items.productId',
    'vendorBox.productId',
    'vendorProductionFlow.product',
    'vendorGrn.productId',
    'vendorPoReturnChallan.productId',
    'vendorPoVendorReturn.productId',
    'vendorManagement.products',
  ];
  /** @type {Record<string, number>} */
  const refs = {};
  let total = 0;
  labels.forEach((label, i) => {
    const n = checks[i] || 0;
    if (n > 0) refs[label] = n;
    total += n;
  });
  return { total, refs };
}

/**
 * @param {{ productId: string, apply: boolean, force: boolean }} params
 */
async function processProduct({ productId, apply, force }) {
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return { productId, status: 'invalid_id' };
  }
  const oid = new mongoose.Types.ObjectId(productId);
  const product = await Product.findById(oid)
    .select('name softwareCode factoryCode internalCode vendorCode status createdAt')
    .lean();
  if (!product) {
    return { productId, status: 'not_found' };
  }

  const { total: refTotal, refs } = await countProductReferences(oid);
  const preview = {
    productId,
    name: product.name,
    softwareCode: product.softwareCode,
    factoryCode: product.factoryCode,
    internalCode: product.internalCode,
    vendorCode: product.vendorCode,
    status: product.status,
    createdAt: product.createdAt,
    referenceCount: refTotal,
    references: refs,
  };

  if (!apply) {
    return { ...preview, status: 'would_delete' };
  }

  if (refTotal > 0 && !force) {
    return {
      ...preview,
      status: 'blocked',
      reason: 'Other collections reference this product (pass --force to delete anyway)',
    };
  }

  const r = await Product.deleteOne({ _id: oid });
  if (!r.deletedCount) {
    return { ...preview, status: 'failed', reason: 'Product.deleteOne returned 0' };
  }
  return { ...preview, status: 'deleted' };
}

function printUsage() {
  // eslint-disable-next-line no-console
  console.error('Usage: node src/scripts/delete-catalog-products-by-id.js [--ids=id1,id2,...] [--apply] [--force] [--mongo-url=]');
}

async function main() {
  const idsArg = getArg('--ids=');
  const APPLY = process.argv.includes('--apply');
  const FORCE = process.argv.includes('--force');
  const productIds = idsArg ? parseIds(idsArg) : DEFAULT_PRODUCT_IDS;

  if (!productIds.length) {
    printUsage();
    process.exit(1);
  }

  logger.info(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} | force=${FORCE} | products=${productIds.length}`);

  await connectMongo();

  /** @type {Record<string, unknown>[]} */
  const results = [];

  try {
    for (const productId of productIds) {
      const result = await processProduct({ productId, apply: APPLY, force: FORCE });
      results.push(result);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result, null, 2));
    }

    const summary = {
      total: results.length,
      notFound: results.filter((r) => r.status === 'not_found').length,
      invalidId: results.filter((r) => r.status === 'invalid_id').length,
      wouldDelete: results.filter((r) => r.status === 'would_delete').length,
      deleted: results.filter((r) => r.status === 'deleted').length,
      blocked: results.filter((r) => r.status === 'blocked').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ summary }, null, 2));

    if (!APPLY) {
      // eslint-disable-next-line no-console
      console.log('(No writes: pass --apply to delete. Use --force if referenceCount > 0.)');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
