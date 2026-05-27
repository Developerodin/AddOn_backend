import httpStatus from 'http-status';
import { Article, M3Log, ProductionOrder, M3LogType } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';

const M3_FLOOR_KEYS = ['checking', 'secondaryChecking', 'finalChecking'];

const FLOOR_KEY_TO_LABEL = {
  checking: 'Checking',
  secondaryChecking: 'Secondary Checking',
  finalChecking: 'Final Checking',
};

/**
 * Per-floor M3 breakdown for an article (checking floors only).
 * @param {Object} article
 * @returns {Object}
 */
export const computeM3Snapshot = (article) => {
  const fq = article?.floorQuantities || {};
  const byFloor = {
    checking: fq.checking?.m3Quantity || 0,
    secondaryChecking: fq.secondaryChecking?.m3Quantity || 0,
    finalChecking: fq.finalChecking?.m3Quantity || 0,
  };
  const onHand = Object.values(byFloor).reduce((s, n) => s + n, 0);
  const outwardTotal = article?.m3Tracking?.outwardTotal || 0;
  const availableForOutward = Math.max(0, onHand - outwardTotal);

  return { byFloor, onHand, outwardTotal, availableForOutward };
};

/**
 * Resolve article by Mongo _id or custom id string.
 * @param {string} articleId
 * @returns {Promise<Object|null>}
 */
const findArticleById = async (articleId) => {
  const byMongo = await Article.findById(articleId);
  if (byMongo) return byMongo;
  return Article.findOne({ id: articleId });
};

/**
 * Resolve order number for denormalized log fields.
 * @param {Object} article
 * @returns {Promise<string>}
 */
const resolveOrderNumber = async (article) => {
  if (!article?.orderId) return '';
  const order = await ProductionOrder.findById(article.orderId).select('orderNumber').lean();
  return order?.orderNumber || '';
};

/**
 * Record an M3 ENTRY log when floor M3 increases (non-blocking caller).
 * @param {Object} params
 * @returns {Promise<Object|null>}
 */
export const recordM3Entry = async ({
  article,
  sourceFloor,
  deltaQuantity,
  previousFloorTotal,
  newFloorTotal,
  user,
  remarks = '',
}) => {
  if (!article || !deltaQuantity || deltaQuantity <= 0) return null;

  const snapshot = computeM3Snapshot(article);
  const orderNumber = await resolveOrderNumber(article);
  const articleIdStr = article._id?.toString?.() ?? String(article._id);
  const orderIdStr = article.orderId?.toString?.() ?? String(article.orderId);

  return M3Log.createLogEntry({
    type: M3LogType.ENTRY,
    articleId: articleIdStr,
    orderId: orderIdStr,
    orderNumber,
    articleNumber: article.articleNumber || '',
    sourceFloor,
    quantity: deltaQuantity,
    previousOnHand: snapshot.onHand - deltaQuantity,
    newOnHand: snapshot.onHand,
    previousOutwardTotal: snapshot.outwardTotal,
    newOutwardTotal: snapshot.outwardTotal,
    availableAfter: snapshot.availableForOutward,
    remarks:
      remarks ||
      `M3 entry on ${sourceFloor}: +${deltaQuantity} (floor total ${previousFloorTotal} → ${newFloorTotal})`,
    userId: user?.id || user?.userId || 'system',
    userName: user?.name || user?.userName || '',
    floorSupervisorId: user?.id || user?.floorSupervisorId || 'system',
  });
};

/**
 * Mark M3 quantity as outward (ledger-only; floor quantities unchanged).
 * @param {string} articleId
 * @param {Object} body
 * @param {Object} user
 * @returns {Promise<Object>}
 */
