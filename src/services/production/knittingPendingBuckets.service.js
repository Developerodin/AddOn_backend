import { Article, MachineOrderAssignment, ProductionOrder } from '../../models/production/index.js';
import { resolveArticleKnittingPendingQuantity } from './machinePendingQuantity.service.js';
import {
  KnitPendingBucket,
  isLiveQueueStatus,
  normalizeQueueStatus,
  resolveKnitPendingBucket,
} from './knittingQueueStatus.js';

/**
 * Classifies every article's remaining knitting quantity into buckets, so the
 * Production Order Summary and the Needle Wise report can be driven from one
 * calculation instead of two that drift apart.
 */

/** Needle label used when a machine assignment has no active needle set. */
export const UNASSIGNED_NEEDLE_LABEL = 'Not set';

/**
 * Resolves a Mongo id string from a raw or populated ref.
 * @param {unknown} ref
 * @returns {string}
 */
const refId = (ref) => {
  if (ref == null) return '';
  if (typeof ref === 'object' && (ref._id || ref.id)) return String(ref._id ?? ref.id);
  return String(ref);
};

/**
 * Empty bucket totals.
 * @returns {Record<string, number>}
 */
export const createEmptyBucketTotals = () => ({
  [KnitPendingBucket.ON_MACHINE]: 0,
  [KnitPendingBucket.UNPLANNED]: 0,
  [KnitPendingBucket.SHORT_CLOSED]: 0,
  [KnitPendingBucket.CLOSED_ON_MACHINE]: 0,
  [KnitPendingBucket.ON_HOLD]: 0,
});

/**
 * Builds, for each article id, the set of queue statuses referencing it and the
 * needle of every live row it sits on.
 *
 * @param {Array<Record<string, unknown>>} assignments Lean MachineOrderAssignment docs
 * @returns {{
 *   statusesByArticle: Map<string, Set<string>>,
 *   liveNeedlesByArticle: Map<string, Set<string>>
 * }}
 */
export const indexQueueByArticle = (assignments = []) => {
  /** @type {Map<string, Set<string>>} */
  const statusesByArticle = new Map();
  /** @type {Map<string, Set<string>>} */
  const liveNeedlesByArticle = new Map();

  for (const assignment of assignments) {
    const needle = String(assignment?.activeNeedle ?? '').trim() || UNASSIGNED_NEEDLE_LABEL;
    for (const item of assignment?.productionOrderItems ?? []) {
      const articleId = refId(item?.article);
      if (!articleId) continue;
      const status = normalizeQueueStatus(item?.status);

      if (!statusesByArticle.has(articleId)) statusesByArticle.set(articleId, new Set());
      statusesByArticle.get(articleId).add(status);

      if (isLiveQueueStatus(status)) {
        if (!liveNeedlesByArticle.has(articleId)) liveNeedlesByArticle.set(articleId, new Set());
        liveNeedlesByArticle.get(articleId).add(needle);
      }
    }
  }

  return { statusesByArticle, liveNeedlesByArticle };
};

/**
 * Classifies one article. Pure; safe to unit test.
 *
 * An article on several machines is attributed to a single needle so needle
 * totals never double count: the alphabetically first live needle wins.
 *
 * @param {Record<string, unknown>} article Lean Article doc
 * @param {Map<string, Set<string>>} statusesByArticle
 * @param {Map<string, Set<string>>} liveNeedlesByArticle
 * @returns {{ articleId: string, qty: number, bucket: string, needle: string|null }}
 */
