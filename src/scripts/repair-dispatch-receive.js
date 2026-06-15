#!/usr/bin/env node

/**
 * Apply missing Dispatch receive when container was cleared but article dispatch.received stayed 0.
 *
 * Usage:
 *   node src/scripts/repair-dispatch-receive.js --order=ORD-000078 --article=A001
 *   node src/scripts/repair-dispatch-receive.js --write --order=ORD-000078 --article=A001
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
import Article from '../models/production/article.model.js';
import ProductionOrder from '../models/production/productionOrder.model.js';
import ContainersMaster from '../models/production/containersMaster.model.js';
import * as articleService from '../services/production/article.service.js';

const WRITE = process.argv.includes('--write');

function argValue(flag) {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1).trim() : undefined;
}

const ORDER = argValue('--order') || 'ORD-000078';
const ARTICLE = argValue('--article') || 'A001';
const BARCODE = argValue('--barcode') || '699865138112b2ead7034081';

function pendingDispatchQty(article) {
  const fc = article.floorQuantities?.finalChecking;
  const fcTransferred = Number(fc?.m1Transferred ?? fc?.transferred ?? 0);
  const dispatchReceived = Number(article.floorQuantities?.dispatch?.received ?? 0);
  return Math.max(0, fcTransferred - dispatchReceived);
}

async function main() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  const order = await ProductionOrder.findOne({ orderNumber: ORDER });
  if (!order) throw new Error(`Order not found: ${ORDER}`);

  const article = await Article.findOne({ orderId: order._id, articleNumber: ARTICLE });
  if (!article) throw new Error(`Article not found: ${ARTICLE}`);

  const qty = pendingDispatchQty(article);
  if (qty <= 0) {
    throw new Error('No pending dispatch receive — already received or nothing transferred from Final Checking');
  }

  const container = await ContainersMaster.findOne({
    $or: [{ barcode: BARCODE }, { _id: BARCODE }],
  });

  console.log('--- repair-dispatch-receive ---');
  console.log('mode:', WRITE ? 'WRITE' : 'DRY-RUN');
  console.log('order:', ORDER, 'article:', ARTICLE, 'qty:', qty);
  console.log('before dispatch:', JSON.stringify(article.floorQuantities?.dispatch, null, 2));

  if (WRITE) {
    await articleService.updateArticleFloorReceivedData(article._id.toString(), {
      floor: 'Dispatch',
      quantity: qty,
      receivedData: {
        receivedStatusFromPreviousFloor: 'Completed',
        receivedInContainerId: container?._id ?? null,
        receivedTimestamp: new Date(),
      },
    });
    const fresh = await Article.findById(article._id).lean();
    console.log('after dispatch:', JSON.stringify(fresh?.floorQuantities?.dispatch, null, 2));
    console.log('article.currentFloor:', fresh?.currentFloor);
  } else {
    console.log('Dry run only. Re-run with --write to apply.');
  }

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e.message || e);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
