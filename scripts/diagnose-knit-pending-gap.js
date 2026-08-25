/**
 * Diagnostic: explains why "Knitting pending" differs between
 * Production Order Summary (article-centric) and Needle Wise Planning
 * (machine-assignment-centric).
 *
 * Run: node scripts/diagnose-knit-pending-gap.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const OrderStatus = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold',
  SHORT_CLOSE: 'Short Close',
  CANCELLED: 'Cancelled',
};

const NEEDLE_WISE_EXCLUDED = new Set([
  OrderStatus.ON_HOLD,
  OrderStatus.SHORT_CLOSE,
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
]);

const toNumber = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const refId = (ref) => {
  if (ref == null) return '';
  if (typeof ref === 'object' && (ref._id || ref.id)) return String(ref._id ?? ref.id);
  return String(ref);
};

/** Order-summary rule: remaining if present, else planned - completed. */
const summaryPending = (article) => {
  if (!article) return 0;
  const knitting = article.floorQuantities?.knitting;
  if (knitting && knitting.remaining != null && !Number.isNaN(Number(knitting.remaining))) {
    return Math.max(0, toNumber(knitting.remaining));
  }
  const planned = toNumber(article.plannedQuantity);
  const completed = toNumber(knitting?.completed);
  return planned > 0 ? Math.max(0, planned - completed) : 0;
};

