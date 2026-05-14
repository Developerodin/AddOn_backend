#!/usr/bin/env node

/**
 * Simulate the two endpoints used when building cones per PO (same service layer as HTTP):
 *
 * A) GET /v1/yarn-management/yarn-transactions/yarn-issued-by-order/:orderno
 * B) GET /v1/yarn-management/yarn-transactions?order_id=<ProductionOrder._id>
 *
 * Prints whether any `yarn_returned` rows appear (and how many), so you can match DB/script output.
 *
 * Usage:
 *   npx cross-env NODE_ENV=development node src/scripts/check-returned-txns-in-order-apis.js ORD-000053
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import '../models/yarnReq/yarnCone.model.js';
import { ProductionOrder } from '../models/production/index.js';
import * as yarnTransactionService from '../services/yarnManagement/yarnTransaction.service.js';

const orderNoArg = process.argv[2]?.trim();
const orderNumber = orderNoArg || 'ORD-000053';

/** @param {unknown} body */
function countReturnedNested(body, pathLabel) {
  let total = 0;
  /** @type {string[]} */
  const ids = [];

  const walkTxn = (t) => {
    if (!t || typeof t !== 'object') return;
    const ty = /** @type {{ transactionType?: string }} */ (t).transactionType;
    const id = /** @type {{ _id?: unknown }} */ (t)._id;
    if (String(ty) === 'yarn_returned') {
      total += 1;
      if (id != null) ids.push(String(id));
    }
  };

  if (Array.isArray(body)) {
    for (const group of body) {
      const txs =
        /** @type {{ transactions?: unknown[] }} */ (group).transactions ??
        /** @type {{ transactions?: unknown[] }} */ (group);
      if (!Array.isArray(txs)) continue;
      for (const t of txs) walkTxn(t);
    }
  }

  console.log(`${pathLabel}: yarn_returned count = ${total}${total ? ` (ids: ${ids.join(', ')})` : ''}`);
  return total;
}

async function main() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  const order = await ProductionOrder.findOne({ orderNumber: orderNumber })
    .select('_id orderNumber')
    .lean();
  if (!order) {
    console.error(`ProductionOrder not found: ${orderNumber}`);
    process.exit(1);
  }

  console.log(`\nOrder: ${order.orderNumber}  order_id: ${String(order._id)}\n`);

  // --- Same as GET yarn-issued-by-order/:orderno (default controller options) ---
  const issuedOnly = await yarnTransactionService.getYarnIssuedByOrder(orderNumber, false, {});
  countReturnedNested(issuedOnly, 'API A yarn-issued-by-order (DEFAULT, no query flags)');
  const issuedWithReturns = await yarnTransactionService.getYarnIssuedByOrder(orderNumber, false, {
    includeReturns: true,
  });
  countReturnedNested(issuedWithReturns, 'API A yarn-issued-by-order (?include_returns=true)');

  // --- Same as GET yarn-transactions?order_id= + default group_by=article ---
  const txs = await yarnTransactionService.queryYarnTransactions({
    order_id: String(order._id),
  });
  const grouped = await yarnTransactionService.groupTransactionsByArticle(txs, {
    orderId: String(order._id),
    orderno: orderNumber,
  });
  countReturnedNested(grouped, 'API B yarn-transactions?order_id (grouped by article, default)');
}

main()
  .catch((e) => {
    console.error(e?.stack || e?.message || String(e));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      /* ignore */
    }
  });
