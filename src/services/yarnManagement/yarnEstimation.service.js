import httpStatus from 'http-status';
import { ProductionOrder, Article } from '../../models/production/index.js';
import Product from '../../models/product.model.js';
import { YarnTransaction } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

const toNumber = (v) => Number(v ?? 0);

/**
 * Article ObjectIds currently on the production order (`order.articles`).
 * Do not use `Article.find({ orderId })` for totals: lines removed from an order may still
 * carry a stale `orderId`, which inflates count and planned qty vs the production order screen.
 * @param {{ articles?: unknown[] }} order
 * @returns {import('mongoose').Types.ObjectId[]}
 */
const getArticleIdsFromOrder = (order) => {
  const raw = order?.articles || [];
  return raw
    .map((a) => {
      if (a == null) return null;
      if (typeof a === 'object' && a._id != null) return a._id;
      return a;
    })
    .filter(Boolean);
};

/**
 * Per-article production quantities for yarn estimation UI.
 * Uses knitting completed (not linking received/completed); batch weight stays on knitting.
 * @param {Object} articleLean - Article document (lean or mongoose doc with floorQuantities)
 * @returns {Object}
 */
const buildArticleFloorProgress = (articleLean) => {
  const fq = articleLean.floorQuantities || {};
  const knit = fq.knitting || {};
  const linkingInFlow = articleLean.linkingType !== 'Auto Linking';

  return {
    linkingType: articleLean.linkingType || null,
    currentFloor: articleLean.currentFloor || null,
    linkingFloorInFlow: linkingInFlow,
    plannedQuantity: toNumber(articleLean.plannedQuantity),
    knitting: {
      received: toNumber(knit.received),
      completed: toNumber(knit.completed),
      transferred: toNumber(knit.transferred),
      remaining: toNumber(knit.remaining),
      weight: toNumber(knit.weight),
      m4Quantity: toNumber(knit.m4Quantity),
    },
    /** Knitting completed paired with batch weight (for knit→link context in UI). */
    knitToLinking: {
      knittingCompleted: toNumber(knit.completed),
      batchWeightFromKnitting: toNumber(knit.weight),
    },
  };
};

/**
 * Build a yarn-wise issue / return / consumption summary from raw transactions.
 * Returns a Map keyed by yarnCatalogId string.
 */
const buildYarnSummaryFromTransactions = (transactions) => {
  const map = new Map();

  for (const txn of transactions) {
    const catalogId = (txn.yarnCatalogId?._id || txn.yarnCatalogId || '').toString();
    if (!catalogId) continue;

    if (!map.has(catalogId)) {
      const catalogInfo = typeof txn.yarnCatalogId === 'object' && txn.yarnCatalogId !== null
        ? txn.yarnCatalogId
        : null;

      map.set(catalogId, {
        yarnCatalogId: catalogId,
        yarnName: txn.yarnName || catalogInfo?.yarnName || '',
        yarnType: catalogInfo?.yarnType || null,
        issued: { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0, count: 0 },
        returned: { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0, count: 0 },
        consumption: { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0 },
        transactions: [],
      });
    }

    const entry = map.get(catalogId);
    entry.transactions.push(txn);

    if (txn.transactionType === 'yarn_issued') {
      entry.issued.totalWeight += toNumber(txn.transactionTotalWeight);
      entry.issued.netWeight += toNumber(txn.transactionNetWeight);
      entry.issued.tearWeight += toNumber(txn.transactionTearWeight);
      entry.issued.cones += toNumber(txn.transactionConeCount);
      entry.issued.count += 1;
    } else if (txn.transactionType === 'yarn_returned') {
      entry.returned.totalWeight += toNumber(txn.transactionTotalWeight);
      entry.returned.netWeight += toNumber(txn.transactionNetWeight);
      entry.returned.tearWeight += toNumber(txn.transactionTearWeight);
      entry.returned.cones += toNumber(txn.transactionConeCount);
      entry.returned.count += 1;
    }
  }

  for (const entry of map.values()) {
    entry.consumption.totalWeight = Math.max(0, entry.issued.totalWeight - entry.returned.totalWeight);
    entry.consumption.netWeight = Math.max(0, entry.issued.netWeight - entry.returned.netWeight);
    entry.consumption.tearWeight = Math.max(0, entry.issued.tearWeight - entry.returned.tearWeight);
    entry.consumption.cones = Math.max(0, entry.issued.cones - entry.returned.cones);
  }

  return map;
};

