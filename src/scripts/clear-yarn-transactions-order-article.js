#!/usr/bin/env node

/**
 * Deletes YarnTransaction rows for ONE article on ONE production order only.
 * Other articles on the same order are untouched.
 *
 * Usage:
 *   node src/scripts/clear-yarn-transactions-order-article.js --order-id=69bcd826d795f08eb499bf54 --article-number=A5431 --dry-run
 *   node src/scripts/clear-yarn-transactions-order-article.js --order-id=69bcd826d795f08eb499bf54 --article-number=A5431
 *
 * Options:
 *   --order-id=       Production order MongoDB _id (required)
 *   --article-number= Factory / article code, e.g. A5431 (required)
 *   --dry-run         List matching docs and counts; no delete
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import { YarnTransaction } from '../models/index.js';
import Article from '../models/production/article.model.js';

function parseArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function run() {
  const orderIdStr = parseArg('order-id');
  const articleNumber = parseArg('article-number');
  const dryRun = process.argv.includes('--dry-run');

  if (!orderIdStr || !articleNumber) {
    console.error(
      'Required: --order-id=<ObjectId> --article-number=<code>  (optional: --dry-run)'
    );
    process.exit(1);
  }

  if (!mongoose.Types.ObjectId.isValid(orderIdStr)) {
    console.error('Invalid --order-id (not a valid ObjectId)');
    process.exit(1);
  }

  const orderId = new mongoose.Types.ObjectId(orderIdStr);
  const articleRe = new RegExp(`^${escapeRegex(articleNumber)}$`, 'i');

  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  const articleDoc = await Article.findOne({
    orderId,
    articleNumber: articleRe,
  })
    .select('_id articleNumber')
    .lean();

  const or = [{ articleNumber: articleRe }];
  if (articleDoc) {
    or.push({ articleId: articleDoc._id });
  }

  const query = {
    orderId,
    $or: or,
  };

  const count = await YarnTransaction.countDocuments(query);
  const sample = await YarnTransaction.find(query)
    .select('_id transactionType transactionDate yarnName articleNumber articleId orderno')
    .sort({ transactionDate: -1 })
    .limit(20)
    .lean();

  console.log(
    JSON.stringify(
      {
        orderId: orderIdStr,
        articleNumber,
        resolvedArticleId: articleDoc?._id?.toString() ?? null,
        matchCount: count,
        dryRun,
        sample,
      },
      null,
      2
    )
  );

  if (count === 0) {
    await mongoose.disconnect();
    return;
  }

  if (dryRun) {
    console.log('DRY RUN: no documents deleted.');
    await mongoose.disconnect();
    return;
  }

  const result = await YarnTransaction.deleteMany(query);
  console.log(`Deleted ${result.deletedCount} yarn transaction(s).`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
