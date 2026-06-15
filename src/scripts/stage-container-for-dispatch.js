#!/usr/bin/env node

/**
 * Stage a factory container for Dispatch accept (recovery when bag is empty but FC transfer exists).
 *
 * Usage:
 *   node src/scripts/stage-container-for-dispatch.js --barcode=699865138112b2ead7034081 --order=ORD-000078 --article=A001
 *   node src/scripts/stage-container-for-dispatch.js --write --barcode=... --order=... --article=...
 *
 * Default is dry-run. Pass --write to persist.
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
import ContainersMaster from '../models/production/containersMaster.model.js';
import Article from '../models/production/article.model.js';
import ProductionOrder from '../models/production/productionOrder.model.js';

const WRITE = process.argv.includes('--write');

/**
 * @param {string} flag
 * @returns {string|undefined}
 */
function argValue(flag) {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1).trim() : undefined;
}

const BARCODE = argValue('--barcode') || '699865138112b2ead7034081';
const ORDER_NUMBER = argValue('--order') || 'ORD-000078';
const ARTICLE_NUMBER = argValue('--article') || 'A001';
const ACTIVE_FLOOR = argValue('--floor') || 'Dispatch';

/**
 * Pending qty transferred from Final Checking not yet received on Dispatch.
 * @param {import('../models/production/article.model.js').default} article
 * @returns {number}
 */
function pendingDispatchHandoffQty(article) {
  const fc = article.floorQuantities?.finalChecking;
  const fcTransferred = Number(fc?.m1Transferred ?? fc?.transferred ?? 0);
  const dispatchReceived = Number(article.floorQuantities?.dispatch?.received ?? 0);
  return Math.max(0, fcTransferred - dispatchReceived);
}

async function main() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  const order = await ProductionOrder.findOne({ orderNumber: ORDER_NUMBER }).select('_id orderNumber');
  if (!order) {
    throw new Error(`Order not found: ${ORDER_NUMBER}`);
  }

  const article = await Article.findOne({
    orderId: order._id,
    articleNumber: ARTICLE_NUMBER,
  });
  if (!article) {
    throw new Error(`Article not found: ${ARTICLE_NUMBER} on ${ORDER_NUMBER}`);
  }

  const qty = pendingDispatchHandoffQty(article);
  if (qty <= 0) {
    const fc = article.floorQuantities?.finalChecking;
    const dispatch = article.floorQuantities?.dispatch;
    throw new Error(
      `No pending handoff (fc m1Transferred=${fc?.m1Transferred ?? fc?.transferred ?? 0}, dispatch received=${dispatch?.received ?? 0})`
    );
  }

  const container = await ContainersMaster.findOne({
    $or: [{ barcode: BARCODE }, { _id: BARCODE }],
  });
  if (!container) {
    throw new Error(`Container not found for barcode ${BARCODE}`);
  }

  const before = {
    containerName: container.containerName,
    barcode: container.barcode,
    activeFloor: container.activeFloor,
    activeItems: (container.activeItems || []).map((i) => ({
      article: i.article?.toString?.() ?? i.article,
      quantity: i.quantity,
    })),
  };

  const after = {
    activeFloor: ACTIVE_FLOOR,
    activeItems: [{ article: article._id, quantity: qty }],
  };

  console.log('--- stage-container-for-dispatch ---');
  console.log('mode:', WRITE ? 'WRITE' : 'DRY-RUN');
  console.log('order:', ORDER_NUMBER, 'article:', ARTICLE_NUMBER, 'id:', article._id.toString());
  console.log('container:', container.containerName || container.barcode, 'barcode:', container.barcode);
  console.log('before:', JSON.stringify(before, null, 2));
  console.log('after:', JSON.stringify({ ...after, activeItems: [{ article: article._id.toString(), quantity: qty }] }, null, 2));

  if (WRITE) {
    container.activeFloor = ACTIVE_FLOOR;
    container.activeItems = after.activeItems;
    container.activeArticle = undefined;
    await container.save();
    const verify = await ContainersMaster.findById(container._id).lean();
    console.log('saved:', JSON.stringify({
      activeFloor: verify.activeFloor,
      activeItems: (verify.activeItems || []).map((i) => ({
        article: i.article?.toString?.(),
        quantity: i.quantity,
      })),
    }, null, 2));
  } else {
    console.log('Dry run only. Re-run with --write to apply.');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
