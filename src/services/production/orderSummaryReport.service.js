import { Article, MachineOrderAssignment, ProductionOrder, OrderStatus } from '../../models/production/index.js';
import { resolveArticleKnittingPendingQuantity } from './machinePendingQuantity.service.js';

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
 * @returns {{ articleCount: number, totalQty: number, holdQty: number, knitPendingWithHold: number, knitPendingWithoutHold: number, transferQty: number, wipQty: number }}
 */
export const createEmptyOrderSummaryMetrics = () => ({
  articleCount: 0,
  totalQty: 0,
  holdQty: 0,
  knitPendingWithHold: 0,
  knitPendingWithoutHold: 0,
  transferQty: 0,
  wipQty: 0,
});

/**
 * Adds one article into a metrics bucket using locked summary formulas.
 * @param {ReturnType<typeof createEmptyOrderSummaryMetrics>} metrics
 * @param {Record<string, unknown>} article
 * @param {Set<string>} shortClosedArticleIds
 */
export const addArticleToOrderSummaryMetrics = (metrics, article, shortClosedArticleIds) => {
  const articleId = refId(article._id || article.id);
  const remaining = resolveArticleKnittingPendingQuantity(article);
  const isHold = shortClosedArticleIds.has(articleId);

  metrics.articleCount += 1;
  metrics.totalQty += toNumber(article.plannedQuantity);
  metrics.knitPendingWithHold += remaining;
  if (isHold) {
    metrics.holdQty += remaining;
  } else {
    metrics.knitPendingWithoutHold += remaining;
  }
  metrics.transferQty += toNumber(article.floorQuantities?.dispatch?.transferred);
};

/**
 * Sets WIP from Total − knit pending without hold − transfer − hold.
 * @param {ReturnType<typeof createEmptyOrderSummaryMetrics>} metrics
 * @returns {ReturnType<typeof createEmptyOrderSummaryMetrics>}
 */
export const finalizeOrderSummaryMetrics = (metrics) => {
  metrics.wipQty =
    metrics.totalQty - metrics.knitPendingWithoutHold - metrics.transferQty - metrics.holdQty;
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
 * Loads article docs needed for summary qty columns.
 * @param {import('mongoose').Types.ObjectId[]} orderIds
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
const loadArticlesForOrders = async (orderIds) => {
  if (!orderIds.length) return [];
  return Article.find({ orderId: { $in: orderIds } })
    .select('orderId plannedQuantity floorQuantities.knitting floorQuantities.dispatch.transferred')
    .lean();
};

/**
 * Collects article ids whose current machine-queue item is Short Close.
 * @param {import('mongoose').Types.ObjectId[]} orderIds
 * @returns {Promise<Set<string>>}
 */
const loadShortClosedArticleIds = async (orderIds) => {
  const ids = new Set();
  if (!orderIds.length) return ids;

  const orderIdSet = new Set(orderIds.map((id) => String(id)));
  const assignments = await MachineOrderAssignment.find({
    'productionOrderItems.productionOrder': { $in: orderIds },
    'productionOrderItems.status': OrderStatus.SHORT_CLOSE,
  })
    .select('productionOrderItems.productionOrder productionOrderItems.article productionOrderItems.status')
    .lean();

  for (const assignment of assignments) {
    for (const item of assignment.productionOrderItems || []) {
      if (String(item.status) !== OrderStatus.SHORT_CLOSE) continue;
      if (!orderIdSet.has(refId(item.productionOrder))) continue;
      const articleId = refId(item.article);
      if (articleId) ids.add(articleId);
    }
  }
  return ids;
};

/**
 * Groups articles by production order id string.
 * @param {Array<Record<string, unknown>>} articles
 * @returns {Map<string, Array<Record<string, unknown>>>}
 */
const groupArticlesByOrderId = (articles) => {
  const byOrder = new Map();
  for (const article of articles) {
    const orderId = refId(article.orderId);
    if (!orderId) continue;
    const list = byOrder.get(orderId);
    if (list) list.push(article);
    else byOrder.set(orderId, [article]);
  }
  return byOrder;
};

/**
 * Rolls article rows into one metrics object.
 * @param {Array<Record<string, unknown>>} articles
 * @param {Set<string>} shortClosedArticleIds
 * @returns {ReturnType<typeof createEmptyOrderSummaryMetrics>}
 */
const metricsFromArticles = (articles, shortClosedArticleIds) => {
  const metrics = createEmptyOrderSummaryMetrics();
  for (const article of articles) {
    addArticleToOrderSummaryMetrics(metrics, article, shortClosedArticleIds);
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
    select: 'orderNumber orderNote priority status createdAt',
    lean: true,
  });

  const pageOrders = paged.results || [];
  const pageOrderIds = pageOrders.map((order) => order._id).filter(Boolean);

  const allOrderIdDocs = await ProductionOrder.find(orderFilter).select('_id').lean();
  const allOrderIds = allOrderIdDocs.map((order) => order._id);

  const [pageArticles, allArticles, pageShortClosed, allShortClosed] = await Promise.all([
    loadArticlesForOrders(pageOrderIds),
    allOrderIds.length === pageOrderIds.length
      ? Promise.resolve(null)
      : loadArticlesForOrders(allOrderIds),
    loadShortClosedArticleIds(pageOrderIds),
    allOrderIds.length === pageOrderIds.length
      ? Promise.resolve(null)
      : loadShortClosedArticleIds(allOrderIds),
  ]);

  const articlesForTotals = allArticles ?? pageArticles;
  const shortClosedForTotals = allShortClosed ?? pageShortClosed;
  const articlesByOrder = groupArticlesByOrderId(pageArticles);

  const results = pageOrders.map((order) => {
    const orderId = refId(order._id);
    const metrics = metricsFromArticles(articlesByOrder.get(orderId) || [], pageShortClosed);
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

  const pageTotals = results.reduce((acc, row) => {
    acc.articleCount += row.articleCount;
    acc.totalQty += row.totalQty;
    acc.holdQty += row.holdQty;
    acc.knitPendingWithHold += row.knitPendingWithHold;
    acc.knitPendingWithoutHold += row.knitPendingWithoutHold;
    acc.transferQty += row.transferQty;
    acc.wipQty += row.wipQty;
    return acc;
  }, createEmptyOrderSummaryMetrics());

  const totals = metricsFromArticles(articlesForTotals, shortClosedForTotals);

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