/**
 * Get yarn estimation for a single article.
 * Returns BOM yarns + issue/return/consumption from transactions.
 *
 * @param {string} articleId - Article _id (MongoDB ObjectId)
 * @param {Object} [options]
 * @param {boolean} [options.includeTransactions=false] - embed raw transaction docs
 * @returns {Promise<Object>}
 */
export const getYarnEstimationByArticle = async (articleId, options = {}) => {
  const { includeTransactions = false } = options;

  const article = await Article.findById(articleId)
    .select('articleNumber plannedQuantity status progress orderId linkingType currentFloor floorQuantities')
    .populate('orderId', 'orderNumber');

  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
  }

  const product = await Product.findOne({ factoryCode: article.articleNumber })
    .populate('bom.yarnCatalogId', 'yarnName yarnType countSize blend colorFamily')
    .select('bom name factoryCode')
    .lean();

  const bomYarns = (product?.bom || [])
    .filter((b) => b.yarnCatalogId)
    .map((b) => ({
      yarnCatalogId: (b.yarnCatalogId._id || b.yarnCatalogId).toString(),
      yarnName: b.yarnCatalogId.yarnName || b.yarnName || '',
      yarnType: b.yarnCatalogId.yarnType || null,
      countSize: b.yarnCatalogId.countSize || null,
      blend: b.yarnCatalogId.blend || null,
      colorFamily: b.yarnCatalogId.colorFamily || null,
      bomQuantity: b.quantity || 0,
    }));

  // Collect BOM yarnCatalogIds so we can also match transactions that lack articleId/articleNumber
  const bomCatalogIds = bomYarns.map((b) => b.yarnCatalogId).filter(Boolean);

  const txnQuery = {
    orderId: article.orderId._id || article.orderId,
    transactionType: { $in: ['yarn_issued', 'yarn_returned'] },
    $or: [
      { articleId: article._id },
      { articleNumber: article.articleNumber },
      // Match transactions that have no article ref but their yarn is in this article's BOM
      ...(bomCatalogIds.length > 0
        ? [{
            articleId: { $exists: false },
            articleNumber: { $exists: false },
            yarnCatalogId: { $in: bomCatalogIds },
          }, {
            articleId: null,
            articleNumber: null,
            yarnCatalogId: { $in: bomCatalogIds },
          }, {
            articleId: null,
            articleNumber: { $in: [null, ''] },
            yarnCatalogId: { $in: bomCatalogIds },
          }]
        : []),
    ],
  };

  const transactions = await YarnTransaction.find(txnQuery)
    .populate({ path: 'yarnCatalogId', select: '_id yarnName yarnType' })
    .sort({ transactionDate: -1 })
    .lean();

  const yarnSummary = buildYarnSummaryFromTransactions(transactions);

  // Merge BOM yarns with transaction data
  const yarns = [];
  const processedCatalogIds = new Set();

  for (const bom of bomYarns) {
    const txnData = yarnSummary.get(bom.yarnCatalogId);
    processedCatalogIds.add(bom.yarnCatalogId);

    yarns.push({
      yarnCatalogId: bom.yarnCatalogId,
      yarnName: bom.yarnName,
      yarnType: bom.yarnType,
      countSize: bom.countSize,
      blend: bom.blend,
      colorFamily: bom.colorFamily,
      bomQuantity: bom.bomQuantity,
      issued: txnData?.issued || { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0, count: 0 },
      returned: txnData?.returned || { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0, count: 0 },
      consumption: txnData?.consumption || { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0 },
      ...(includeTransactions ? { transactions: txnData?.transactions || [] } : {}),
    });
  }

  // Include yarns that have transactions but are NOT in BOM
  for (const [catalogId, txnData] of yarnSummary.entries()) {
    if (!processedCatalogIds.has(catalogId)) {
      yarns.push({
        yarnCatalogId: catalogId,
        yarnName: txnData.yarnName,
        yarnType: txnData.yarnType,
        countSize: null,
        blend: null,
        colorFamily: null,
        bomQuantity: 0,
        issued: txnData.issued,
        returned: txnData.returned,
        consumption: txnData.consumption,
        ...(includeTransactions ? { transactions: txnData.transactions } : {}),
      });
    }
  }

  const floorProgress = buildArticleFloorProgress(article);

  return {
    articleId: article._id,
    articleNumber: article.articleNumber,
    plannedQuantity: article.plannedQuantity,
    status: article.status,
    progress: article.progress,
    orderId: article.orderId._id || article.orderId,
    orderNumber: article.orderId.orderNumber || null,
    productName: product?.name || null,
    floorProgress,
    yarns,
    totals: {
      issued: {
        totalWeight: yarns.reduce((s, y) => s + y.issued.totalWeight, 0),
        netWeight: yarns.reduce((s, y) => s + y.issued.netWeight, 0),
        tearWeight: yarns.reduce((s, y) => s + y.issued.tearWeight, 0),
        cones: yarns.reduce((s, y) => s + y.issued.cones, 0),
      },
      returned: {
        totalWeight: yarns.reduce((s, y) => s + y.returned.totalWeight, 0),
        netWeight: yarns.reduce((s, y) => s + y.returned.netWeight, 0),
        tearWeight: yarns.reduce((s, y) => s + y.returned.tearWeight, 0),
        cones: yarns.reduce((s, y) => s + y.returned.cones, 0),
      },
      consumption: {
        totalWeight: yarns.reduce((s, y) => s + y.consumption.totalWeight, 0),
        netWeight: yarns.reduce((s, y) => s + y.consumption.netWeight, 0),
        tearWeight: yarns.reduce((s, y) => s + y.consumption.tearWeight, 0),
        cones: yarns.reduce((s, y) => s + y.consumption.cones, 0),
      },
    },
  };
};

