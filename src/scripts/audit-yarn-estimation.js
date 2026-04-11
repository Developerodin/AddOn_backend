#!/usr/bin/env node

/**
 * Audit yarn estimation data across all (or specific) production orders.
 *
 * Checks for:
 *  1. Transactions missing articleId AND articleNumber (untagged)
 *  2. Articles where returned > 0 but issued = 0 for a yarn (phantom returns)
 *  3. Yarn shared across multiple articles' BOMs in the same order (ambiguous matching)
 *  4. Transactions whose articleNumber doesn't match any article in the order
 *
 * Usage:
 *   node src/scripts/audit-yarn-estimation.js                   # audit ALL orders
 *   node src/scripts/audit-yarn-estimation.js ORD-000005        # audit specific order
 *   node src/scripts/audit-yarn-estimation.js ORD-000005 --json # raw JSON output
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import { YarnTransaction } from '../models/index.js';
import { ProductionOrder, Article } from '../models/production/index.js';
import Product from '../models/product.model.js';

const args = process.argv.slice(2);
const jsonFlag = args.includes('--json');
const orderNumbers = args.filter((a) => !a.startsWith('--'));

async function auditOrder(order) {
  const issues = [];

  const articles = await Article.find({ orderId: order._id })
    .select('articleNumber plannedQuantity status')
    .lean();

  if (!articles.length) {
    issues.push({ type: 'NO_ARTICLES', message: 'Order has no articles' });
    return { orderId: order._id, orderNumber: order.orderNumber, articleCount: 0, issues };
  }

  // Load all transactions for this order
  const transactions = await YarnTransaction.find({
    orderId: order._id,
    transactionType: { $in: ['yarn_issued', 'yarn_returned'] },
  })
    .select('transactionType yarnCatalogId yarnName articleId articleNumber transactionTotalWeight transactionNetWeight transactionConeCount')
    .lean();

  // --- Check 1: Untagged transactions ---
  const untagged = transactions.filter(
    (t) => !t.articleId && (!t.articleNumber || t.articleNumber.trim() === '')
  );
  if (untagged.length > 0) {
    const byType = {};
    for (const t of untagged) {
      byType[t.transactionType] = (byType[t.transactionType] || 0) + 1;
    }
    issues.push({
      type: 'UNTAGGED_TRANSACTIONS',
      count: untagged.length,
      breakdown: byType,
      message: `${untagged.length} transaction(s) have no articleId and no articleNumber`,
    });
  }

  // --- Check 2: Transactions with articleNumber not matching any order article ---
  const articleNumberSet = new Set(articles.map((a) => a.articleNumber));
  const orphaned = transactions.filter(
    (t) => t.articleNumber && t.articleNumber.trim() !== '' && !articleNumberSet.has(t.articleNumber)
  );
  if (orphaned.length > 0) {
    const orphanedNumbers = [...new Set(orphaned.map((t) => t.articleNumber))];
    issues.push({
      type: 'ORPHANED_ARTICLE_NUMBERS',
      count: orphaned.length,
      articleNumbers: orphanedNumbers,
      message: `${orphaned.length} transaction(s) reference articleNumbers not in this order: ${orphanedNumbers.join(', ')}`,
    });
  }

  // --- Check 3: Yarn shared across multiple articles' BOMs ---
  const factoryCodes = [...new Set(articles.map((a) => a.articleNumber).filter(Boolean))];
  const products = await Product.find({ factoryCode: { $in: factoryCodes } })
    .select('bom factoryCode')
    .lean();

  const productMap = new Map();
  for (const p of products) productMap.set(p.factoryCode, p);

  // yarnCatalogId → [articleNumbers] from BOM
  const yarnToArticles = new Map();
  for (const art of articles) {
    const product = productMap.get(art.articleNumber);
    if (!product?.bom) continue;
    for (const bomItem of product.bom) {
      const catId = (bomItem.yarnCatalogId || '').toString();
      if (!catId) continue;
      if (!yarnToArticles.has(catId)) yarnToArticles.set(catId, new Set());
      yarnToArticles.get(catId).add(art.articleNumber);
    }
  }

  const sharedYarns = [];
  for (const [catId, artSet] of yarnToArticles.entries()) {
    if (artSet.size > 1) {
      sharedYarns.push({ yarnCatalogId: catId, articles: [...artSet] });
    }
  }
  if (sharedYarns.length > 0) {
    issues.push({
      type: 'SHARED_BOM_YARNS',
      count: sharedYarns.length,
      yarns: sharedYarns,
      message: `${sharedYarns.length} yarn(s) appear in multiple articles' BOMs — untagged transactions for these yarns cannot be reliably attributed`,
    });
  }

  // --- Check 4: Per-article phantom returns (returned > 0, issued = 0 for a yarn) ---
  // Build per-article per-yarn summary from TAGGED transactions only
  const articleYarnStats = new Map(); // articleNumber → Map<yarnCatalogId, { issued, returned }>

  for (const t of transactions) {
    const artNum = t.articleNumber;
    if (!artNum || artNum.trim() === '') continue;

    if (!articleYarnStats.has(artNum)) articleYarnStats.set(artNum, new Map());
    const yarnMap = articleYarnStats.get(artNum);
    const catId = (t.yarnCatalogId || '').toString();
    if (!catId) continue;

    if (!yarnMap.has(catId)) yarnMap.set(catId, { yarnName: t.yarnName, issued: 0, returned: 0 });
    const entry = yarnMap.get(catId);

    if (t.transactionType === 'yarn_issued') {
      entry.issued += t.transactionNetWeight || 0;
    } else {
      entry.returned += t.transactionNetWeight || 0;
    }
  }

  const phantomReturns = [];
  for (const [artNum, yarnMap] of articleYarnStats.entries()) {
    for (const [catId, stats] of yarnMap.entries()) {
      if (stats.returned > 0 && stats.issued === 0) {
        phantomReturns.push({
          articleNumber: artNum,
          yarnCatalogId: catId,
          yarnName: stats.yarnName,
          returnedNetWeight: stats.returned,
        });
      }
    }
  }

  if (phantomReturns.length > 0) {
    issues.push({
      type: 'PHANTOM_RETURNS',
      count: phantomReturns.length,
      items: phantomReturns,
      message: `${phantomReturns.length} article-yarn pair(s) have returns but ZERO issues`,
    });
  }

  // --- Summary stats ---
  const totalIssued = transactions.filter((t) => t.transactionType === 'yarn_issued').length;
  const totalReturned = transactions.filter((t) => t.transactionType === 'yarn_returned').length;
  const taggedIssued = transactions.filter(
    (t) => t.transactionType === 'yarn_issued' && (t.articleId || (t.articleNumber && t.articleNumber.trim() !== ''))
  ).length;
  const taggedReturned = transactions.filter(
    (t) => t.transactionType === 'yarn_returned' && (t.articleId || (t.articleNumber && t.articleNumber.trim() !== ''))
  ).length;

  return {
    orderId: order._id,
    orderNumber: order.orderNumber,
    status: order.status,
    articleCount: articles.length,
    transactionStats: {
      total: transactions.length,
      issued: { total: totalIssued, tagged: taggedIssued, untagged: totalIssued - taggedIssued },
      returned: { total: totalReturned, tagged: taggedReturned, untagged: totalReturned - taggedReturned },
    },
    sharedBomYarns: sharedYarns.length,
    phantomReturns: phantomReturns.length,
    issues,
  };
}

async function run() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  let orders;
  if (orderNumbers.length > 0) {
    orders = await ProductionOrder.find({ orderNumber: { $in: orderNumbers } })
      .select('orderNumber status')
      .lean();
    if (!orders.length) {
      console.error(`No orders found matching: ${orderNumbers.join(', ')}`);
      process.exit(1);
    }
  } else {
    orders = await ProductionOrder.find({})
      .select('orderNumber status')
      .sort({ createdAt: -1 })
      .lean();
  }

  console.log(`Auditing ${orders.length} order(s)...\n`);

  const allResults = [];
  let totalIssuesFound = 0;

  for (const order of orders) {
    const result = await auditOrder(order);
    allResults.push(result);

    if (result.issues.length > 0) {
      totalIssuesFound += result.issues.length;

      if (!jsonFlag) {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`ORDER: ${result.orderNumber} (${result.status}) — ${result.articleCount} articles`);
        console.log(`Transactions: ${result.transactionStats.total} total`);
        console.log(`  Issued:   ${result.transactionStats.issued.total} (tagged: ${result.transactionStats.issued.tagged}, untagged: ${result.transactionStats.issued.untagged})`);
        console.log(`  Returned: ${result.transactionStats.returned.total} (tagged: ${result.transactionStats.returned.tagged}, untagged: ${result.transactionStats.returned.untagged})`);
        console.log(`  Shared BOM yarns: ${result.sharedBomYarns} | Phantom returns: ${result.phantomReturns}`);

        for (const issue of result.issues) {
          console.log(`\n  ⚠ [${issue.type}] ${issue.message}`);
          if (issue.type === 'PHANTOM_RETURNS') {
            for (const item of issue.items) {
              console.log(`      ${item.articleNumber} — ${item.yarnName} — returned ${item.returnedNetWeight.toFixed(3)} kg net (0 issued)`);
            }
          }
          if (issue.type === 'SHARED_BOM_YARNS') {
            for (const yarn of issue.yarns) {
              console.log(`      ${yarn.yarnCatalogId} → [${yarn.articles.join(', ')}]`);
            }
          }
        }
      }
    }
  }

  if (jsonFlag) {
    console.log(JSON.stringify({ ordersAudited: orders.length, totalIssuesFound, results: allResults }, null, 2));
  } else {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`AUDIT COMPLETE: ${orders.length} order(s) scanned, ${totalIssuesFound} issue(s) found`);

    const withUntagged = allResults.filter((r) => r.transactionStats.returned.untagged > 0);
    const withPhantom = allResults.filter((r) => r.phantomReturns > 0);
    const withShared = allResults.filter((r) => r.sharedBomYarns > 0);
    console.log(`  Orders with untagged returns:  ${withUntagged.length}`);
    console.log(`  Orders with phantom returns:   ${withPhantom.length}`);
    console.log(`  Orders with shared BOM yarns:  ${withShared.length}`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
