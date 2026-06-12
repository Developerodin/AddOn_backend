#!/usr/bin/env node
/**
 * Backfill M2 Management ledger (m2_logs OPEN entries) from existing QC floor m2Quantity.
 *
 * For each article + QC floor where floorQuantities.*.m2Quantity > 0, compares against
 * open/partial ENTRY rows in m2_logs for that article + floor. Creates one ENTRY for the gap.
 *
 * Usage:
 *   node scripts/backfill-m2-ledger-from-floor-quantities.js
 *   node scripts/backfill-m2-ledger-from-floor-quantities.js --apply
 *   node scripts/backfill-m2-ledger-from-floor-quantities.js --apply --order ORD-000025
 *   node scripts/backfill-m2-ledger-from-floor-quantities.js --apply --article A6201
 *   node scripts/backfill-m2-ledger-from-floor-quantities.js --apply --limit 50
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import { Article, ProductionOrder, M2Log, M2LogType, M2EntryStatus } from '../src/models/production/index.js';
import { recordM2Entry } from '../src/services/production/m2Management.service.js';
import { connectMongooseForScript } from './lib/mongoScriptConnect.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LIMIT_FLAG = args.indexOf('--limit');
const LIMIT = LIMIT_FLAG !== -1 ? parseInt(args[LIMIT_FLAG + 1] || '0', 10) || 0 : 0;
const ORDER_FLAG = args.indexOf('--order');
const ORDER_NUMBER = ORDER_FLAG !== -1 ? String(args[ORDER_FLAG + 1] || '').trim() : '';
const ARTICLE_FLAG = args.indexOf('--article');
const ARTICLE_NUMBER = ARTICLE_FLAG !== -1 ? String(args[ARTICLE_FLAG + 1] || '').trim() : '';

/** QC floor keys → M2 Management sourceFloor enum */
const QC_FLOOR_SPECS = [
  { key: 'checking', sourceFloor: 'Checking' },
  { key: 'secondaryChecking', sourceFloor: 'Secondary Checking' },
  { key: 'finalChecking', sourceFloor: 'Final Checking' },
];

const QTY_EPS = 0.001;

/**
 * @param {number} value
 * @returns {number}
 */
const normalizeQty = (value) => Math.round(Number(value || 0) * 1000) / 1000;

/**
 * Sum open M2 ledger qty for one article on one QC floor.
 * @param {string} articleIdStr
 * @param {string} sourceFloor
 * @returns {Promise<number>}
 */
const sumOpenLedgerForFloor = async (articleIdStr, sourceFloor) => {
  const rows = await M2Log.find({
    articleId: articleIdStr,
    sourceFloor,
    type: M2LogType.ENTRY,
    status: { $in: [M2EntryStatus.OPEN, M2EntryStatus.PARTIAL] },
  })
    .select('remainingQuantity')
    .lean();
  return normalizeQty(rows.reduce((s, r) => s + (r.remainingQuantity || 0), 0));
};

/**
 * Build Mongo filter for articles with any QC floor m2Quantity > 0.
 * @param {string|null} orderObjectId
 * @returns {object}
 */
const buildArticleQuery = (orderObjectId) => {
  const query = {
    $or: QC_FLOOR_SPECS.map(({ key }) => ({
      [`floorQuantities.${key}.m2Quantity`]: { $gt: 0 },
    })),
  };
  if (orderObjectId) query.orderId = orderObjectId;
  if (ARTICLE_NUMBER) query.articleNumber = ARTICLE_NUMBER;
  return query;
};

/**
 * @returns {Promise<void>}
 */
const run = async () => {
  const redactedUri = await connectMongooseForScript(config);
  console.log(`✅ Connected (${redactedUri})`);
  console.log(APPLY ? '🔴 APPLY mode — will create m2_logs entries' : '🟡 DRY RUN — pass --apply to write');

  let orderObjectId = null;
  if (ORDER_NUMBER) {
    const order = await ProductionOrder.findOne({ orderNumber: ORDER_NUMBER }).select('_id orderNumber').lean();
    if (!order) {
      console.error(`Order not found: ${ORDER_NUMBER}`);
      process.exit(1);
    }
    orderObjectId = order._id;
    console.log(`Filter order: ${ORDER_NUMBER}`);
  }
  if (ARTICLE_NUMBER) console.log(`Filter article: ${ARTICLE_NUMBER}`);

  const query = buildArticleQuery(orderObjectId);
  let cursor = Article.find(query).populate('orderId', 'orderNumber');
  if (LIMIT > 0) cursor = cursor.limit(LIMIT);

  const articles = await cursor.exec();
  console.log(`Found ${articles.length} article(s) with floor M2 > 0\n`);

  let wouldCreate = 0;
  let created = 0;
  let skippedSynced = 0;
  let skippedOverLedger = 0;
  let errors = 0;

  for (const article of articles) {
    const articleIdStr = article._id.toString();
    const orderNumber =
      (typeof article.orderId === 'object' && article.orderId?.orderNumber) ||
      (await ProductionOrder.findById(article.orderId).select('orderNumber').lean())?.orderNumber ||
      '';

    for (const { key, sourceFloor } of QC_FLOOR_SPECS) {
      const floorM2 = normalizeQty(article.floorQuantities?.[key]?.m2Quantity || 0);
      if (floorM2 <= QTY_EPS) continue;

      const ledgerOpen = await sumOpenLedgerForFloor(articleIdStr, sourceFloor);
      const deficit = normalizeQty(floorM2 - ledgerOpen);

      if (deficit <= QTY_EPS) {
        skippedSynced += 1;
        continue;
      }

      if (ledgerOpen > floorM2 + QTY_EPS) {
        skippedOverLedger += 1;
        console.warn(
          `⚠️  ${orderNumber} / ${article.articleNumber} @ ${sourceFloor}: floor M2=${floorM2} < ledger open=${ledgerOpen} — skip`
        );
        continue;
      }

      wouldCreate += 1;
      const line = `${orderNumber || article.orderId} | ${article.articleNumber} | ${sourceFloor} | floor=${floorM2} ledger=${ledgerOpen} → +${deficit}`;

      if (!APPLY) {
        console.log(`[dry-run] ${line}`);
        continue;
      }

      try {
        await recordM2Entry({
          article,
          sourceFloor,
          deltaQuantity: deficit,
          previousFloorTotal: ledgerOpen,
          newFloorTotal: floorM2,
          user: { id: 'm2-backfill-script', name: 'M2 backfill script', email: 'system@addon.in' },
          remarks: `Backfill from existing floor M2 (${floorM2} on ${sourceFloor}; ledger open was ${ledgerOpen})`,
        });
        created += 1;
        console.log(`✅ ${line}`);
      } catch (err) {
        errors += 1;
        console.error(`❌ ${line}`, err?.message || err);
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Articles scanned: ${articles.length}`);
  console.log(`Already synced (skip): ${skippedSynced}`);
  console.log(`Ledger > floor (skip): ${skippedOverLedger}`);
  console.log(APPLY ? `Entries created: ${created}` : `Would create: ${wouldCreate}`);
  if (errors) console.log(`Errors: ${errors}`);

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
