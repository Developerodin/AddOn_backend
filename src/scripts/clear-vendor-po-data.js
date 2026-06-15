#!/usr/bin/env node
/**
 * Clear all vendor PO operational data (boxes, production flows, POs, vendor inward lines,
 * containers staged with vendor flows) for a fresh start. Does NOT delete VendorManagement profiles.
 *
 * Usage:
 *   node src/scripts/clear-vendor-po-data.js              # dry-run (counts only)
 *   node src/scripts/clear-vendor-po-data.js --execute    # perform deletes
 *
 * Optional: `--include-vendors` also deletes VendorManagement vendor profile documents.
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import {
  VendorBox,
  VendorProductionFlow,
  VendorPurchaseOrder,
  VendorManagement,
} from '../models/index.js';
import InwardReceive from '../models/whms/inwardReceive.model.js';
import ContainersMaster from '../models/production/containersMaster.model.js';
import config from '../config/config.js';

/**
 * Normalize URL for CLI overrides.
 * @param {string} rawUrl
 * @returns {string}
 */
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

/**
 * Connect using MONGODB_URL from config or `--mongo-url=...`.
 * @returns {Promise<void>}
 */
async function connectMongo() {
  const cliArg = process.argv.find((a) => a.startsWith('--mongo-url='));
  const raw = cliArg
    ? sanitizeMongoUrl(cliArg.slice('--mongo-url='.length))
    : String(config?.mongoose?.url || '').trim();
  if (!raw) {
    throw new Error('MongoDB URL is empty. Set MONGODB_URL in .env or pass --mongo-url=');
  }
  await mongoose.connect(raw, config.mongoose.options);
}

/**
 * @param {string[]} argv
 * @returns {{ execute: boolean, includeVendors: boolean }}
 */
function parseArgs(argv) {
  return {
    execute: argv.includes('--execute'),
    includeVendors: argv.includes('--include-vendors'),
  };
}

/**
 * Count documents matching a filter.
 * @param {import('mongoose').Model} Model
 * @param {object} [filter]
 */
async function countDocs(Model, filter = {}) {
  return Model.countDocuments(filter);
}

async function main() {
  const { execute, includeVendors } = parseArgs(process.argv.slice(2));

  await connectMongo();
  console.log(`Connected to MongoDB (${execute ? 'EXECUTE' : 'DRY-RUN'})`);

  const vendorInwardFilter = {
    $or: [
      { inwardSource: 'vendor' },
      { vendorPurchaseOrderId: { $ne: null } },
      { vendorProductionFlowId: { $ne: null } },
    ],
  };
  const vendorContainerFilter = {
    'activeItems.vendorProductionFlow': { $exists: true, $ne: null },
  };

  const plan = [
    { label: 'VendorBox', Model: VendorBox, filter: {} },
    { label: 'VendorProductionFlow', Model: VendorProductionFlow, filter: {} },
    { label: 'VendorPurchaseOrder', Model: VendorPurchaseOrder, filter: {} },
    { label: 'InwardReceive (vendor-linked)', Model: InwardReceive, filter: vendorInwardFilter },
    {
      label: 'ContainersMaster (vendor-staged)',
      Model: ContainersMaster,
      filter: vendorContainerFilter,
    },
  ];

  if (includeVendors) {
    plan.push({ label: 'VendorManagement (profiles)', Model: VendorManagement, filter: {} });
  }

  console.log('\n--- Counts ---');
  for (const step of plan) {
    const n = await countDocs(step.Model, step.filter);
    console.log(`  ${step.label}: ${n}`);
  }

  if (!execute) {
    console.log('\nDry-run only. Re-run with --execute to delete.');
    await mongoose.disconnect();
    return;
  }

  console.log('\n--- Deleting ---');
  for (const step of plan) {
    const result = await step.Model.deleteMany(step.filter);
    console.log(`  ${step.label}: deleted ${result.deletedCount ?? 0}`);
  }

  console.log('\nDone. Vendor PO data cleared — you can create new POs from scratch.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
