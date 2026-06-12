#!/usr/bin/env node
/**
 * Repair missing m1Transferred/transferred on QC floors after historical M2→M1 merges.
 *
 * Old merge logic bumped m1Quantity but not m1Transferred, causing M1/TRF mismatch
 * and inflated REM on QC floors.
 *
 * Usage:
 *   node scripts/repair-m2-merge-qc-transfer.js
 *   node scripts/repair-m2-merge-qc-transfer.js --apply
 *   node scripts/repair-m2-merge-qc-transfer.js --apply --order ORD-000007 --article A571
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import { Article, ProductionOrder, M2Log, M2LogType } from '../src/models/production/index.js';
import {
  getCascadeFloorsForM2Merge,
  recalcQcFloorRemaining,
  qcFloorHasActivity,
} from '../src/utils/m2Cascade.util.js';
import { connectMongooseForScript } from './lib/mongoScriptConnect.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ORDER_FLAG = args.indexOf('--order');
const ORDER_NUMBER = ORDER_FLAG !== -1 ? String(args[ORDER_FLAG + 1] || '').trim() : '';
const ARTICLE_FLAG = args.indexOf('--article');
const ARTICLE_NUMBER = ARTICLE_FLAG !== -1 ? String(args[ARTICLE_FLAG + 1] || '').trim() : '';

const QC_KEYS = new Set(['checking', 'secondaryChecking', 'finalChecking']);

/**
 * @param {Object} article
 * @param {string} floorLabel
 * @returns {string}
 */
const getFloorKey = (article, floorLabel) => article.getFloorKey(floorLabel);

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
    const qty = Number(log.quantity || 0);
    if (qty <= 0 || !log.sourceFloor) {
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

    let cascadeFloors;
    try {
      cascadeFloors = await getCascadeFloorsForM2Merge(article, log.sourceFloor);
    } catch (err) {
      console.warn(`⚠️  Skip log ${log.entryId}: ${err?.message || err}`);
      skipped += 1;
      continue;
    }

    let articleChanged = false;

    for (const floorLabel of cascadeFloors) {
      const floorKey = getFloorKey(article, floorLabel);
      if (!QC_KEYS.has(floorKey)) continue;

      const fd = article.floorQuantities?.[floorKey];
      if (!fd) continue;

      const isSource = floorLabel === log.sourceFloor;
      if (!isSource && !qcFloorHasActivity(fd)) continue;

      const m1TrfBefore = fd.m1Transferred ?? fd.transferred ?? 0;
      const trfBefore = fd.transferred ?? 0;
      const remBefore = fd.remaining ?? 0;

      const m1TrfAfter = m1TrfBefore + qty;
      const trfAfter = trfBefore + qty;

      const line = `${log.orderNumber || ''} | ${log.articleNumber} | ${floorLabel} | m1Trf ${m1TrfBefore}→${m1TrfAfter}, trf ${trfBefore}→${trfAfter}, rem ${remBefore}→? (+${qty})`;

      if (!APPLY) {
        wouldFix += 1;
        console.log(`[dry-run] ${line}`);
        continue;
      }

      try {
        fd.m1Transferred = m1TrfAfter;
        fd.transferred = trfAfter;
        recalcQcFloorRemaining(fd);
        article.markModified(`floorQuantities.${floorKey}`);
        articleChanged = true;
        console.log(`✅ ${line} rem now ${fd.remaining}`);
      } catch (err) {
        errors += 1;
        console.error(`❌ ${line}`, err?.message || err);
      }
    }

    if (APPLY && articleChanged) {
      try {
        await article.save();
        fixed += 1;
      } catch (err) {
        errors += 1;
        console.error(`❌ Save failed for ${log.articleNumber}:`, err?.message || err);
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Merge logs scanned: ${mergeLogs.length}`);
  console.log(`Skipped: ${skipped}`);
  console.log(APPLY ? `Articles saved: ${fixed}` : `QC floor rows would fix: ${wouldFix}`);
  if (errors) console.log(`Errors: ${errors}`);

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
