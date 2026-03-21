#!/usr/bin/env node

/**
 * List YarnTransaction rows for product / article factory codes (factoryCode === articleNumber).
 *
 * Usage:
 *   node src/scripts/yarn-transactions-by-article.js A5431
 *   node src/scripts/yarn-transactions-by-article.js A5431 A135
 *   node src/scripts/yarn-transactions-by-article.js A5431 --json
 *
 * API equivalent (when server is up):
 *   GET /v1/yarn/transactions?article_number=A5431
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import { YarnTransaction, Article } from '../models/index.js';

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const factoryCodes = args.filter((a) => !a.startsWith('--'));

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function buildQueryForFactoryCode(factoryCode) {
  const codeRe = new RegExp(`^${escapeRegex(factoryCode)}$`, 'i');
  const or = [{ articleNumber: codeRe }];

  const article = await Article.findOne({ articleNumber: factoryCode }).select('_id').lean();
  if (article) {
    or.push({ articleId: article._id });
  }

  return { $or: or };
}

async function run() {
  if (!factoryCodes.length) {
    console.error('Usage: node src/scripts/yarn-transactions-by-article.js <factoryCode> [factoryCode...] [--json]');
    console.error('  --json   print raw JSON');
    process.exit(1);
  }

  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  for (const code of factoryCodes) {
    const query = await buildQueryForFactoryCode(code);
    const transactions = await YarnTransaction.find(query)
      .populate({ path: 'yarnCatalogId', select: 'yarnName yarnType' })
      .populate({ path: 'orderId', select: 'orderNumber' })
      .populate({ path: 'articleId', select: 'articleNumber orderId' })
      .sort({ transactionDate: -1 })
      .lean();

    if (jsonOutput) {
      console.log(JSON.stringify({ factoryCode: code, count: transactions.length, transactions }, null, 2));
      continue;
    }

    console.log(`\n=== ${code} (${transactions.length} transactions) ===`);
    for (const t of transactions) {
      const date = t.transactionDate ? new Date(t.transactionDate).toISOString() : '';
      const orderNo = t.orderno || t.orderId?.orderNumber || '-';
      const yn = t.yarnName || t.yarnCatalogId?.yarnName || '-';
      console.log(
        `${date}\t${t.transactionType}\t${yn}\torder=${orderNo}\tarticleNumber=${t.articleNumber || '-'}`
      );
    }
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
