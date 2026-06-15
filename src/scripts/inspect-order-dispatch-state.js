#!/usr/bin/env node

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

const ORDER = process.argv.find((a) => a.startsWith('--order='))?.split('=')[1] || 'ORD-000078';
const ARTICLE = process.argv.find((a) => a.startsWith('--article='))?.split('=')[1] || 'A001';
const BARCODE = process.argv.find((a) => a.startsWith('--barcode='))?.split('=')[1] || '699865138112b2ead7034081';

async function main() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  const order = await ProductionOrder.findOne({ orderNumber: ORDER }).lean();
  if (!order) {
    console.log('ORDER_NOT_FOUND', ORDER);
    process.exit(1);
  }

  const article = await Article.findOne({ orderId: order._id, articleNumber: ARTICLE }).lean();
  const container = await ContainersMaster.findOne({
    $or: [{ barcode: BARCODE }, { _id: BARCODE }],
  }).lean();

  console.log(JSON.stringify({
    order: {
      _id: order._id?.toString(),
      orderNumber: order.orderNumber,
      status: order.status,
      currentFloor: order.currentFloor,
    },
    article: article
      ? {
          _id: article._id?.toString(),
          articleNumber: article.articleNumber,
          currentFloor: article.currentFloor,
          status: article.status,
          finalChecking: article.floorQuantities?.finalChecking,
          dispatch: article.floorQuantities?.dispatch,
        }
      : null,
    container: container
      ? {
          barcode: container.barcode,
          containerName: container.containerName,
          activeFloor: container.activeFloor,
          activeItems: (container.activeItems || []).map((i) => ({
            article: i.article?.toString?.(),
            quantity: i.quantity,
          })),
        }
      : null,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
