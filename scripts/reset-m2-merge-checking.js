#!/usr/bin/env node
/**
 * Reset a resolved Checking-floor M2→M1 merge so it can be tested again.
 *
 * Usage:
 *   node scripts/reset-m2-merge-checking.js --order ORD-000078 --article A001
 *   node scripts/reset-m2-merge-checking.js --order ORD-000078 --article A001 --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import {
  Article,
  ProductionOrder,
  M2Log,
  M2LogType,
  M2EntryStatus,
  ProductionFloor,
} from '../src/models/production/index.js';
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
 * Reverse one floor's cascade merge increment.
 * @param {Object} article
 * @param {string} floorLabel
 * @param {number} qty
 * @param {string} sourceFloor
 */
function applyCascadeMergeDecrement(article, floorLabel, qty, sourceFloor) {
  const floorKey = article.getFloorKey(floorLabel);
  const fd = article.floorQuantities?.[floorKey];
  if (!fd || qty <= 0) return;

  const isSource = floorLabel === sourceFloor;
  const isQc = QC_KEYS.has(floorKey);

  if (isQc) {
    if (isSource || qcFloorHasActivity(fd)) {
      if (isSource) {
        fd.m2Quantity = (fd.m2Quantity || 0) + qty;
        fd.completed = Math.max(0, (fd.completed || 0) - qty);
      }
      fd.m1Quantity = Math.max(0, (fd.m1Quantity || 0) - qty);
      fd.m1Transferred = Math.max(0, (fd.m1Transferred || 0) - qty);
      fd.transferred = Math.max(0, (fd.transferred || 0) - qty);
      recalcQcFloorRemaining(fd);
      article.markModified(`floorQuantities.${floorKey}`);
    }
    return;
  }

  if (floorKey === 'dispatch') {
    fd.received = Math.max(0, (fd.received || 0) - qty);
    fd.remaining = Math.max(0, (fd.received || 0) - (fd.transferred || 0));
    article.markModified(`floorQuantities.${floorKey}`);
    return;
  }

  if ((fd.received || 0) > 0 || (fd.completed || 0) > 0 || (fd.transferred || 0) > 0) {
    fd.received = Math.max(0, (fd.received || 0) - qty);
    fd.completed = Math.max(0, (fd.completed || 0) - qty);
    if ((fd.transferred || 0) > 0) {
      fd.transferred = Math.max(0, (fd.transferred || 0) - qty);
    }
    fd.remaining = Math.max(0, (fd.received || 0) - (fd.transferred || 0));
    article.markModified(`floorQuantities.${floorKey}`);
  }
}

/**
 * Subtract brand rows from transferredData after undoing merge.
 * @param {Array} rows
 * @param {number} qty
 * @param {string} brandHint
 * @returns {Array}
 */
function subtractTransferredDataByBrand(rows, qty, brandHint = '') {
  const list = Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [];
  if (!list.length || qty <= 0) return list;
  const key = String(brandHint || list[0]?.brand || '').trim().toLowerCase();
  return list
    .map((row) => {
      const brand = String(row.brand || '').trim();
      if (key && brand.toLowerCase() !== key) return row;
      return { ...row, transferred: Math.max(0, Number(row.transferred || 0) - qty) };
    })
    .filter((row) => Number(row.transferred || 0) > 0);
}

/**
 * @param {Object} fd
 * @returns {string}
 */
function formatQc(fd) {
  return `m1=${fd?.m1Quantity ?? 0} m2=${fd?.m2Quantity ?? 0} trf=${fd?.transferred ?? 0} rcv=${fd?.received ?? 0}`;
}

/**
 * @returns {Promise<void>}
 */
