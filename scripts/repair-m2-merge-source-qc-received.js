#!/usr/bin/env node
/**
 * Repair inflated source QC `received` from historical M2→M1 merges.
 *
 * Old merge logic bumped source QC `received` while also reducing `m2`, double-counting
 * in `remaining = received - m1Transferred - m2 - m3 - m4`.
 *
 * Usage:
 *   node scripts/repair-m2-merge-source-qc-received.js
 *   node scripts/repair-m2-merge-source-qc-received.js --apply
 *   node scripts/repair-m2-merge-source-qc-received.js --apply --order ORD-000007
 *   node scripts/repair-m2-merge-source-qc-received.js --apply --article A571
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import { Article, ProductionOrder, M2Log, M2LogType } from '../src/models/production/index.js';
import { recalcQcFloorRemaining } from '../src/utils/m2Cascade.util.js';
import { connectMongooseForScript } from './lib/mongoScriptConnect.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ORDER_FLAG = args.indexOf('--order');
const ORDER_NUMBER = ORDER_FLAG !== -1 ? String(args[ORDER_FLAG + 1] || '').trim() : '';
const ARTICLE_FLAG = args.indexOf('--article');
const ARTICLE_NUMBER = ARTICLE_FLAG !== -1 ? String(args[ARTICLE_FLAG + 1] || '').trim() : '';

const QC_SOURCE_FLOORS = new Set(['Checking', 'Secondary Checking', 'Final Checking']);
const REPAIR_TAG = '[m2-merge-received-repair]';

/**
 * @param {Object} article
 * @param {string} sourceFloor
 * @returns {string}
 */
const getFloorKey = (article, sourceFloor) => article.getFloorKey(sourceFloor);

/**
 * @returns {Promise<void>}
 */
const run = async () => {
  const redactedUri = await connectMongooseForScript(config);
  console.log(`✅ Connected (${redactedUri})`);
  console.log(APPLY ? '🔴 APPLY mode — will adjust articles' : '🟡 DRY RUN — pass --apply to write');

  let orderObjectId = null;
  if (ORDER_NUMBER) {
    const order = await ProductionOrder.findOne({ orderNumber: ORDER_NUMBER }).select('_id orderNumber').lean();
    if (!order) {
      console.error(`Order not found: ${ORDER_NUMBER}`);
      process.exit(1);
    }
    orderObjectId = order._id;
    console.log(`Filter order: ${ORDER_NUMBER}`);
  }
  if (ARTICLE_NUMBER) console.log(`Filter article: ${ARTICLE_NUMBER}`);

  const logFilter = { type: M2LogType.MERGE_TO_M1 };
  if (orderObjectId) logFilter.orderId = orderObjectId.toString();
  if (ARTICLE_NUMBER) {
    const art = await Article.findOne({ articleNumber: ARTICLE_NUMBER }).select('_id').lean();
    if (!art) {
      console.error(`Article not found: ${ARTICLE_NUMBER}`);
      process.exit(1);
    }
    logFilter.articleId = art._id.toString();
  }

  const mergeLogs = await M2Log.find(logFilter).sort({ timestamp: 1 }).lean();
  console.log(`Found ${mergeLogs.length} MERGE_TO_M1 log(s)\n`);

  let wouldFix = 0;
  let fixed = 0;
  let skipped = 0;
  let errors = 0;

  /** @type {Map<string, Object>} */
  const articleCache = new Map();

  for (const log of mergeLogs) {
    if (!QC_SOURCE_FLOORS.has(log.sourceFloor)) {
      skipped += 1;
      continue;
    }

    const qty = Number(log.quantity || 0);
    if (qty <= 0) {
      skipped += 1;
      continue;
    }

    const articleId = log.articleId?.toString?.() ?? String(log.articleId);
    let article = articleCache.get(articleId);
    if (!article) {
      article = await Article.findById(articleId);
      if (!article) {
        console.warn(`⚠️  Article missing for log ${log.entryId || log._id}`);
        skipped += 1;
        continue;
      }
      articleCache.set(articleId, article);
    }

    const floorKey = getFloorKey(article, log.sourceFloor);
    const fd = article.floorQuantities?.[floorKey];
    if (!fd || (fd.received || 0) <= 0) {
      skipped += 1;
      continue;
    }

    const receivedBefore = fd.received || 0;
    const remBefore = fd.remaining ?? 0;
    const receivedAfter = Math.max(0, receivedBefore - qty);

    if (receivedAfter === receivedBefore) {
      skipped += 1;
      continue;
    }

    const orderNumber = log.orderNumber || '';
    const line = `${orderNumber} | ${log.articleNumber} | ${log.sourceFloor} | received ${receivedBefore}→${receivedAfter}, rem ${remBefore}→? (−${qty} received)`;

    if (!APPLY) {
      wouldFix += 1;
      console.log(`[dry-run] ${line}`);
      continue;
    }

    try {
      fd.received = receivedAfter;
      recalcQcFloorRemaining(fd);
      article.markModified(`floorQuantities.${floorKey}`);
      await article.save();
      fixed += 1;
      console.log(`✅ ${line} rem now ${fd.remaining}`);
    } catch (err) {
      errors += 1;
      console.error(`❌ ${line}`, err?.message || err);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Merge logs scanned: ${mergeLogs.length}`);
  console.log(`Skipped: ${skipped}`);
  console.log(APPLY ? `Articles fixed: ${fixed}` : `Would fix: ${wouldFix}`);
  if (errors) console.log(`Errors: ${errors}`);
  console.log(`Tag for audit: ${REPAIR_TAG}`);

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
