/**
 * Checks for Article docs whose orderId does not resolve to a ProductionOrder.
 * Such articles are invisible to the order-summary report (it queries by orderId
 * of matching orders) but would show up in a naive "sum all articles" count.
 *
 * Run: node scripts/diagnose-orphan-articles.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const toNumber = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const summaryPending = (article) => {
  const knitting = article.floorQuantities?.knitting;
  if (knitting && knitting.remaining != null && !Number.isNaN(Number(knitting.remaining))) {
    return Math.max(0, toNumber(knitting.remaining));
  }
  const planned = toNumber(article.plannedQuantity);
  const completed = toNumber(knitting?.completed);
  return planned > 0 ? Math.max(0, planned - completed) : 0;
};

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  const db = mongoose.connection.db;

  const orderIds = new Set(
    (await db.collection('production_orders').find({}, { projection: { _id: 1 } }).toArray()).map((o) =>
      String(o._id)
    )
  );

  const articles = await db
    .collection('articles')
    .find({}, { projection: { orderId: 1, plannedQuantity: 1, 'floorQuantities.knitting': 1 } })
    .toArray();

  let orphanQty = 0;
  let orphanCount = 0;
  let validQty = 0;
  for (const a of articles) {
    const oid = a.orderId ? String(a.orderId) : '';
    const p = summaryPending(a);
    if (!oid || !orderIds.has(oid)) {
      orphanQty += p;
      orphanCount += 1;
    } else {
      validQty += p;
    }
  }

  console.log('production orders          :', orderIds.size);
  console.log('articles                  :', articles.length);
  console.log('orphan articles           :', orphanCount, `(pending ${orphanQty.toLocaleString()})`);
  console.log('pending on valid orders   :', validQty.toLocaleString());

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
