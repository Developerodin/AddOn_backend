/**
 * Classifies the 28,821 pc gap between Order Summary and Needle Wise into
 * "real pending work with no machine" vs "stale remaining that should be zero".
 *
 * Read-only. Run: node scripts/diagnose-knit-pending-classify.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const TERMINAL = new Set(['On Hold', 'Short Close', 'Completed', 'Cancelled']);

const toNumber = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const refId = (ref) => {
  if (ref == null) return '';
  if (typeof ref === 'object' && (ref._id || ref.id)) return String(ref._id ?? ref.id);
  return String(ref);
};

const summaryPending = (article) => {
  const k = article.floorQuantities?.knitting;
  if (k && k.remaining != null && !Number.isNaN(Number(k.remaining))) {
    return Math.max(0, toNumber(k.remaining));
  }
  const planned = toNumber(article.plannedQuantity);
  return planned > 0 ? Math.max(0, planned - toNumber(k?.completed)) : 0;
};

const bump = (map, key, qty) => {
  const cur = map.get(key) ?? { qty: 0, n: 0 };
  cur.qty += qty;
  cur.n += 1;
  map.set(key, cur);
};

const dump = (title, map) => {
  console.log(`\n${title}`);
  const rows = [...map.entries()].sort((a, b) => b[1].qty - a[1].qty);
  for (const [key, v] of rows) {
    console.log(`  ${String(key).padEnd(42)} ${v.qty.toLocaleString().padStart(10)}  (${v.n} articles)`);
  }
};

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  const db = mongoose.connection.db;

  const orders = await db
    .collection('production_orders')
    .find({}, { projection: { status: 1, orderNumber: 1 } })
    .toArray();
  const orderById = new Map(orders.map((o) => [String(o._id), o]));

  const articles = await db
    .collection('articles')
    .find({}, { projection: { orderId: 1, articleNumber: 1, status: 1, plannedQuantity: 1, floorQuantities: 1 } })
    .toArray();

  const assignments = await db.collection('machine_order_assignments').find({}).toArray();

  // article -> set of queue statuses it appears under
  const statusesByArticle = new Map();
  for (const asg of assignments) {
    for (const item of asg.productionOrderItems || []) {
      const id = refId(item.article);
      if (!id) continue;
      if (!statusesByArticle.has(id)) statusesByArticle.set(id, new Set());
      statusesByArticle.get(id).add(String(item.status ?? 'Pending'));
    }
  }

  // ---- 1. Accounting invariant on knitting -------------------------------
  console.log('=== INVARIANT: does knitting.received == completed + remaining ? ===');
  const invariant = new Map();
  let brokenQty = 0;
  for (const a of articles) {
    const k = a.floorQuantities?.knitting ?? {};
    const received = toNumber(k.received);
    const completed = toNumber(k.completed);
    const remaining = toNumber(k.remaining);
    const delta = received - completed - remaining;
    const key = delta === 0 ? 'balanced' : delta > 0 ? 'received > completed+remaining' : 'received < completed+remaining';
    bump(invariant, key, Math.abs(delta));
    if (delta !== 0) brokenQty += Math.abs(delta);
  }
  dump('knitting ledger balance (qty column = total |delta|):', invariant);

  console.log('\n=== INVARIANT: does plannedQuantity == knitting.received ? ===');
  const plannedVsReceived = new Map();
  for (const a of articles) {
    const delta = toNumber(a.plannedQuantity) - toNumber(a.floorQuantities?.knitting?.received);
    bump(plannedVsReceived, delta === 0 ? 'equal' : delta > 0 ? 'planned > received' : 'planned < received', Math.abs(delta));
  }
  dump('planned vs knitting.received:', plannedVsReceived);

  // ---- 2. Classify every article carrying pending knitting ---------------
  const byBucket = new Map();
  const detail = [];

  for (const a of articles) {
    const pending = summaryPending(a);
    if (pending <= 0) continue;

    const oid = a.orderId ? String(a.orderId) : '';
    const order = orderById.get(oid);
    const orderStatus = order ? String(order.status) : 'ORPHAN (order missing)';
    const queueStatuses = statusesByArticle.get(String(a._id));

    let placement;
    if (!queueStatuses) placement = 'never on any machine queue';
    else if ([...queueStatuses].every((s) => TERMINAL.has(s)))
      placement = `queue all terminal (${[...queueStatuses].sort().join('/')})`;
    else placement = 'live on a machine queue';

    const bucket = `${placement}  |  order=${orderStatus}`;
    bump(byBucket, bucket, pending);

    if (placement !== 'live on a machine queue') {
      detail.push({
        articleNumber: a.articleNumber,
        orderNumber: order?.orderNumber ?? '(none)',
        orderStatus,
        articleStatus: String(a.status),
        planned: toNumber(a.plannedQuantity),
        received: toNumber(a.floorQuantities?.knitting?.received),
        completed: toNumber(a.floorQuantities?.knitting?.completed),
        remaining: toNumber(a.floorQuantities?.knitting?.remaining),
        transferred: toNumber(a.floorQuantities?.knitting?.transferred),
        pending,
        placement,
      });
    }
  }

  dump('=== EVERY ARTICLE WITH PENDING KNITTING, BY PLACEMENT + ORDER STATUS ===', byBucket);

  // ---- 3. Is the invisible work on live orders or dead orders? ----------
  const DEAD_ORDER = new Set(['Cancelled', 'Completed', 'Short Close']);
  let liveWork = 0;
  let deadWork = 0;
  const articleStatusSplit = new Map();
  for (const d of detail) {
    if (DEAD_ORDER.has(d.orderStatus) || d.orderStatus.startsWith('ORPHAN')) deadWork += d.pending;
    else liveWork += d.pending;
    bump(articleStatusSplit, `order=${d.orderStatus} / article=${d.articleStatus}`, d.pending);
  }

  console.log('\n=== VERDICT ON THE INVISIBLE (Needle-Wise-missing) WORK ===');
  console.log('total invisible          :', (liveWork + deadWork).toLocaleString());
  console.log('  on LIVE orders  (real) :', liveWork.toLocaleString(), '<- genuine unplanned backlog, must be produced');
  console.log('  on DEAD orders (stale) :', deadWork.toLocaleString(), '<- should arguably be 0');
  dump('by order status / article status:', articleStatusSplit);

  // ---- 4. Does knitting.transferred already cover the remaining? --------
  console.log('\n=== SPOT CHECK: top 25 invisible articles ===');
  console.log(
    ['article', 'order', 'ordStat', 'artStat', 'plan', 'recv', 'comp', 'remain', 'xfer', 'placement'].join('\t')
  );
  for (const d of detail.sort((x, y) => y.pending - x.pending).slice(0, 25)) {
    console.log(
      [
        d.articleNumber,
        d.orderNumber,
        d.orderStatus,
        d.articleStatus,
        d.planned,
        d.received,
        d.completed,
        d.remaining,
        d.transferred,
        d.placement,
      ].join('\t')
    );
  }

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