const run = async () => {
  if (!ORDER_NUMBER || !ARTICLE_NUMBER) {
    console.error('Usage: node scripts/reset-m2-merge-checking.js --order ORD-xxx --article Axxx [--apply]');
    process.exit(1);
  }

  const redactedUri = await connectMongooseForScript(config);
  console.log(`✅ Connected (${redactedUri})`);
  console.log(APPLY ? '🔴 APPLY mode' : '🟡 DRY RUN — pass --apply to write');

  const order = await ProductionOrder.findOne({ orderNumber: ORDER_NUMBER }).select('_id orderNumber').lean();
  if (!order) {
    console.error(`Order not found: ${ORDER_NUMBER}`);
    process.exit(1);
  }

  const article = await Article.findOne({ orderId: order._id, articleNumber: ARTICLE_NUMBER });
  if (!article) {
    console.error(`Article not found: ${ARTICLE_NUMBER}`);
    process.exit(1);
  }

  const mergeLog = await M2Log.findOne({
    type: M2LogType.MERGE_TO_M1,
    orderId: order._id.toString(),
    articleId: article._id.toString(),
    sourceFloor: ProductionFloor.CHECKING,
  })
    .sort({ timestamp: -1 })
    .lean();

  if (!mergeLog) {
    console.error('No MERGE_TO_M1 log found for Checking on this article');
    process.exit(1);
  }

  const qty = Number(mergeLog.quantity || 0);
  const entryId = mergeLog.entryId;
  if (!qty || !entryId) {
    console.error('Merge log missing quantity or entryId');
    process.exit(1);
  }

  const entry = await M2Log.findOne({ entryId, type: M2LogType.ENTRY });
  if (!entry) {
    console.error(`M2 entry not found: ${entryId}`);
    process.exit(1);
  }

  let cascadeFloors = mergeLog.cascadeFloors?.length
    ? mergeLog.cascadeFloors
    : await getCascadeFloorsForM2Merge(article, ProductionFloor.CHECKING);

  console.log(`\nMerge to undo: ${qty} from Checking (entry ${entryId})`);
  console.log(`Cascade floors: ${cascadeFloors.join(' → ')}`);
  console.log(`\nBefore reset:`);
  console.log(`  checking: ${formatQc(article.floorQuantities?.checking)}`);
  console.log(`  secondaryChecking: ${formatQc(article.floorQuantities?.secondaryChecking)}`);
  console.log(`  finalChecking: ${formatQc(article.floorQuantities?.finalChecking)}`);
  console.log(`  entry status=${entry.status} remaining=${entry.remainingQuantity}/${entry.originalQuantity}`);

  if (!APPLY) {
    console.log('\n[dry-run] Would reverse cascade, reopen M2 entry, delete merge log');
    await mongoose.disconnect();
    return;
  }

  for (const floorLabel of cascadeFloors) {
    applyCascadeMergeDecrement(article, floorLabel, qty, ProductionFloor.CHECKING);
  }

  const fc = article.floorQuantities?.finalChecking;
  if (fc?.transferredData?.length) {
    const brandMatch = String(mergeLog.remarks || '').match(/Van Heusen|brands=([^|]+)/i);
    const brandHint = brandMatch ? (brandMatch[1] || brandMatch[0]) : '';
    fc.transferredData = subtractTransferredDataByBrand(fc.transferredData, qty, brandHint);
    article.markModified('floorQuantities.finalChecking');
  }

  entry.remainingQuantity = Math.min(
    entry.originalQuantity || qty,
    (entry.remainingQuantity || 0) + qty
  );
  entry.status = M2EntryStatus.OPEN;
  await entry.save();

  await M2Log.deleteOne({ _id: mergeLog._id });

  await article.save();

  console.log('\nAfter reset:');
  console.log(`  checking: ${formatQc(article.floorQuantities?.checking)}`);
  console.log(`  secondaryChecking: ${formatQc(article.floorQuantities?.secondaryChecking)}`);
  console.log(`  finalChecking: ${formatQc(article.floorQuantities?.finalChecking)}`);
  console.log(`  entry status=${entry.status} remaining=${entry.remainingQuantity}/${entry.originalQuantity}`);
  console.log('\n✅ Ready to merge again from M2 Management');

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