/**
 * Get yarn estimation for all articles within a production order.
 *
 * @param {string} orderId - ProductionOrder _id (MongoDB ObjectId)
 * @param {Object} [options]
 * @param {boolean} [options.includeTransactions=false]
 * @returns {Promise<Object>}
 */
export const getYarnEstimationByOrder = async (orderId, options = {}) => {
  const { includeTransactions = false } = options;

  const order = await ProductionOrder.findById(orderId)
    .select('orderNumber status priority articles')
    .lean();

  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  }

  const articleIds = getArticleIdsFromOrder(order);
  const articles = articleIds.length
    ? await Article.find({ _id: { $in: articleIds } })
        .select('articleNumber plannedQuantity status progress linkingType currentFloor floorQuantities')
        .lean()
    : [];

  if (!articles || articles.length === 0) {
    return {
      orderId: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      priority: order.priority,
      articles: [],
      orderTotals: {
        issued: { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0 },
        returned: { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0 },
        consumption: { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0 },
      },
      orderFloorProgress: {
        plannedQuantityTotal: 0,
        knittingCompletedTotal: 0,
        knittingM4QuantityTotal: 0,
        knittingBatchWeightTotal: 0,
      },
    };
  }

  // Batch-load all transactions for this order in one query
  const allTransactions = await YarnTransaction.find({
    orderId: order._id,
    transactionType: { $in: ['yarn_issued', 'yarn_returned'] },
  })
    .populate({ path: 'yarnCatalogId', select: '_id yarnName yarnType' })
    .sort({ transactionDate: -1 })
    .lean();

  // Batch-load products for all articles (needed for BOM-based matching)
  const factoryCodes = [...new Set(articles.map((a) => a.articleNumber).filter(Boolean))];
  const products = await Product.find({ factoryCode: { $in: factoryCodes } })
    .populate('bom.yarnCatalogId', 'yarnName yarnType countSize blend colorFamily')
    .select('bom name factoryCode')
    .lean();

  const productMap = new Map();
  for (const p of products) {
    productMap.set(p.factoryCode, p);
  }

  // Build reverse map: yarnCatalogId → articleId (from BOM) for matching untagged transactions
  const yarnToArticleMap = new Map();
  for (const art of articles) {
    const product = productMap.get(art.articleNumber);
    if (!product?.bom) continue;
    for (const bomItem of product.bom) {
      const catalogId = (bomItem.yarnCatalogId?._id || bomItem.yarnCatalogId || '').toString();
      if (catalogId) {
        if (!yarnToArticleMap.has(catalogId)) yarnToArticleMap.set(catalogId, []);
        yarnToArticleMap.get(catalogId).push(art._id.toString());
      }
    }
  }

  // Group transactions by articleId / articleNumber, then fall back to BOM match
  const txnByArticle = new Map();

  for (const txn of allTransactions) {
    const artIdStr = txn.articleId?.toString();
    const artNum = txn.articleNumber;
    let matched = false;

    // 1st pass: match by articleId or articleNumber
    for (const art of articles) {
      if (
        (artIdStr && artIdStr === art._id.toString()) ||
        (artNum && artNum === art.articleNumber)
      ) {
        const key = art._id.toString();
        if (!txnByArticle.has(key)) txnByArticle.set(key, []);
        txnByArticle.get(key).push(txn);
        matched = true;
        break;
      }
    }

    // 2nd pass: match via BOM yarnCatalogId when articleId/articleNumber missing
    if (!matched) {
      const txnCatalogId = (txn.yarnCatalogId?._id || txn.yarnCatalogId || '').toString();
      const candidateArticleIds = yarnToArticleMap.get(txnCatalogId);
      if (candidateArticleIds && candidateArticleIds.length > 0) {
        for (const artId of candidateArticleIds) {
          if (!txnByArticle.has(artId)) txnByArticle.set(artId, []);
          txnByArticle.get(artId).push(txn);
        }
        matched = true;
      }
    }

    // Transactions that still don't match any article are ignored at article level
    // but still counted in order-level totals below
  }

  // Build per-article estimation
  const articleEstimations = [];

  for (const art of articles) {
    const product = productMap.get(art.articleNumber);
    const artTransactions = txnByArticle.get(art._id.toString()) || [];
    const yarnSummary = buildYarnSummaryFromTransactions(artTransactions);

    const bomYarns = (product?.bom || [])
      .filter((b) => b.yarnCatalogId)
      .map((b) => ({
        yarnCatalogId: (b.yarnCatalogId._id || b.yarnCatalogId).toString(),
        yarnName: b.yarnCatalogId.yarnName || b.yarnName || '',
        yarnType: b.yarnCatalogId.yarnType || null,
        countSize: b.yarnCatalogId.countSize || null,
        blend: b.yarnCatalogId.blend || null,
        colorFamily: b.yarnCatalogId.colorFamily || null,
        bomQuantity: b.quantity || 0,
      }));

    const yarns = [];
    const processedCatalogIds = new Set();

    for (const bom of bomYarns) {
      const txnData = yarnSummary.get(bom.yarnCatalogId);
      processedCatalogIds.add(bom.yarnCatalogId);

      yarns.push({
        yarnCatalogId: bom.yarnCatalogId,
        yarnName: bom.yarnName,
        yarnType: bom.yarnType,
        countSize: bom.countSize,
        blend: bom.blend,
        colorFamily: bom.colorFamily,
        bomQuantity: bom.bomQuantity,
        issued: txnData?.issued || { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0, count: 0 },
        returned: txnData?.returned || { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0, count: 0 },
        consumption: txnData?.consumption || { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0 },
        ...(includeTransactions ? { transactions: txnData?.transactions || [] } : {}),
      });
    }

    for (const [catalogId, txnData] of yarnSummary.entries()) {
      if (!processedCatalogIds.has(catalogId)) {
        yarns.push({
          yarnCatalogId: catalogId,
          yarnName: txnData.yarnName,
          yarnType: txnData.yarnType,
          countSize: null,
          blend: null,
          colorFamily: null,
          bomQuantity: 0,
          issued: txnData.issued,
          returned: txnData.returned,
          consumption: txnData.consumption,
          ...(includeTransactions ? { transactions: txnData.transactions } : {}),
        });
      }
    }

    articleEstimations.push({
      articleId: art._id,
      articleNumber: art.articleNumber,
      plannedQuantity: art.plannedQuantity,
      status: art.status,
      progress: art.progress,
      productName: product?.name || null,
      floorProgress: buildArticleFloorProgress(art),
      yarns,
      totals: {
        issued: {
          totalWeight: yarns.reduce((s, y) => s + y.issued.totalWeight, 0),
          netWeight: yarns.reduce((s, y) => s + y.issued.netWeight, 0),
          tearWeight: yarns.reduce((s, y) => s + y.issued.tearWeight, 0),
          cones: yarns.reduce((s, y) => s + y.issued.cones, 0),
        },
        returned: {
          totalWeight: yarns.reduce((s, y) => s + y.returned.totalWeight, 0),
          netWeight: yarns.reduce((s, y) => s + y.returned.netWeight, 0),
          tearWeight: yarns.reduce((s, y) => s + y.returned.tearWeight, 0),
          cones: yarns.reduce((s, y) => s + y.returned.cones, 0),
        },
        consumption: {
          totalWeight: yarns.reduce((s, y) => s + y.consumption.totalWeight, 0),
          netWeight: yarns.reduce((s, y) => s + y.consumption.netWeight, 0),
          tearWeight: yarns.reduce((s, y) => s + y.consumption.tearWeight, 0),
          cones: yarns.reduce((s, y) => s + y.consumption.cones, 0),
        },
      },
    });
  }

  // Order-level totals: computed from ALL transactions (not per-article sums)
  // to ensure unmatched transactions are still counted
  const allYarnSummary = buildYarnSummaryFromTransactions(allTransactions);
  const orderTotals = {
    issued: { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0 },
    returned: { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0 },
    consumption: { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0 },
  };

  for (const entry of allYarnSummary.values()) {
    orderTotals.issued.totalWeight += entry.issued.totalWeight;
    orderTotals.issued.netWeight += entry.issued.netWeight;
    orderTotals.issued.tearWeight += entry.issued.tearWeight;
    orderTotals.issued.cones += entry.issued.cones;
    orderTotals.returned.totalWeight += entry.returned.totalWeight;
    orderTotals.returned.netWeight += entry.returned.netWeight;
    orderTotals.returned.tearWeight += entry.returned.tearWeight;
    orderTotals.returned.cones += entry.returned.cones;
    orderTotals.consumption.totalWeight += entry.consumption.totalWeight;
    orderTotals.consumption.netWeight += entry.consumption.netWeight;
    orderTotals.consumption.tearWeight += entry.consumption.tearWeight;
    orderTotals.consumption.cones += entry.consumption.cones;
  }

  const orderFloorProgress = {
    plannedQuantityTotal: articleEstimations.reduce((s, a) => s + toNumber(a.plannedQuantity), 0),
    knittingCompletedTotal: articleEstimations.reduce(
      (s, a) => s + toNumber(a.floorProgress?.knitting?.completed),
      0
    ),
    knittingM4QuantityTotal: articleEstimations.reduce(
      (s, a) => s + toNumber(a.floorProgress?.knitting?.m4Quantity),
      0
    ),
    knittingBatchWeightTotal: articleEstimations.reduce(
      (s, a) => s + toNumber(a.floorProgress?.knitting?.weight),
      0
    ),
  };

  return {
    orderId: order._id,
    orderNumber: order.orderNumber,
    status: order.status,
    priority: order.priority,
    articles: articleEstimations,
    orderTotals,
    orderFloorProgress,
  };
};

