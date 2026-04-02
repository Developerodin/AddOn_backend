#!/usr/bin/env node
/**
 * Reset Final Checking data and rebuild it from Branding transferredData.
 *
 * What this script does per article:
 * 1) Resets floorQuantities.finalChecking counters and arrays.
 * 2) Recreates finalChecking.receivedData from branding.transferredData (style/brand wise).
 * 3) Sets finalChecking.received/remaining from rebuilt rows total.
 *
 * Usage:
 *   node src/scripts/reset-final-checking-from-branding.js --dry-run
 *   node src/scripts/reset-final-checking-from-branding.js
 *   node src/scripts/reset-final-checking-from-branding.js --order-id=<orderId>
 *   node src/scripts/reset-final-checking-from-branding.js --article-id=<articleId>
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { Article } from '../models/production/index.js';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const orderIdArg = args.find((a) => a.startsWith('--order-id='));
const articleIdArg = args.find((a) => a.startsWith('--article-id='));
const orderId = orderIdArg ? orderIdArg.split('=')[1]?.trim() : '';
const articleId = articleIdArg ? articleIdArg.split('=')[1]?.trim() : '';

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function buildFinalCheckingFromBranding(branding = {}) {
  const rows = Array.isArray(branding.transferredData) ? branding.transferredData : [];
  const normalizedRows = rows
    .map((row) => ({
      transferred: Math.max(0, toNumber(row?.transferred)),
      styleCode: String(row?.styleCode || ''),
      brand: String(row?.brand || ''),
    }))
    .filter((row) => row.transferred > 0);

  // Fallback: if old docs have branding.transferred but no row split, keep quantity as one blank row.
  if (normalizedRows.length === 0) {
    const brandingTransferred = Math.max(0, toNumber(branding.transferred));
    if (brandingTransferred > 0) {
      normalizedRows.push({
        transferred: brandingTransferred,
        styleCode: '',
        brand: '',
      });
    }
  }

  const total = normalizedRows.reduce((sum, row) => sum + row.transferred, 0);

  return {
    received: total,
    completed: 0,
    remaining: total,
    transferred: 0,
    m1Quantity: 0,
    m2Quantity: 0,
    m3Quantity: 0,
    m4Quantity: 0,
    m1Transferred: 0,
    m1Remaining: 0,
    m2Transferred: 0,
    m2Remaining: 0,
    repairStatus: 'Not Required',
    repairRemarks: '',
    transferredData: [],
    receivedData: normalizedRows.map((row) => ({
      receivedStatusFromPreviousFloor: 'Completed',
      receivedInContainerId: null,
      receivedTimestamp: null,
      transferred: row.transferred,
      styleCode: row.styleCode,
      brand: row.brand,
    })),
  };
}

function buildFilter() {
  const filter = {};

  if (orderId) {
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw new Error(`Invalid --order-id: ${orderId}`);
    }
    filter.orderId = new mongoose.Types.ObjectId(orderId);
  }

  if (articleId) {
    if (!mongoose.Types.ObjectId.isValid(articleId)) {
      throw new Error(`Invalid --article-id: ${articleId}`);
    }
    filter._id = new mongoose.Types.ObjectId(articleId);
  }

  return filter;
}

async function run() {
  logger.info('Connecting to MongoDB...');
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  try {
    if (isDryRun) {
      logger.info('DRY RUN enabled. No writes will be performed.');
    }

    const filter = buildFilter();
    const cursor = Article.find(filter)
      .select('id articleNumber orderId floorQuantities.branding floorQuantities.finalChecking')
      .cursor();

    let scanned = 0;
    let matched = 0;
    let changed = 0;
    const bulkOps = [];

    for await (const article of cursor) {
      scanned += 1;

      const branding = article?.floorQuantities?.branding || {};
      const nextFinal = buildFinalCheckingFromBranding(branding);
      const prevFinal = article?.floorQuantities?.finalChecking || {};

      const prevSignature = JSON.stringify({
        received: toNumber(prevFinal.received),
        completed: toNumber(prevFinal.completed),
        remaining: toNumber(prevFinal.remaining),
        transferred: toNumber(prevFinal.transferred),
        m1Quantity: toNumber(prevFinal.m1Quantity),
        m2Quantity: toNumber(prevFinal.m2Quantity),
        m3Quantity: toNumber(prevFinal.m3Quantity),
        m4Quantity: toNumber(prevFinal.m4Quantity),
        m1Transferred: toNumber(prevFinal.m1Transferred),
        m1Remaining: toNumber(prevFinal.m1Remaining),
        m2Transferred: toNumber(prevFinal.m2Transferred),
        m2Remaining: toNumber(prevFinal.m2Remaining),
        repairStatus: String(prevFinal.repairStatus || ''),
        repairRemarks: String(prevFinal.repairRemarks || ''),
        transferredData: Array.isArray(prevFinal.transferredData) ? prevFinal.transferredData : [],
        receivedData: Array.isArray(prevFinal.receivedData) ? prevFinal.receivedData : [],
      });
      const nextSignature = JSON.stringify(nextFinal);

      if (prevSignature === nextSignature) {
        continue;
      }

      matched += 1;
      changed += 1;

      logger.info(
        `[${changed}] ${article.articleNumber || article.id || article._id} | final.received: ${toNumber(prevFinal.received)} -> ${toNumber(
          nextFinal.received
        )} | rows: ${Array.isArray(prevFinal.receivedData) ? prevFinal.receivedData.length : 0} -> ${nextFinal.receivedData.length}`
      );

      if (!isDryRun) {
        bulkOps.push({
          updateOne: {
            filter: { _id: article._id },
            update: {
              $set: {
                'floorQuantities.finalChecking': nextFinal,
              },
            },
          },
        });
      }
    }

    if (!isDryRun && bulkOps.length > 0) {
      const result = await Article.bulkWrite(bulkOps, { ordered: false });
      logger.info(`Bulk update complete. modifiedCount=${result.modifiedCount || 0}`);
    }

    logger.info(
      JSON.stringify(
        {
          dryRun: isDryRun,
          scanned,
          matched,
          changed,
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected.');
  }
}

run().catch((error) => {
  logger.error(error);
  process.exit(1);
});
