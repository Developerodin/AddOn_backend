import { Article, ProductionOrder } from '../../models/production/index.js';
import { resolveArticleKnittingPendingQuantity } from './machinePendingQuantity.service.js';
import {
  indexQueueByArticle,
  loadQueueAssignments,
  KNIT_PENDING_ARTICLE_SELECT,
  collectListedArticleIds,
} from './knittingPendingBuckets.service.js';
import { KnitPendingBucket, resolveKnitPendingBucket } from './knittingQueueStatus.js';

const ALLOWED_SORT_FIELDS = new Set(['createdAt', 'updatedAt', 'orderNumber', 'priority', 'status']);

/**
 * Coerces a value to a finite number, defaulting to 0.
 * @param {unknown} value
 * @returns {number}
 */
const toNumber = (value) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Resolves a Mongo id string from a raw or populated ref.
 * @param {unknown} ref
 * @returns {string}
 */
const refId = (ref) => {
  if (ref == null) return '';
  if (typeof ref === 'object' && (ref._id || ref.id)) {
    return String(ref._id ?? ref.id);
  }
  return String(ref);
};

/**
 * Escapes a user search string for safe regex matching.
 * @param {string} value
 * @returns {string}
 */
const escapeRegexLiteral = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Empty metric bucket used for order / page / filter totals.
 *
 * `knitPendingWithoutHold` is the legacy pre-bucket number, kept alongside
 * `knitPendingQty` so the UI can show both during rollout instead of a headline
 * figure dropping without explanation.
 * @returns {Record<string, number>}
 */
export const createEmptyOrderSummaryMetrics = () => ({
  articleCount: 0,
  totalQty: 0,
  holdQty: 0,
  knitPendingWithHold: 0,
  knitPendingWithoutHold: 0,
  /** onMachine + unplanned. The reportable pending figure. */
  knitPendingQty: 0,
  /** Pending on a live machine queue. Matches the Needle Wise table. */
  knitPendingOnMachine: 0,
  /** Pending with no machine assigned. Needs planning. */
  knitPendingUnplanned: 0,
  /** Balance left when the machine closed the row as Completed / Cancelled. */
  closedOnMachineQty: 0,
  /** Balance on rows paused as On Hold. */
  onHoldQty: 0,
  transferQty: 0,
  wipQty: 0,
});

/** Maps a bucket to the metrics field that accumulates it. */
const BUCKET_METRIC_FIELD = {
  [KnitPendingBucket.ON_MACHINE]: 'knitPendingOnMachine',
  [KnitPendingBucket.UNPLANNED]: 'knitPendingUnplanned',
  [KnitPendingBucket.SHORT_CLOSED]: 'holdQty',
  [KnitPendingBucket.CLOSED_ON_MACHINE]: 'closedOnMachineQty',
  [KnitPendingBucket.ON_HOLD]: 'onHoldQty',
};

/**
 * Adds one article into a metrics bucket.
 * @param {ReturnType<typeof createEmptyOrderSummaryMetrics>} metrics
 * @param {Record<string, unknown>} article
 * @param {Map<string, Set<string>>} statusesByArticle Queue statuses per article id
 */
export const addArticleToOrderSummaryMetrics = (metrics, article, statusesByArticle) => {
  const articleId = refId(article._id || article.id);
  const remaining = resolveArticleKnittingPendingQuantity(article);
  const bucket = resolveKnitPendingBucket(statusesByArticle.get(articleId));

  metrics.articleCount += 1;
  metrics.totalQty += toNumber(article.plannedQuantity);
  metrics.knitPendingWithHold += remaining;
  metrics[BUCKET_METRIC_FIELD[bucket]] += remaining;

  // Legacy column: everything except short close, i.e. the number this report
  // showed before closed-on-machine and on-hold balances were split out.
  if (bucket !== KnitPendingBucket.SHORT_CLOSED) {
    metrics.knitPendingWithoutHold += remaining;
  }

  metrics.transferQty += toNumber(article.floorQuantities?.dispatch?.transferred);
};

/**
 * Derives pending and WIP once every article has been added.
 *
 * WIP is the residual: planned minus everything we can account for. It can go
 * negative when floors report more than was planned, and the UI flags that.
 * @param {ReturnType<typeof createEmptyOrderSummaryMetrics>} metrics
 * @returns {ReturnType<typeof createEmptyOrderSummaryMetrics>}
 */
export const finalizeOrderSummaryMetrics = (metrics) => {
  metrics.knitPendingQty = metrics.knitPendingOnMachine + metrics.knitPendingUnplanned;
  metrics.wipQty =
    metrics.totalQty -
    metrics.knitPendingQty -
    metrics.holdQty -
    metrics.closedOnMachineQty -
    metrics.onHoldQty -
    metrics.transferQty;
  return metrics;
};

/**
 * Builds a ProductionOrder filter from report query params.
 * @param {{ search?: string, status?: string, priority?: string }} filter
 * @returns {Record<string, unknown>}
 */
