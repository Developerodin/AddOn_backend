#!/usr/bin/env node

/**
 * Fixes YarnTransaction and YarnCone records after an order is recreated.
 *
 * When a production order's yarn is deleted and the order is recreated with the
 * same orderNumber, this script re-points existing transactions and issued cones
 * from the OLD order _id to the NEW order _id, matching articles by articleNumber.
 *
 * Usage:
 *   node src/scripts/fix-transaction-order-id.js --orderno=ORD-000003 --dry-run
 *   node src/scripts/fix-transaction-order-id.js --orderno=ORD-000003
 *
 * Options:
 *   --orderno=X   (required) The order number to fix (e.g. ORD-000003)
 *   --dry-run     Preview changes without writing to the database
 */

import mongoose from 'mongoose';
import { YarnTransaction, YarnCone } from '../models/index.js';
import { ProductionOrder, Article } from '../models/production/index.js';
import config from '../config/config.js';
import logger from '../config/logger.js';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const ordernoArg = args.find((a) => a.startsWith('--orderno='));
const orderno = ordernoArg ? ordernoArg.split('=')[1]?.trim() : null;

if (!orderno) {
  logger.error('Missing required --orderno=<ORDER_NUMBER> argument.');
  logger.info('Example: node src/scripts/fix-transaction-order-id.js --orderno=ORD-000003 --dry-run');
  process.exit(1);
}