/** Needle-wise rule: remaining if > 0, else planned if > 0, else 0. */
const needleWisePending = (article) => {
  if (!article) return 0;
  const rem = article.floorQuantities?.knitting?.remaining;
  const remNum = Number(rem);
  if (typeof rem === 'number' && Number.isFinite(remNum) && remNum > 0) return remNum;
  if (typeof rem === 'number') return 0; // remaining present but <= 0 -> falls back to planned in UI
  const planned = Number(article.plannedQuantity);
  return Number.isFinite(planned) && planned > 0 ? planned : 0;
};

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  const db = mongoose.connection.db;

  const articles = await db
    .collection('articles')
    .find({}, { projection: { orderId: 1, plannedQuantity: 1, 'floorQuantities.knitting': 1 } })
    .toArray();

  const assignments = await db.collection('machine_order_assignments').find({}).toArray();

  const articleById = new Map(articles.map((a) => [String(a._id), a]));

  // ---- Order Summary side --------------------------------------------------
  const shortClosedArticleIds = new Set();
  for (const asg of assignments) {
    for (const item of asg.productionOrderItems || []) {
      if (String(item.status) === OrderStatus.SHORT_CLOSE) {
        const id = refId(item.article);
        if (id) shortClosedArticleIds.add(id);
      }
    }
  }

  let summaryWithHold = 0;
  let summaryHold = 0;
  let summaryWithoutHold = 0;
  for (const a of articles) {
    const p = summaryPending(a);
    summaryWithHold += p;
    if (shortClosedArticleIds.has(String(a._id))) summaryHold += p;
    else summaryWithoutHold += p;
  }

  // ---- Needle Wise side ---------------------------------------------------
  // Count each queue item, mirroring the UI (all assignments, active + inactive).
  let needleWiseTotal = 0;
  const countedArticleIds = new Set();
  const perStatus = {};
  const dupArticleQty = new Map(); // articleId -> [qty, ...]
  let itemsMissingArticle = 0;

  for (const asg of assignments) {
    for (const item of asg.productionOrderItems || []) {
      const status = String(item.status ?? OrderStatus.PENDING);
      const articleId = refId(item.article);
      const article = articleById.get(articleId);
      if (!article) {
        itemsMissingArticle += 1;
        continue;
      }
      const qty = needleWisePending(article);
      perStatus[status] = (perStatus[status] ?? 0) + qty;
      if (NEEDLE_WISE_EXCLUDED.has(status)) continue;
      needleWiseTotal += qty;
      countedArticleIds.add(articleId);
      const list = dupArticleQty.get(articleId) ?? [];
      list.push(qty);
      dupArticleQty.set(articleId, list);
    }
  }

  // ---- Gap breakdown ------------------------------------------------------
  let unassignedQty = 0;
  let unassignedArticles = 0;
  const assignedArticleIds = new Set();
  for (const asg of assignments) {
    for (const item of asg.productionOrderItems || []) {
      const id = refId(item.article);
      if (id) assignedArticleIds.add(id);
    }
  }
  for (const a of articles) {
    const id = String(a._id);
    if (assignedArticleIds.has(id)) continue;
    if (shortClosedArticleIds.has(id)) continue;
    const p = summaryPending(a);
    if (p > 0) {
      unassignedQty += p;
      unassignedArticles += 1;
    }
  }

  let excludedStatusQty = 0;
  let excludedStatusArticles = 0;
  for (const a of articles) {
    const id = String(a._id);
    if (!assignedArticleIds.has(id)) continue;
    if (shortClosedArticleIds.has(id)) continue;
    if (countedArticleIds.has(id)) continue;
    const p = summaryPending(a);
    if (p > 0) {
      excludedStatusQty += p;
      excludedStatusArticles += 1;
    }
  }

  let doubleCountedQty = 0;
  let doubleCountedArticles = 0;
  for (const [, quantities] of dupArticleQty) {
    if (quantities.length > 1) {
      doubleCountedArticles += 1;
      doubleCountedQty += quantities.reduce((s, q) => s + q, 0) - quantities[0];
    }
  }

  console.log('=== ORDER SUMMARY (article-centric, all orders) ===');
  console.log('articles                :', articles.length);
  console.log('knitPendingWithHold     :', summaryWithHold.toLocaleString());
  console.log('holdQty (short close)   :', summaryHold.toLocaleString());
  console.log('knitPendingWithoutHold  :', summaryWithoutHold.toLocaleString(), '  <-- purple row, amber cell');

  console.log('\n=== NEEDLE WISE (assignment-centric) ===');
  console.log('assignments             :', assignments.length);
  console.log('queue items total       :', assignments.reduce((s, a) => s + (a.productionOrderItems?.length ?? 0), 0));
  console.log('items w/ missing article:', itemsMissingArticle);
  console.log('pendingQty total        :', needleWiseTotal.toLocaleString(), '  <-- footer cell');
  console.log('distinct articles seen  :', countedArticleIds.size);
  console.log('\nqty by queue-item status (before exclusions):');
  for (const [status, qty] of Object.entries(perStatus).sort((a, b) => b[1] - a[1])) {
    const flag = NEEDLE_WISE_EXCLUDED.has(status) ? '  [EXCLUDED by needle wise]' : '';
    console.log(`  ${status.padEnd(14)} ${qty.toLocaleString().padStart(12)}${flag}`);
  }

  console.log('\n=== GAP BREAKDOWN ===');
  console.log('difference              :', (summaryWithoutHold - needleWiseTotal).toLocaleString());
  console.log(`  never assigned to any machine : ${unassignedQty.toLocaleString()}  (${unassignedArticles} articles)`);
  console.log(`  assigned but status excluded   : ${excludedStatusQty.toLocaleString()}  (${excludedStatusArticles} articles)`);
  console.log(`  double counted (multi-machine) : -${doubleCountedQty.toLocaleString()}  (${doubleCountedArticles} articles on >1 queue)`);
  const explained = unassignedQty + excludedStatusQty - doubleCountedQty;
  console.log('  ------------------------------');
  console.log('  explained                     :', explained.toLocaleString());
  console.log('  unexplained residual          :', (summaryWithoutHold - needleWiseTotal - explained).toLocaleString());

  // Assignment truncation check (UI pulls limit=1000)
  console.log('\n=== UI FETCH LIMIT CHECK (FETCH_LIMIT = 1000) ===');
  console.log('assignments in DB       :', assignments.length, assignments.length > 1000 ? '  *** TRUNCATED IN UI ***' : '  (ok)');
  const machineCount = await db.collection('machines').countDocuments();
  console.log('machines in DB          :', machineCount, machineCount > 1000 ? '  *** TRUNCATED IN UI ***' : '  (ok)');
  const inactiveAsg = assignments.filter((a) => a.isActive === false).length;
  console.log('inactive assignments    :', inactiveAsg, '(needle wise counts their qty too)');

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