const buildOrderFilter = (filter = {}) => {
  const query = {};
  if (filter.status) query.status = filter.status;
  if (filter.priority) query.priority = filter.priority;
  const search = typeof filter.search === 'string' ? filter.search.trim() : '';
  if (search) {
    const regex = { $regex: escapeRegexLiteral(search), $options: 'i' };
    query.$or = [{ orderNumber: regex }, { orderNote: regex }];
  }
  return query;
};

/**
 * Loads article docs listed on the given orders' articles arrays.
 * Uses order.articles (what the order screen shows), not article.orderId,
 * so rows dropped from an order cannot inflate pending.
 * @param {Array<Record<string, unknown>>} orders Lean ProductionOrder docs with articles ids
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
const loadArticlesListedOnOrders = async (orders) => {
  const ids = [...collectListedArticleIds(orders)];
  if (!ids.length) return [];
  return Article.find({ _id: { $in: ids } }).select(KNIT_PENDING_ARTICLE_SELECT).lean();
};

/**
 * Groups listed articles under the order that references them.
 * @param {Array<Record<string, unknown>>} orders
 * @param {Array<Record<string, unknown>>} articles
 * @returns {Map<string, Array<Record<string, unknown>>>}
 */
const groupArticlesByOrderMembers = (orders, articles) => {
  const articleById = new Map(
    (articles ?? []).map((article) => [refId(article._id || article.id), article])
  );
  const byOrder = new Map();
  for (const order of orders ?? []) {
    const list = [];
    for (const ref of order.articles ?? []) {
      const article = articleById.get(refId(ref));
      if (article) list.push(article);
    }
    byOrder.set(refId(order._id), list);
  }
  return byOrder;
};

/**
 * Rolls article rows into one metrics object.
 * @param {Array<Record<string, unknown>>} articles
 * @param {Map<string, Set<string>>} statusesByArticle
 * @returns {ReturnType<typeof createEmptyOrderSummaryMetrics>}
 */
const metricsFromArticles = (articles, statusesByArticle) => {
  const metrics = createEmptyOrderSummaryMetrics();
  for (const article of articles) {
    addArticleToOrderSummaryMetrics(metrics, article, statusesByArticle);
  }
  return finalizeOrderSummaryMetrics(metrics);
};

/**
 * Paginated production-order summary report.
 * @param {{ search?: string, status?: string, priority?: string }} filter
 * @param {{ page?: number, limit?: number, sortBy?: string }} options
 * @returns {Promise<{ results: object[], page: number, limit: number, totalPages: number, total: number, totals: object, pageTotals: object }>}
 */
export const getOrderSummaryReport = async (filter = {}, options = {}) => {
  const limit = Math.min(parseInt(String(options.limit), 10) || 10, 100);
  const page = parseInt(String(options.page), 10) || 1;
  const rawSort =
    typeof options.sortBy === 'string' && options.sortBy.trim()
      ? options.sortBy.trim().split(',')[0]
      : 'createdAt:desc';
  const [sortField, sortDir] = rawSort.split(':');
  const safeSortBy = `${ALLOWED_SORT_FIELDS.has(sortField) ? sortField : 'createdAt'}:${
    sortDir === 'asc' ? 'asc' : 'desc'
  }`;

  const orderFilter = buildOrderFilter(filter);
  const paged = await ProductionOrder.paginate(orderFilter, {
    page,
    limit,
    sortBy: safeSortBy,
    select: 'orderNumber orderNote priority status createdAt articles',
    lean: true,
  });

  const pageOrders = paged.results || [];

  const allOrders = await ProductionOrder.find(orderFilter).select('_id articles').lean();

  // One queue index for the whole request: an article's bucket depends on every
  // machine row referencing it, not just rows under the orders on this page.
  const [pageArticles, allArticles, assignments] = await Promise.all([
    loadArticlesListedOnOrders(pageOrders),
    allOrders.length === pageOrders.length
      ? Promise.resolve(null)
      : loadArticlesListedOnOrders(allOrders),
    loadQueueAssignments(),
  ]);

  const { statusesByArticle } = indexQueueByArticle(assignments);
  const articlesForTotals = allArticles ?? pageArticles;
  const articlesByOrder = groupArticlesByOrderMembers(pageOrders, pageArticles);

  const results = pageOrders.map((order) => {
    const orderId = refId(order._id);
    const metrics = metricsFromArticles(articlesByOrder.get(orderId) || [], statusesByArticle);
    return {
      orderId,
      orderNumber: order.orderNumber || '',
      orderNote: order.orderNote || '',
      priority: order.priority || '',
      status: order.status || '',
      createdAt: order.createdAt,
      ...metrics,
    };
  });

  // Summing every metric key keeps page totals correct when a new bucket is added.
  const pageTotals = results.reduce((acc, row) => {
    for (const key of Object.keys(acc)) {
      acc[key] += toNumber(row[key]);
    }
    return acc;
  }, createEmptyOrderSummaryMetrics());

  const totals = metricsFromArticles(articlesForTotals, statusesByArticle);

  return {
    results,
    page: paged.page,
    limit: paged.limit,
    totalPages: paged.totalPages,
    total: paged.totalResults,
    totals,
    pageTotals,
  };
};
