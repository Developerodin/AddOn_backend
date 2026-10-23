#!/usr/bin/env node
/**
 * Stamp article onto yarn_issued rows and cones that were issued from the All grid
 * (order + machine saved, article left empty).
 *
 * Only updates a row when articleId is still empty, the order matches, and the cone
 * is still issued. Does not overwrite an article that is already set.
 *
 * Usage (cwd = AddOn_backend, so .env MONGODB_URL is the database you mean):
 *   NODE_ENV=development node src/scripts/backfill-blank-article-yarn-issues.js
 *   NODE_ENV=development node src/scripts/backfill-blank-article-yarn-issues.js --apply
 *   NODE_ENV=production node src/scripts/backfill-blank-article-yarn-issues.js --apply
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import YarnCone from '../models/yarnReq/yarnCone.model.js';
import YarnTransaction from '../models/yarnReq/yarnTransaction.model.js';
import Article from '../models/production/article.model.js';

/** @type {{ orderId: string, machineId: string, articleId: string, articleNumber: string, barcodes: string[] }[]} */
const FIXES = [
  {
    orderId: '6aa276ae3420f75b1a8d4687',
    machineId: '6943e19d75f1ed1d469e144d',
    articleId: '6aa276ae3420f75b1a8d4686',
    articleNumber: 'A132',
    barcodes: [
      '6aa4e662675e9f6bf5995170',
      '6aa4e662675e9f6bf5995175',
      '6aa4eeafb028e87bcbeed355',
      '6aa4e662675e9f6bf599516e',
      '6aa4e662675e9f6bf5995178',
      '6aa4e662675e9f6bf599517b',
    ],
  },
  {
    orderId: '6ab36654274dd42d5888a12b',
    machineId: '6943e19d75f1ed1d469e1437',
    articleId: '6ab49e6c1a302d40ca63df9c',
    articleNumber: 'A572',
    barcodes: [
      '6ac9cdf1afaf1961e300023c',
      '6acdd4f3b4d014e0ba7373e2',
      '6acdd492b4d014e0ba736f9f',
    ],
  },
];

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isBlankArticle(value) {
  return value == null || String(value).trim() === '';
}

/**
 * Mongoose 5/6 update results use either matchedCount or n.
 * @param {{ matchedCount?: number, n?: number }} result
 * @returns {boolean}
 */
function updateMatched(result) {
  const matched = result?.matchedCount ?? result?.n ?? 0;
  return matched >= 1;
}

/**
 * Confirm the target article still belongs to this production order.
 * @param {{ orderId: string, articleId: string, articleNumber: string }} fix
 * @returns {Promise<void>}
 */
async function assertArticle(fix) {
  const article = await Article.findOne({
    _id: new mongoose.Types.ObjectId(fix.articleId),
    orderId: new mongoose.Types.ObjectId(fix.orderId),
  })
    .select('articleNumber orderId')
    .lean();
  if (!article) {
    throw new Error(`Article ${fix.articleNumber} (${fix.articleId}) is not on order ${fix.orderId}`);
  }
  if (String(article.articleNumber).trim() !== fix.articleNumber) {
    throw new Error(
      `Article ${fix.articleId} is ${article.articleNumber}, expected ${fix.articleNumber}`
    );
  }
}

/**
 * Plan or apply one cone plus its blank yarn_issued transaction.
 * @param {{ orderId: string, machineId: string, articleId: string, articleNumber: string }} fix
 * @param {string} barcode
 * @param {boolean} apply
 * @returns {Promise<{ barcode: string, status: string, detail?: string }>}
 */
async function repairCone(fix, barcode, apply) {
  const cone = await YarnCone.findOne({ barcode }).select('_id barcode orderId articleId issueStatus').lean();
  if (!cone) return { barcode, status: 'missing-cone' };
  if (String(cone.orderId || '') !== fix.orderId) {
    return { barcode, status: 'skipped', detail: `cone order ${cone.orderId} != ${fix.orderId}` };
  }
  if (String(cone.issueStatus) !== 'issued') {
    return { barcode, status: 'skipped', detail: `issueStatus ${cone.issueStatus}` };
  }
  if (!isBlankArticle(cone.articleId) && String(cone.articleId) !== fix.articleId) {
    return { barcode, status: 'skipped', detail: `cone already on article ${cone.articleId}` };
  }

  const txns = await YarnTransaction.find({
    transactionType: 'yarn_issued',
    conesIdsArray: cone._id,
    orderId: new mongoose.Types.ObjectId(fix.orderId),
  })
    .select('_id articleId articleNumber machineId')
    .lean();

  if (txns.length !== 1) {
    return { barcode, status: 'skipped', detail: `expected 1 yarn_issued, found ${txns.length}` };
  }
  const txn = txns[0];
  if (String(txn.machineId || '') !== fix.machineId) {
    return { barcode, status: 'skipped', detail: `txn machine ${txn.machineId} != ${fix.machineId}` };
  }
  if (!isBlankArticle(txn.articleId) && String(txn.articleId) !== fix.articleId) {
    return { barcode, status: 'skipped', detail: `txn already on article ${txn.articleId}` };
  }

  const coneNeeds = isBlankArticle(cone.articleId);
  const txnNeeds = isBlankArticle(txn.articleId) || isBlankArticle(txn.articleNumber);
  if (!coneNeeds && !txnNeeds) {
    return { barcode, status: 'already-set', detail: fix.articleNumber };
  }
  if (!apply) {
    return { barcode, status: 'would-update', detail: `${fix.articleNumber} txn ${txn._id}` };
  }

  if (txnNeeds) {
    const txnResult = await YarnTransaction.updateOne(
      {
        _id: txn._id,
        transactionType: 'yarn_issued',
        orderId: new mongoose.Types.ObjectId(fix.orderId),
        machineId: new mongoose.Types.ObjectId(fix.machineId),
        $or: [{ articleId: null }, { articleId: { $exists: false } }, { articleNumber: null }, { articleNumber: '' }, { articleNumber: { $exists: false } }],
      },
      { $set: { articleId: new mongoose.Types.ObjectId(fix.articleId), articleNumber: fix.articleNumber } }
    );
    if (!updateMatched(txnResult)) {
      return { barcode, status: 'txn-not-updated', detail: String(txn._id) };
    }
  }
  if (coneNeeds) {
    const coneResult = await YarnCone.updateOne(
      {
        _id: cone._id,
        orderId: new mongoose.Types.ObjectId(fix.orderId),
        issueStatus: 'issued',
        $or: [{ articleId: null }, { articleId: { $exists: false } }],
      },
      { $set: { articleId: new mongoose.Types.ObjectId(fix.articleId) } }
    );
    if (!updateMatched(coneResult)) {
      return { barcode, status: 'cone-not-updated', detail: String(cone._id) };
    }
  }
  return { barcode, status: 'updated', detail: fix.articleNumber };
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  console.log(apply ? 'APPLY' : 'DRY RUN');

  for (const fix of FIXES) {
    await assertArticle(fix);
    console.log(`\n${fix.articleNumber} order ${fix.orderId}`);
    for (const barcode of fix.barcodes) {
      const row = await repairCone(fix, barcode, apply);
      console.log(`  ${row.status}  ${row.barcode}  ${row.detail || ''}`);
    }
  }

  if (!apply) console.log('\nDry run only. Re-run with --apply to write.');
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  try {
    await mongoose.disconnect();
  } catch (disconnectError) {
    console.error(disconnectError instanceof Error ? disconnectError.message : disconnectError);
  }
  process.exit(1);
});
