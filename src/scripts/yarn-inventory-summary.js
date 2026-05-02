#!/usr/bin/env node

/**
 * Prints the same totals as GET /v1/yarn-management/yarn-inventories/summary (live LT/ST/unallocated/blocked).
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/yarn-inventory-summary.js
 *   NODE_ENV=development node src/scripts/yarn-inventory-summary.js --json
 *   NODE_ENV=development node src/scripts/yarn-inventory-summary.js --yarn-name=cotton --json
 *   NODE_ENV=development node src/scripts/yarn-inventory-summary.js --inventory-status=low_stock
 *   NODE_ENV=development node src/scripts/yarn-inventory-summary.js --yarn-id=<ObjectId>
 *   NODE_ENV=development node src/scripts/yarn-inventory-summary.js --overbooked=true
 *   NODE_ENV=development node src/scripts/yarn-inventory-summary.js --mongo-url=...
 *
 * Troubleshooting Atlas: same as other scripts — use mongodb+srv when possible; allowlist IP/VPN.
 */

import url from 'url';

const _origUrlParse = url.parse;
url.parse = function patchedParse(urlStr, ...args) {
  try {
    return _origUrlParse.call(this, urlStr, ...args);
  } catch {
    const firstHost = String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2');
    return _origUrlParse.call(this, firstHost, ...args);
  }
};

import mongoose from 'mongoose';
import config from '../config/config.js';
import { getYarnInventoriesSummary } from '../services/yarnManagement/yarnInventory.service.js';

/** @type {mongoose.ConnectOptions & Record<string, unknown>} */
const MONGO_SCRIPT_OPTIONS = {
  ...config.mongoose.options,
  serverSelectionTimeoutMS: 60000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 120000,
};

/** @param {string} rawUrl @returns {string} */
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

/** @returns {string} */
function resolveMongoUrl() {
  const cliArg = process.argv.find((a) => a.startsWith('--mongo-url='));
  if (cliArg) {
    const v = sanitizeMongoUrl(cliArg.slice('--mongo-url='.length));
    if (v) return v;
  }
  return sanitizeMongoUrl(String(config?.mongoose?.url || ''));
}

/** @returns {boolean} */
function cliHasFlag(name) {
  return process.argv.includes(name);
}

/** @param {string} prefix @returns {string | undefined} */
function cliValue(prefix) {
  const raw = process.argv.find((a) => a.startsWith(prefix));
  if (!raw) return undefined;
  return raw.slice(prefix.length).trim() || undefined;
}

/**
 * Builds filter object compatible with `getYarnInventoriesSummary`.
 * @returns {Record<string, unknown>}
 */
function parseFiltersFromArgv() {
  /** @type {Record<string, unknown>} */
  const filter = {};

  const yarnId = cliValue('--yarn-id=');
  if (yarnId) filter.yarn_id = yarnId;

  const yarnName = cliValue('--yarn-name=');
  if (yarnName) filter.yarn_name = yarnName;

  const status = cliValue('--inventory-status=');
  if (status) filter.inventory_status = status;

  const ob = cliValue('--overbooked=');
  if (ob !== undefined && ob !== '') {
    filter.overbooked = ob === 'true' || ob === '1';
  }

  return filter;
}

async function main() {
  const mongoUrl = resolveMongoUrl();
  if (!mongoUrl) {
    console.error('Missing mongo URL — set MONGODB_URL / config or pass --mongo-url=');
    process.exit(2);
    return;
  }

  const filters = parseFiltersFromArgv();
  await mongoose.connect(mongoUrl, MONGO_SCRIPT_OPTIONS);

  try {
    const summary = await getYarnInventoriesSummary(filters);

    if (cliHasFlag('--json')) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    console.log('Yarn inventory summary (same logic as GET /yarn-inventories/summary)');
    if (Object.keys(filters).length) {
      console.log('Filters:', JSON.stringify(filters));
    }
    console.log('='.repeat(56));
    console.log(`  SKU count (yarn names):     ${summary.skuCount}`);
    console.log('');
    console.log(`  LT net kg:                 ${summary.totals.longTermKg.toLocaleString('en-IN')} kg`);
    console.log(`  ST net kg:                 ${summary.totals.shortTermKg.toLocaleString('en-IN')} kg`);
    console.log(`  LT + ST kg:               ${summary.totals.ltPlusShortKg.toLocaleString('en-IN')} kg`);
    console.log(`  Unallocated net kg:        ${summary.totals.unallocatedKg.toLocaleString('en-IN')} kg`);
    console.log(`  Blocked (issued cones) kg: ${summary.totals.blockedKg.toLocaleString('en-IN')} kg`);
    console.log(`  Grand (LT+ST+unalloc) kg:  ${summary.totals.grandNetKgAllBuckets.toLocaleString('en-IN')} kg`);
    console.log('');
    console.log(`  ST cones:                  ${summary.cones.shortTerm}`);
    console.log(`  Blocked cones:             ${summary.cones.blocked}`);
    console.log('='.repeat(56));
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
