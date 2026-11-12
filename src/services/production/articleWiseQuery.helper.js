import { Article, ArticleLog, ProductionOrder } from '../../models/production/index.js';

const SEARCH_COLLATION = { locale: 'en', strength: 2 };

const ARTICLE_PAGE_SELECT = [
  'articleNumber',
  'plannedQuantity',
  'status',
  'progress',
  'priority',
  'orderId',
  'knittingCode',
  'remarks',
  'linkingType',
  'startedAt',
  'completedAt',
].join(' ');

/**
 * Escapes user text for a literal Mongo regex.
 * @param {string} raw
 * @returns {string}
 */
const escapeRegexLiteral = (raw) => String(raw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds a Mongo clause for the current page's distinct article numbers.
 * @param {Array} pageKeys
 * @returns {object}
 */
const buildArticleNumberPageClause = (pageKeys) => {
  const normalized = pageKeys.map((key) => (key === undefined ? null : key));
  const nonBlank = [...new Set(normalized.filter((key) => key != null && key !== ''))];
  const hasBlank = normalized.some((key) => key === null || key === '');
  if (!hasBlank) return { articleNumber: { $in: nonBlank } };
  if (nonBlank.length === 0) {
    return {
      $or: [{ articleNumber: null }, { articleNumber: '' }, { articleNumber: { $exists: false } }],
    };
  }
  return {
    $or: [
      { articleNumber: { $in: nonBlank } },
      { articleNumber: null },
      { articleNumber: '' },
      { articleNumber: { $exists: false } },
    ],
  };
};

/**
 * One aggregation for the distinct-article count and the current page.
 * @param {object} match
 * @param {number} page
 * @param {number} limit
 * @param {boolean} useCollation
 * @returns {Promise<{ total: number, pageKeys: Array }>}
 */
const facetArticleKeys = async (match, page, limit, useCollation) => {
  const pipeline = [
    { $match: match },
    { $project: { articleNumber: 1 } },
    { $group: { _id: '$articleNumber' } },
    { $sort: { _id: 1 } },
    {
      $facet: {
        meta: [{ $count: 'total' }],
        page: [{ $skip: (page - 1) * limit }, { $limit: limit }],
      },
    },
  ];
  const aggregate = Article.aggregate(pipeline);
  if (useCollation) aggregate.collation(SEARCH_COLLATION);
  const [facet] = await aggregate;
  const total = facet?.meta?.[0]?.total || 0;
  const pageKeys = (facet?.page || []).map((row) => row._id);
  return { total, pageKeys };
};

/**
 * Article-wise report. Distinct article numbers are paginated in one aggregation.
 * The page query projects list fields only (no floor quantity trees, no logs unless asked).
 * Search is an indexed prefix; a substring scan runs only when the prefix matches nothing.
 * @param {object} filter
 * @param {object} options
 * @returns {Promise<object>}
 */
export const getArticleWiseData = async (filter = {}, options = {}) => {
  const { articleNumber: filterArticleNumber, knittingCode: filterKnittingCode, search, status, orderNumber } = filter;
  const limit = Math.min(parseInt(options.limit, 10) || 50, 100);
  const page = parseInt(options.page, 10) || 1;
  const logsPerArticleRaw = parseInt(options.logsPerArticle, 10);
  const logsPerArticle =
    Number.isFinite(logsPerArticleRaw) && logsPerArticleRaw >= 0 ? Math.min(logsPerArticleRaw, 100) : 20;

  const match = {};
  let useCollation = false;
  if (filterArticleNumber) {
    match.articleNumber = filterArticleNumber;
  } else if (search && typeof search === 'string' && search.trim()) {
    const escaped = escapeRegexLiteral(search.trim());
    match.$or = [{ articleNumber: new RegExp(`^${escaped}`) }, { knittingCode: new RegExp(`^${escaped}`) }];
    useCollation = true;
  }
  if (filterKnittingCode && typeof filterKnittingCode === 'string' && filterKnittingCode.trim()) {
    const escaped = escapeRegexLiteral(filterKnittingCode.trim());
    match.knittingCode = new RegExp(`^${escaped}`);
    useCollation = true;
  }
  if (status) match.status = status;

  if (orderNumber && typeof orderNumber === 'string' && orderNumber.trim()) {
    const escaped = escapeRegexLiteral(orderNumber.trim());
    const orders = await ProductionOrder.find({ orderNumber: new RegExp(`^${escaped}`) })
      .collation(SEARCH_COLLATION)
      .select('_id')
      .limit(2000)
      .lean();
    if (orders.length === 0) {
      return { results: [], page, limit, totalPages: 0, total: 0 };
    }
    match.orderId = { $in: orders.map((order) => order._id) };
  } else {
    match.orderId = { $exists: true, $ne: null };
  }

  let { total, pageKeys } = await facetArticleKeys(match, page, limit, useCollation);

  if (total === 0 && search && typeof search === 'string' && search.trim() && !filterArticleNumber) {
    const escaped = escapeRegexLiteral(search.trim());
    const contains = { $regex: escaped, $options: 'i' };
    match.$or = [{ articleNumber: contains }, { knittingCode: contains }];
    const fallback = await facetArticleKeys(match, page, limit, false);
    total = fallback.total;
    pageKeys = fallback.pageKeys;
  }

  const totalPages = Math.ceil(total / limit) || 1;
  if (pageKeys.length === 0) {
    return {
      results: [],
      page,
      limit,
      totalPages: total === 0 ? 0 : totalPages,
      total,
    };
  }

  const articles = await Article.find({
    $and: [match, buildArticleNumberPageClause(pageKeys)],
  })
    .select(ARTICLE_PAGE_SELECT)
    .populate('orderId', 'orderNumber status priority currentFloor orderNote createdAt')
    .sort({ articleNumber: 1, createdAt: -1 })
    .lean();

  const logsByArticleId = {};
  if (logsPerArticle > 0) {
    const articleIds = articles.map((article) => (article._id && article._id.toString()) || article.id);
    const allLogs = await ArticleLog.find({ articleId: { $in: articleIds } })
      .select('articleId action quantity fromFloor toFloor remarks timestamp date userId previousValue newValue qualityStatus')
      .sort({ timestamp: -1 })
      .lean();

    for (const log of allLogs) {
      const aid = log.articleId && log.articleId.toString();
      if (!aid) continue;
      if (!logsByArticleId[aid]) logsByArticleId[aid] = [];
      if (logsByArticleId[aid].length < logsPerArticle) {
        logsByArticleId[aid].push({
          id: log.id || (log._id && log._id.toString()),
          action: log.action,
          quantity: log.quantity,
          fromFloor: log.fromFloor,
          toFloor: log.toFloor,
          remarks: log.remarks,
          timestamp: log.timestamp,
          date: log.date,
          userId: log.userId,
          previousValue: log.previousValue,
          newValue: log.newValue,
          qualityStatus: log.qualityStatus,
        });
      }
    }
  }

  const byArticleNumber = {};
  for (const article of articles) {
    const orderId = article.orderId;
    if (orderId == null) continue;
    const key = article.articleNumber;
    const orderDoc = orderId._id ? orderId : { _id: orderId };
    const articleIdStr = (article._id && article._id.toString()) || article.id;
    if (!byArticleNumber[key]) {
      byArticleNumber[key] = { factoryCode: key, articleNumber: key, orders: [] };
    }
    byArticleNumber[key].orders.push({
      articleId: articleIdStr,
      orderId: orderDoc._id || null,
      orderNumber: orderId.orderNumber,
      orderStatus: orderId.status,
      orderPriority: orderId.priority,
      orderCurrentFloor: orderId.currentFloor,
      orderNote: orderId.orderNote,
      orderCreatedAt: orderId.createdAt || orderId.created_at,
      plannedQuantity: article.plannedQuantity,
      knittingCode: article.knittingCode,
      status: article.status,
      progress: article.progress,
      linkingType: article.linkingType,
      priority: article.priority,
      remarks: article.remarks,
      machineId: article.machineId || null,
      machine: null,
      startedAt: article.startedAt,
      completedAt: article.completedAt,
      logs: logsByArticleId[articleIdStr] || [],
    });
  }

  const results = [];
  for (const group of pageKeys) {
    const row = byArticleNumber[group];
    if (row) results.push(row);
  }

  return { results, page, limit, totalPages, total };
};