export const markM3Outward = async (articleId, body, user = {}) => {
  const { quantity, remarks } = body;

  if (!remarks || !String(remarks).trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Remarks are required for outward');
  }

  const article = await findArticleById(articleId);
  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
  }

  const snapshot = computeM3Snapshot(article);
  if (quantity <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Outward quantity must be greater than 0');
  }
  if (quantity > snapshot.availableForOutward) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot outward ${quantity} units. Available: ${snapshot.availableForOutward}`
    );
  }

  if (!article.m3Tracking) {
    article.m3Tracking = { outwardTotal: 0 };
  }
  const previousOutwardTotal = article.m3Tracking.outwardTotal || 0;
  const newOutwardTotal = previousOutwardTotal + quantity;
  article.m3Tracking.outwardTotal = newOutwardTotal;
  await article.save();

  const orderNumber = await resolveOrderNumber(article);
  const articleIdStr = article._id.toString();
  const orderIdStr = article.orderId.toString();
  const availableAfter = Math.max(0, snapshot.onHand - newOutwardTotal);

  const log = await M3Log.createLogEntry({
    type: M3LogType.OUTWARD,
    articleId: articleIdStr,
    orderId: orderIdStr,
    orderNumber,
    articleNumber: article.articleNumber || '',
    sourceFloor: null,
    quantity,
    previousOnHand: snapshot.onHand,
    newOnHand: snapshot.onHand,
    previousOutwardTotal,
    newOutwardTotal,
    availableAfter,
    remarks: String(remarks).trim(),
    userId: user?.id || 'system',
    userName: user?.name || '',
    floorSupervisorId: user?.id || 'system',
  });

  return {
    article: {
      id: article.id,
      _id: article._id,
      articleNumber: article.articleNumber,
      orderId: article.orderId,
      orderNumber,
      m3Snapshot: computeM3Snapshot(article),
    },
    log,
  };
};

/**
 * Build Mongo filter for articles with M3 activity (checking floors only).
 * @param {Object} filter
 * @returns {Object}
 */
const buildArticleM3Filter = (filter = {}) => {
  const mongoFilter = {
    $or: [
      { 'floorQuantities.checking.m3Quantity': { $gt: 0 } },
      { 'floorQuantities.secondaryChecking.m3Quantity': { $gt: 0 } },
      { 'floorQuantities.finalChecking.m3Quantity': { $gt: 0 } },
      { 'm3Tracking.outwardTotal': { $gt: 0 } },
    ],
  };

  if (filter.orderId) {
    mongoFilter.orderId = filter.orderId;
  }

  if (filter.search) {
    const q = filter.search.trim();
    mongoFilter.$and = [
      ...(mongoFilter.$and || []),
      {
        $or: [
          { articleNumber: { $regex: q, $options: 'i' } },
          { id: { $regex: q, $options: 'i' } },
        ],
      },
    ];
  }

  return mongoFilter;
};

/**
 * Paginated list of articles with M3 snapshot data.
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getM3Articles = async (filter = {}, options = {}) => {
  const mongoFilter = buildArticleM3Filter(filter);
  const page = options.page || 1;
  const limit = options.limit || 50;
  const skip = (page - 1) * limit;

  const [articles, totalResults] = await Promise.all([
    Article.find(mongoFilter)
      .sort(options.sortBy ? options.sortBy.replace(':', ' ') : { updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Article.countDocuments(mongoFilter),
  ]);

  const orderIds = [...new Set(articles.map((a) => a.orderId?.toString()).filter(Boolean))];
  const orders = await ProductionOrder.find({ _id: { $in: orderIds } })
    .select('orderNumber priority status orderNote')
    .lean();
  const orderMap = Object.fromEntries(orders.map((o) => [o._id.toString(), o]));

  const results = articles.map((article) => {
    const snapshot = computeM3Snapshot(article);
    const order = orderMap[article.orderId?.toString()] || {};
    return {
      id: article.id,
      _id: article._id,
      articleNumber: article.articleNumber,
      orderId: article.orderId,
      orderNumber: order.orderNumber || '',
      orderNote: order.orderNote || '',
      priority: article.priority,
      status: article.status,
      linkingType: article.linkingType,
      m3Snapshot: snapshot,
    };
  });

  return {
    results,
    page,
    limit,
    totalPages: Math.ceil(totalResults / limit) || 1,
    totalResults,
  };
};

/**
 * M3 summary for a single article including recent logs.
 * @param {string} articleId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getM3ArticleSummary = async (articleId, options = {}) => {
  const article = await findArticleById(articleId);
  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
  }

  const orderNumber = await resolveOrderNumber(article);
  const articleIdStr = article._id.toString();
  const logLimit = options.logLimit || 20;

  const recentLogs = await M3Log.find({ articleId: articleIdStr })
    .sort({ timestamp: -1 })
    .limit(logLimit)
    .lean();

  return {
    id: article.id,
    _id: article._id,
    articleNumber: article.articleNumber,
    orderId: article.orderId,
    orderNumber,
    m3Snapshot: computeM3Snapshot(article),
    recentLogs,
  };
};

/**
 * Paginated M3 ledger logs with filters.
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getM3Logs = async (filter = {}, options = {}) => {
  const logFilter = {};

  if (filter.articleId) logFilter.articleId = filter.articleId;
  if (filter.orderId) logFilter.orderId = filter.orderId;
  if (filter.type) logFilter.type = filter.type;
  if (filter.sourceFloor) logFilter.sourceFloor = filter.sourceFloor;
  if (filter.dateFrom || filter.dateTo) {
    logFilter.timestamp = {};
    if (filter.dateFrom) logFilter.timestamp.$gte = new Date(filter.dateFrom);
    if (filter.dateTo) logFilter.timestamp.$lte = new Date(filter.dateTo);
  }
  if (filter.search) {
    const q = filter.search.trim();
    logFilter.$or = [
      { orderNumber: { $regex: q, $options: 'i' } },
      { articleNumber: { $regex: q, $options: 'i' } },
      { remarks: { $regex: q, $options: 'i' } },
      { userName: { $regex: q, $options: 'i' } },
    ];
  }

  return M3Log.paginate(logFilter, {
    ...options,
    sortBy: options.sortBy || 'timestamp:desc',
  });
};

/**
 * Aggregate KPI stats for M3 Management dashboard.
 * @returns {Promise<Object>}
 */
export const getM3Statistics = async () => {
  const articles = await Article.find(buildArticleM3Filter()).lean();
  let totalOnHand = 0;
  let totalOutwarded = 0;
  let totalAvailable = 0;

  for (const article of articles) {
    const snap = computeM3Snapshot(article);
    totalOnHand += snap.onHand;
    totalOutwarded += snap.outwardTotal;
    totalAvailable += snap.availableForOutward;
  }

  return {
    articleCount: articles.length,
    totalOnHand,
    totalOutwarded,
    totalAvailable,
  };
};

export { FLOOR_KEY_TO_LABEL, M3_FLOOR_KEYS };