/**
 * Get yarn estimation summary across multiple orders.
 * Useful for a dashboard / overview screen.
 *
 * @param {Object} [filters]
 * @param {string} [filters.status] - Filter orders by status
 * @param {string} [filters.search] - Search by orderNumber or articleNumber
 * @param {number} [filters.limit=50]
 * @param {number} [filters.page=1]
 * @returns {Promise<Object>} Each result row includes `orderFloorProgress`:
 *   plannedQuantityTotal, knittingCompletedTotal, knittingM4QuantityTotal, knittingBatchWeightTotal (sums over articles).
 */
export const getYarnEstimationSummary = async (filters = {}) => {
  const { status, search, limit = 50, page = 1 } = filters;

  const orderQuery = {};
  if (status) orderQuery.status = status;
  if (search) {
    const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const matchingArticles = await Article.find({ articleNumber: searchRegex }).distinct('orderId');
    orderQuery.$or = [
      { orderNumber: searchRegex },
      ...(matchingArticles.length > 0 ? [{ _id: { $in: matchingArticles } }] : []),
    ];
  }

  const skip = (Math.max(page, 1) - 1) * limit;
  const [orders, totalCount] = await Promise.all([
    ProductionOrder.find(orderQuery)
      .select('orderNumber status priority articles')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ProductionOrder.countDocuments(orderQuery),
  ]);

  if (!orders.length) {
    return { results: [], totalResults: totalCount, page, limit, totalPages: 0 };
  }

  const orderIds = orders.map((o) => o._id);

  // Aggregate issue/return totals per order
  const aggregation = await YarnTransaction.aggregate([
    {
      $match: {
        orderId: { $in: orderIds },
        transactionType: { $in: ['yarn_issued', 'yarn_returned'] },
      },
    },
    {
      $group: {
        _id: { orderId: '$orderId', transactionType: '$transactionType' },
        totalWeight: { $sum: '$transactionTotalWeight' },
        netWeight: { $sum: '$transactionNetWeight' },
        tearWeight: { $sum: '$transactionTearWeight' },
        cones: { $sum: '$transactionConeCount' },
        count: { $sum: 1 },
      },
    },
  ]);

  const txnMap = new Map();
  for (const row of aggregation) {
    const key = row._id.orderId.toString();
    if (!txnMap.has(key)) {
      txnMap.set(key, {
        issued: { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0, count: 0 },
        returned: { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0, count: 0 },
      });
    }
    const bucket = row._id.transactionType === 'yarn_issued' ? 'issued' : 'returned';
    const entry = txnMap.get(key);
    entry[bucket].totalWeight = row.totalWeight;
    entry[bucket].netWeight = row.netWeight;
    entry[bucket].tearWeight = row.tearWeight;
    entry[bucket].cones = row.cones;
    entry[bucket].count = row.count;
  }

  // Totals from articles on `order.articles` only (same as production order UI)
  const articleAgg = await ProductionOrder.aggregate([
    { $match: { _id: { $in: orderIds } } },
    {
      $lookup: {
        from: 'articles',
        localField: 'articles',
        foreignField: '_id',
        as: 'articleDocs',
      },
    },
    { $unwind: { path: '$articleDocs', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: '$_id',
        count: {
          $sum: { $cond: [{ $ifNull: ['$articleDocs._id', false] }, 1, 0] },
        },
        plannedQuantityTotal: { $sum: { $ifNull: ['$articleDocs.plannedQuantity', 0] } },
        knittingCompletedTotal: { $sum: { $ifNull: ['$articleDocs.floorQuantities.knitting.completed', 0] } },
        knittingM4QuantityTotal: { $sum: { $ifNull: ['$articleDocs.floorQuantities.knitting.m4Quantity', 0] } },
        knittingBatchWeightTotal: { $sum: { $ifNull: ['$articleDocs.floorQuantities.knitting.weight', 0] } },
      },
    },
  ]);

  const countMap = new Map();
  const floorProgressByOrder = new Map();
  for (const row of articleAgg) {
    const key = row._id.toString();
    countMap.set(key, row.count);
    floorProgressByOrder.set(key, {
      plannedQuantityTotal: toNumber(row.plannedQuantityTotal),
      knittingCompletedTotal: toNumber(row.knittingCompletedTotal),
      knittingM4QuantityTotal: toNumber(row.knittingM4QuantityTotal),
      knittingBatchWeightTotal: toNumber(row.knittingBatchWeightTotal),
    });
  }

  const results = orders.map((order) => {
    const key = order._id.toString();
    const txn = txnMap.get(key) || {
      issued: { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0, count: 0 },
      returned: { totalWeight: 0, netWeight: 0, tearWeight: 0, cones: 0, count: 0 },
    };

    return {
      orderId: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      priority: order.priority,
      articleCount: countMap.get(key) || 0,
      orderFloorProgress: floorProgressByOrder.get(key) ?? {
        plannedQuantityTotal: 0,
        knittingCompletedTotal: 0,
        knittingM4QuantityTotal: 0,
        knittingBatchWeightTotal: 0,
      },
      issued: txn.issued,
      returned: txn.returned,
      consumption: {
        totalWeight: Math.max(0, txn.issued.totalWeight - txn.returned.totalWeight),
        netWeight: Math.max(0, txn.issued.netWeight - txn.returned.netWeight),
        tearWeight: Math.max(0, txn.issued.tearWeight - txn.returned.tearWeight),
        cones: Math.max(0, txn.issued.cones - txn.returned.cones),
      },
    };
  });

  return {
    results,
    totalResults: totalCount,
    page,
    limit,
    totalPages: Math.ceil(totalCount / limit),
  };
};