async function run() {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);

    if (isDryRun) {
      logger.info('========================================');
      logger.info('  DRY RUN – no writes will be performed');
      logger.info('========================================');
    }

    // ------------------------------------------------------------------ //
    // 1. Find the CURRENT (new) production order by orderNumber
    // ------------------------------------------------------------------ //
    const newOrder = await ProductionOrder.findOne({ orderNumber: orderno }).lean();
    if (!newOrder) {
      logger.error(`No production order found with orderNumber "${orderno}". Nothing to fix.`);
      return;
    }
    const newOrderId = newOrder._id;
    logger.info(`Found current order: ${orderno} → _id = ${newOrderId}`);

    // ------------------------------------------------------------------ //
    // 2. Load the articles belonging to the NEW order
    // ------------------------------------------------------------------ //
    const newArticles = await Article.find({ orderId: newOrderId }).lean();
    logger.info(`New order has ${newArticles.length} article(s):`);
    const articleMap = new Map();
    for (const art of newArticles) {
      articleMap.set(art.articleNumber, art._id);
      logger.info(`  • ${art.articleNumber} → _id = ${art._id}`);
    }

    // ------------------------------------------------------------------ //
    // 3. Find all YarnTransactions for this orderno that still point to an
    //    OLD orderId (i.e. orderId !== newOrderId)
    // ------------------------------------------------------------------ //
    const staleTransactions = await YarnTransaction.find({
      orderno: orderno,
      orderId: { $ne: newOrderId, $exists: true },
    }).lean();

    logger.info(`\nFound ${staleTransactions.length} transaction(s) with stale orderId for "${orderno}".`);

    const oldOrderIds = new Set();
    for (const tx of staleTransactions) {
      if (tx.orderId) oldOrderIds.add(tx.orderId.toString());
    }
    if (oldOrderIds.size > 0) {
      logger.info(`Old orderId(s) detected: ${[...oldOrderIds].join(', ')}`);
    }

    // ------------------------------------------------------------------ //
    // 4. Find all YarnCones issued to the OLD orderId(s)
    // ------------------------------------------------------------------ //
    const oldOrderIdArray = [...oldOrderIds].map((id) => new mongoose.Types.ObjectId(id));
    let staleCones = [];
    if (oldOrderIdArray.length > 0) {
      staleCones = await YarnCone.find({
        orderId: { $in: oldOrderIdArray },
      }).lean();
    }
    logger.info(`Found ${staleCones.length} cone(s) still linked to old orderId(s).`);

    // ------------------------------------------------------------------ //
    // 5. Preview / apply transaction updates
    // ------------------------------------------------------------------ //
    logger.info('\n──── YARN TRANSACTIONS ─────────────────────────────────');
    let txUpdated = 0;
    let txArticleMatched = 0;
    let txArticleUnmatched = 0;

    for (const tx of staleTransactions) {
      const updateFields = { orderId: newOrderId };

      let articleMatch = 'N/A';
      if (tx.articleNumber && articleMap.has(tx.articleNumber)) {
        updateFields.articleId = articleMap.get(tx.articleNumber);
        articleMatch = `${tx.articleNumber} → ${updateFields.articleId}`;
        txArticleMatched++;
      } else if (tx.articleNumber) {
        articleMatch = `${tx.articleNumber} → NO MATCH in new order`;
        txArticleUnmatched++;
      }

      logger.info(
        `  TX ${tx._id} | type=${tx.transactionType} | yarn=${tx.yarnName} | ` +
          `oldOrderId=${tx.orderId} → newOrderId=${newOrderId} | article: ${articleMatch}`
      );

      if (!isDryRun) {
        await YarnTransaction.updateOne({ _id: tx._id }, { $set: updateFields });
      }
      txUpdated++;
    }

    logger.info(`\nTransactions processed: ${txUpdated}`);
    logger.info(`  Articles matched:    ${txArticleMatched}`);
    logger.info(`  Articles unmatched:  ${txArticleUnmatched}`);

    // ------------------------------------------------------------------ //
    // 6. Preview / apply cone updates
    // ------------------------------------------------------------------ //
    logger.info('\n──── YARN CONES ────────────────────────────────────────');
    let coneUpdated = 0;
    let coneArticleMatched = 0;
    let coneArticleUnmatched = 0;

    for (const cone of staleCones) {
      const updateFields = { orderId: newOrderId };

      let articleMatch = 'N/A';
      // Cones don't have articleNumber directly, but they have articleId.
      // Try to match via the old articleId → find the article's articleNumber →
      // then map to the new articleId.
      if (cone.articleId) {
        const oldArticle = await Article.findById(cone.articleId).lean();
        if (oldArticle && oldArticle.articleNumber && articleMap.has(oldArticle.articleNumber)) {
          updateFields.articleId = articleMap.get(oldArticle.articleNumber);
          articleMatch = `${oldArticle.articleNumber} → ${updateFields.articleId}`;
          coneArticleMatched++;
        } else if (oldArticle) {
          articleMatch = `${oldArticle.articleNumber} → NO MATCH in new order`;
          coneArticleUnmatched++;
        } else {
          // Old article document may already be deleted; try to match via
          // transaction records that share the same cone
          const relatedTx = staleTransactions.find(
            (t) => t.conesIdsArray && t.conesIdsArray.some((cid) => cid.toString() === cone._id.toString())
          );
          if (relatedTx && relatedTx.articleNumber && articleMap.has(relatedTx.articleNumber)) {
            updateFields.articleId = articleMap.get(relatedTx.articleNumber);
            articleMatch = `(via tx) ${relatedTx.articleNumber} → ${updateFields.articleId}`;
            coneArticleMatched++;
          } else {
            articleMatch = 'OLD ARTICLE NOT FOUND, no match';
            coneArticleUnmatched++;
          }
        }
      }

      logger.info(
        `  Cone ${cone._id} | barcode=${cone.barcode || '-'} | yarn=${cone.yarnName || '-'} | ` +
          `oldOrderId=${cone.orderId} → newOrderId=${newOrderId} | article: ${articleMatch}`
      );

      if (!isDryRun) {
        await YarnCone.updateOne({ _id: cone._id }, { $set: updateFields });
      }
      coneUpdated++;
    }

    logger.info(`\nCones processed: ${coneUpdated}`);
    logger.info(`  Articles matched:    ${coneArticleMatched}`);
    logger.info(`  Articles unmatched:  ${coneArticleUnmatched}`);

    // ------------------------------------------------------------------ //
    // 7. Summary
    // ------------------------------------------------------------------ //
    logger.info('\n══════════════════════════════════════════════════════');
    logger.info(`  Order:        ${orderno}`);
    logger.info(`  New Order _id: ${newOrderId}`);
    logger.info(`  Transactions:  ${txUpdated} updated`);
    logger.info(`  Cones:         ${coneUpdated} updated`);
    logger.info(`  Mode:          ${isDryRun ? 'DRY RUN (no changes written)' : 'LIVE (changes committed)'}`);
    logger.info('══════════════════════════════════════════════════════');
    logger.info('Done.');
  } catch (error) {
    logger.error('Script failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
