#!/usr/bin/env node
/**
 * Repair QC floors corrupted by pre-save proportional scale-down after M2→M1 cascade.
 *
 * Symptom: downstream Secondary/Final Checking M1+defects === received but cascade
 * should have pushed M1/m1Transferred/transferred above received.
 *
 * Usage:
 *   node scripts/repair-m2-cascade-qc-scaledown.js --order ORD-000078 --article A001
 *   node scripts/repair-m2-cascade-qc-scaledown.js --order ORD-000078 --article A001 --apply
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
 * Whether QC floor data matches post-cascade scale-down corruption pattern.
 * @param {Object} fd
 * @param {number} received
 * @param {number} cascadeQty
 * @returns {boolean}
 */
function looksScaledDown(fd, received, cascadeQty) {
  if (cascadeQty <= 0 || received <= 0) return false;
  const m1 = fd.m1Quantity || 0;
  const m2 = fd.m2Quantity || 0;
  const m3 = fd.m3Quantity || 0;
  const m4 = fd.m4Quantity || 0;
  const total = m1 + m2 + m3 + m4;
  const trf = fd.transferred || 0;
  const m1Trf = fd.m1Transferred || 0;
  const cappedTransfer = trf === received || m1Trf === received;
  const packedToReceived = total === received || total === received - 1 || total === received + 1;
  return packedToReceived && cappedTransfer && m1 < received + cascadeQty;
}

/**
 * Restore QC floor quantities after proportional scale-down corruption.
 * @param {Object} fd
 * @param {number} received
 * @param {number} cascadeQty
 */
function restoreScaledQcFloor(fd, received, cascadeQty) {
  const preTotal = received + cascadeQty;
  const scaleUp = preTotal / received;
  const m1 = fd.m1Quantity || 0;
  const m2 = fd.m2Quantity || 0;
  const m3 = fd.m3Quantity || 0;
  const m4 = fd.m4Quantity || 0;

  fd.m1Quantity = Math.round(m1 * scaleUp);
  fd.m2Quantity = Math.round(m2 * scaleUp);
  fd.m3Quantity = Math.round(m3 * scaleUp);
  fd.m4Quantity = Math.round(m4 * scaleUp);

  // Upstream cascade only adds to M1 — rebalance rounding drift into M1
  const qualityTotal = fd.m1Quantity + fd.m2Quantity + fd.m3Quantity + fd.m4Quantity;
  const drift = preTotal - qualityTotal;
  if (drift !== 0 && Math.abs(drift) <= 3) {
    fd.m1Quantity = Math.max(0, fd.m1Quantity + drift);
  }

  fd.m1Transferred = fd.m1Quantity;
  fd.transferred = fd.m1Quantity;
  recalcQcFloorRemaining(fd);
}

/**
 * @returns {Promise<void>}
 */
const run = async () => {
  if (!ORDER_NUMBER || !ARTICLE_NUMBER) {
    console.error('Usage: node scripts/repair-m2-cascade-qc-scaledown.js --order ORD-xxx --article Axxx [--apply]');
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
    console.error(`Article not found: ${ARTICLE_NUMBER} on ${ORDER_NUMBER}`);
    process.exit(1);
  }

  const mergeLogs = await M2Log.find({
    type: M2LogType.MERGE_TO_M1,
    orderId: order._id.toString(),
    articleId: article._id.toString(),
  })
    .sort({ timestamp: 1 })
    .lean();

  console.log(`Found ${mergeLogs.length} MERGE_TO_M1 log(s) for ${ORDER_NUMBER} / ${ARTICLE_NUMBER}\n`);

  /** @type {Map<string, number>} */
  const cascadeQtyByFloorKey = new Map();

  for (const log of mergeLogs) {
    const qty = Number(log.quantity || 0);
    if (qty <= 0 || !log.sourceFloor) continue;

    let cascadeFloors;
    try {
      cascadeFloors = await getCascadeFloorsForM2Merge(article, log.sourceFloor);
    } catch (err) {
      console.warn(`⚠️  Skip log ${log.entryId}: ${err?.message || err}`);
      continue;
    }

    for (const floorLabel of cascadeFloors) {
      const floorKey = article.getFloorKey(floorLabel);
      if (!QC_KEYS.has(floorKey)) continue;
      if (floorLabel === log.sourceFloor) continue;
      const fd = article.floorQuantities?.[floorKey];
      if (!fd || !qcFloorHasActivity(fd)) continue;
      cascadeQtyByFloorKey.set(floorKey, (cascadeQtyByFloorKey.get(floorKey) || 0) + qty);
    }
  }

  let changed = false;

  for (const [floorKey, cascadeQty] of cascadeQtyByFloorKey.entries()) {
    const fd = article.floorQuantities[floorKey];
    const received = fd.received || 0;
    if (!looksScaledDown(fd, received, cascadeQty)) {
      console.log(`⏭️  ${floorKey}: no scale-down corruption detected (cascade +${cascadeQty})`);
      continue;
    }

    const before = {
      m1: fd.m1Quantity,
      m2: fd.m2Quantity,
      trf: fd.transferred,
      m1Trf: fd.m1Transferred,
    };

    if (!APPLY) {
      const preview = { ...fd };
      restoreScaledQcFloor(preview, received, cascadeQty);
      console.log(
        `[dry-run] ${floorKey}: m1 ${before.m1}→${preview.m1Quantity}, m2 ${before.m2}→${preview.m2Quantity}, ` +
          `trf ${before.trf}→${preview.transferred} (cascade +${cascadeQty})`
      );
      changed = true;
      continue;
    }

    restoreScaledQcFloor(fd, received, cascadeQty);
    article.markModified(`floorQuantities.${floorKey}`);
    console.log(
      `✅ ${floorKey}: m1 ${before.m1}→${fd.m1Quantity}, m2 ${before.m2}→${fd.m2Quantity}, ` +
        `trf ${before.trf}→${fd.transferred} (cascade +${cascadeQty})`
    );
    changed = true;
  }

  if (APPLY && changed) {
    await article.save();
    console.log('\n✅ Article saved');
  } else if (!changed) {
    console.log('\nNo repairs needed');
  } else {
    console.log('\nDry run complete — pass --apply to write');
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