export const classifyArticleKnitPending = (article, statusesByArticle, liveNeedlesByArticle) => {
  const articleId = refId(article?._id ?? article?.id);
  const qty = resolveArticleKnittingPendingQuantity(article);
  const bucket = resolveKnitPendingBucket(statusesByArticle.get(articleId));

  let needle = null;
  if (bucket === KnitPendingBucket.ON_MACHINE) {
    const needles = [...(liveNeedlesByArticle.get(articleId) ?? [])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
    needle = needles[0] ?? UNASSIGNED_NEEDLE_LABEL;
  }

  return { articleId, qty, bucket, needle };
};

/**
 * Aggregates a list of articles into bucket totals plus a per-needle breakdown
 * of the on-machine bucket.
 *
 * @param {Array<Record<string, unknown>>} articles Lean Article docs
 * @param {Array<Record<string, unknown>>} assignments Lean MachineOrderAssignment docs
 * @returns {{
 *   buckets: Record<string, number>,
 *   pendingQty: number,
 *   onMachineByNeedle: Map<string, number>,
 *   articleCountByBucket: Record<string, number>,
 *   bucketByArticleId: Map<string, string>
 * }}
 */
export const aggregateKnitPendingBuckets = (articles = [], assignments = []) => {
  const { statusesByArticle, liveNeedlesByArticle } = indexQueueByArticle(assignments);

  const buckets = createEmptyBucketTotals();
  const articleCountByBucket = createEmptyBucketTotals();
  /** @type {Map<string, number>} */
  const onMachineByNeedle = new Map();
  /** @type {Map<string, string>} */
  const bucketByArticleId = new Map();

  for (const article of articles) {
    const { articleId, qty, bucket, needle } = classifyArticleKnitPending(
      article,
      statusesByArticle,
      liveNeedlesByArticle
    );
    bucketByArticleId.set(articleId, bucket);
    if (qty <= 0) continue;

    buckets[bucket] += qty;
    articleCountByBucket[bucket] += 1;

    if (bucket === KnitPendingBucket.ON_MACHINE && needle) {
      onMachineByNeedle.set(needle, (onMachineByNeedle.get(needle) ?? 0) + qty);
    }
  }

  return {
    buckets,
    pendingQty: buckets[KnitPendingBucket.ON_MACHINE] + buckets[KnitPendingBucket.UNPLANNED],
    onMachineByNeedle,
    articleCountByBucket,
    bucketByArticleId,
  };
};

/**
 * Drops articles whose orderId does not resolve to a ProductionOrder.
 * Order Summary only loads articles via existing orders; without this filter
 * the buckets endpoint inflates unplanned qty by leftover orphan articles.
 * @param {Array<Record<string, unknown>>} articles
 * @param {Set<string>} orderIdSet
 * @returns {Array<Record<string, unknown>>}
 */
export const keepArticlesOnExistingOrders = (articles, orderIdSet) =>
  (articles ?? []).filter((article) => orderIdSet.has(refId(article?.orderId)));

/**
 * Collects article ids that actually sit on a ProductionOrder.articles array.
 * That array is what the order screen shows; article.orderId can still point
 * at an order after the row was dropped from the order.
 * @param {Array<Record<string, unknown>>} orders
 * @returns {Set<string>}
 */
export const collectListedArticleIds = (orders) => {
  const ids = new Set();
  for (const order of orders ?? []) {
    for (const ref of order.articles ?? []) {
      const id = refId(ref);
      if (id) ids.add(id);
    }
  }
  return ids;
};

/**
 * Keeps only articles listed on some order.articles array.
 * @param {Array<Record<string, unknown>>} articles
 * @param {Set<string>} listedArticleIds
 * @returns {Array<Record<string, unknown>>}
 */
export const keepArticlesListedOnOrders = (articles, listedArticleIds) =>
  (articles ?? []).filter((article) => listedArticleIds.has(refId(article?._id ?? article?.id)));

/**
 * One unplanned-article row for the Needle Wise "needs planning" table.
 * @param {Record<string, unknown>} article
 * @param {number} qty
 * @param {Record<string, unknown>|undefined} order
 * @returns {{ articleId: string, articleNumber: string, orderId: string, orderNumber: string, orderNote: string, qty: number }}
 */
export const toUnplannedArticleRow = (article, qty, order) => ({
  articleId: refId(article?._id ?? article?.id),
  articleNumber: String(article?.articleNumber ?? ''),
  orderId: refId(article?.orderId),
  orderNumber: String(order?.orderNumber ?? ''),
  orderNote: String(order?.orderNote ?? ''),
  qty,
});

/** Article fields every knit-pending calculation needs. */
export const KNIT_PENDING_ARTICLE_SELECT =
  'orderId articleNumber plannedQuantity floorQuantities.knitting floorQuantities.dispatch.transferred';

/** Assignment fields needed to bucket articles. */
const ASSIGNMENT_SELECT =
  'activeNeedle isActive productionOrderItems.article productionOrderItems.productionOrder productionOrderItems.status';

/**
 * Loads every machine-queue row, which is what decides an article's bucket.
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export const loadQueueAssignments = async () =>
  MachineOrderAssignment.find({}).select(ASSIGNMENT_SELECT).lean();

/**
 * Factory-wide knitting pending broken into buckets, with the on-machine part
 * split by needle. This is the reconciliation source for both reports.
 *
 * @param {{ orderIds?: import('mongoose').Types.ObjectId[] }} [options] Restrict to given orders
 * @returns {Promise<{
 *   generatedAt: string,
 *   buckets: Record<string, number>,
 *   articleCountByBucket: Record<string, number>,
 *   pendingQty: number,
 *   onMachineByNeedle: Record<string, number>,
 *   unplannedArticles: Array<{ articleId: string, articleNumber: string, orderId: string, orderNumber: string, orderNote: string, qty: number }>,
 *   orphanPendingQty: number,
 *   orphanArticleCount: number
 * }>}
 */
export const getKnittingPendingBuckets = async ({ orderIds } = {}) => {
  const [orders, assignments, allArticles] = await Promise.all([
    ProductionOrder.find(orderIds ? { _id: { $in: orderIds } } : {})
      .select('_id orderNumber orderNote articles')
      .lean(),
    loadQueueAssignments(),
    Article.find(orderIds ? { orderId: { $in: orderIds } } : {})
      .select(KNIT_PENDING_ARTICLE_SELECT)
      .lean(),
  ]);

  const orderById = new Map(orders.map((order) => [String(order._id), order]));
  const orderIdSet = new Set(orderById.keys());
  const listedArticleIds = collectListedArticleIds(orders);
  const articles = keepArticlesListedOnOrders(
    keepArticlesOnExistingOrders(allArticles, orderIdSet),
    listedArticleIds
  );

  const orphanPendingQty = allArticles.reduce((sum, article) => {
    if (orderIdSet.has(refId(article.orderId))) return sum;
    return sum + resolveArticleKnittingPendingQuantity(article);
  }, 0);
  const orphanArticleCount = allArticles.filter(
    (article) =>
      !orderIdSet.has(refId(article.orderId)) && resolveArticleKnittingPendingQuantity(article) > 0
  ).length;

  const droppedFromOrderPendingQty = allArticles.reduce((sum, article) => {
    if (!orderIdSet.has(refId(article.orderId))) return sum;
    if (listedArticleIds.has(refId(article._id ?? article.id))) return sum;
    return sum + resolveArticleKnittingPendingQuantity(article);
  }, 0);
  const droppedFromOrderArticleCount = allArticles.filter(
    (article) =>
      orderIdSet.has(refId(article.orderId)) &&
      !listedArticleIds.has(refId(article._id ?? article.id)) &&
      resolveArticleKnittingPendingQuantity(article) > 0
  ).length;

  const { statusesByArticle, liveNeedlesByArticle } = indexQueueByArticle(assignments);
  const aggregate = aggregateKnitPendingBuckets(articles, assignments);

  const unplannedArticles = [];
  for (const article of articles) {
    const { qty, bucket } = classifyArticleKnitPending(
      article,
      statusesByArticle,
      liveNeedlesByArticle
    );
    if (bucket === KnitPendingBucket.UNPLANNED && qty > 0) {
      unplannedArticles.push(
        toUnplannedArticleRow(article, qty, orderById.get(refId(article.orderId)))
      );
    }
  }
  unplannedArticles.sort((a, b) => b.qty - a.qty);

  return {
    generatedAt: new Date().toISOString(),
    buckets: aggregate.buckets,
    articleCountByBucket: aggregate.articleCountByBucket,
    pendingQty: aggregate.pendingQty,
    onMachineByNeedle: Object.fromEntries(aggregate.onMachineByNeedle),
    unplannedArticles,
    orphanPendingQty,
    orphanArticleCount,
    droppedFromOrderPendingQty,
    droppedFromOrderArticleCount,
  };
};
