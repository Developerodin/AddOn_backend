import httpStatus from 'http-status';
import { ProductionOrder, Article, ArticleLog, FloorStatistics } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';
import { 
  ALL_FLOOR_NAMES,
  ALL_FLOOR_KEYS,
  getFloorKeyFromName,
  getFloorNameFromKey,
  getFloorData, 
  aggregateFloorStats,
  getTotalCompletedQuantity,
  getTotalWipQuantity
} from '../../utils/floorLabelMap.js';

/**
 * Get production dashboard data
 * @param {Object} filter
 * @returns {Promise<Object>}
 */
export const getProductionDashboard = async (filter) => {
  const { dateFrom, dateTo, floor } = filter;
  const today = new Date().toISOString().split('T')[0];
  const startDate = dateFrom || today;
  const endDate = dateTo || today;

  // Get overall statistics
  const totalOrders = await ProductionOrder.countDocuments({
    createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
  });

  const completedOrders = await ProductionOrder.countDocuments({
    status: 'Completed',
    updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
  });

  const inProgressOrders = await ProductionOrder.countDocuments({
    status: 'In Progress',
    updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
  });

  const onHoldOrders = await ProductionOrder.countDocuments({
    status: 'On Hold',
    updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
  });

  // Get floor-specific data if floor filter is applied
  let floorData = null;
  if (floor) {
    const floorKey = getFloorKeyFromName(floor);
    if (floorKey) {
      // Find articles with WIP on this floor
      const floorArticles = await Article.find({
        [`floorQuantities.${floorKey}.remaining`]: { $gt: 0 },
        updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
      }).select('plannedQuantity floorQuantities');

      const stats = aggregateFloorStats(floorArticles, floorKey);

      floorData = {
        floor,
        totalOrders: floorArticles.length,
        totalQuantity: stats.totalReceived,
        completedQuantity: stats.totalCompleted,
        wipQuantity: stats.totalRemaining,
        efficiency: stats.totalReceived > 0 ? Math.round((stats.totalCompleted / stats.totalReceived) * 100) : 0
      };
    }
  }

  // Get recent activity
  const recentActivity = await ArticleLog.find({
    timestamp: { $gte: new Date(startDate), $lte: new Date(endDate) }
  })
  .sort({ timestamp: -1 })
  .limit(20)
  .populate('articleId', 'articleNumber')
  .populate('orderId', 'orderNumber')
  .populate('userId', 'name email');

  // Get floor statistics using correct field paths
  const floorStatistics = await Promise.all(
    ALL_FLOOR_NAMES.map(async (floorName) => {
      const floorKey = getFloorKeyFromName(floorName);
      
      // Find articles with activity on this floor (received > 0 or remaining > 0)
      const floorArticles = await Article.find({
        $or: [
          { [`floorQuantities.${floorKey}.received`]: { $gt: 0 } },
          { [`floorQuantities.${floorKey}.remaining`]: { $gt: 0 } }
        ],
        updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
      }).select('plannedQuantity floorQuantities');

      const stats = aggregateFloorStats(floorArticles, floorKey);

      return {
        floor: floorName,
        floorKey,
        orderCount: stats.articleCount,
        articleCount: stats.articlesWithWip,
        totalQuantity: stats.totalReceived,
        completedQuantity: stats.totalCompleted,
        wipQuantity: stats.totalRemaining,
        transferredQuantity: stats.totalTransferred,
        m1Quantity: stats.m1Total,
        m2Quantity: stats.m2Total,
        m3Quantity: stats.m3Total,
        m4Quantity: stats.m4Total,
        efficiency: stats.totalReceived > 0 ? Math.round((stats.totalCompleted / stats.totalReceived) * 100) : 0
      };
    })
  );

  return {
    summary: {
      totalOrders,
      completedOrders,
      inProgressOrders,
      onHoldOrders,
      completionRate: totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0
    },
    floorData,
    floorStatistics,
    recentActivity: recentActivity.map(log => ({
      id: log._id,
      action: log.action,
      quantity: log.quantity,
      fromFloor: log.fromFloor,
      toFloor: log.toFloor,
      remarks: log.remarks,
      timestamp: log.timestamp,
      article: log.articleId ? {
        id: log.articleId._id,
        articleNumber: log.articleId.articleNumber
      } : null,
      order: log.orderId ? {
        id: log.orderId._id,
        orderNumber: log.orderId.orderNumber
      } : null,
      user: log.userId ? {
        id: log.userId._id,
        name: log.userId.name,
        email: log.userId.email
      } : null
    })),
    dateRange: { startDate, endDate }
  };
};

/**
 * Get efficiency report
 * @param {Object} filter
 * @returns {Promise<Object>}
 */
export const getEfficiencyReport = async (filter) => {
  const { floor, dateFrom, dateTo } = filter;
  const today = new Date().toISOString().split('T')[0];
  const startDate = dateFrom || today;
  const endDate = dateTo || today;

  const floors = floor ? [floor] : ALL_FLOOR_NAMES;

  const efficiencyData = await Promise.all(
    floors.map(async (floorName) => {
      const floorKey = getFloorKeyFromName(floorName);
      
      // Get articles with activity on this floor (received > 0)
      const articles = await Article.find({
        [`floorQuantities.${floorKey}.received`]: { $gt: 0 },
        updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
      }).select('plannedQuantity status floorQuantities startedAt completedAt');

      const totalArticles = articles.length;
      const completedArticles = articles.filter(article => article.status === 'Completed').length;
      const completionRate = totalArticles > 0 ? Math.round((completedArticles / totalArticles) * 100) : 0;

      // Calculate quantity efficiency using floor-specific data
      const stats = aggregateFloorStats(articles, floorKey);
      const quantityEfficiency = stats.totalReceived > 0 ? 
        Math.round((stats.totalCompleted / stats.totalReceived) * 100) : 0;

      // Calculate average processing time
      const completedWithTimes = articles.filter(article => 
        article.status === 'Completed' && article.startedAt && article.completedAt
      );

      let averageProcessingTime = 0;
      if (completedWithTimes.length > 0) {
        const totalTime = completedWithTimes.reduce((sum, article) => {
          const startTime = new Date(article.startedAt);
          const endTime = new Date(article.completedAt);
          return sum + (endTime - startTime);
        }, 0);
        
        averageProcessingTime = Math.round(totalTime / completedWithTimes.length / (1000 * 60 * 60)); // Convert to hours
      }

      // Get daily efficiency trend
      const dailyTrend = await getDailyEfficiencyTrend(floorName, startDate, endDate);

      return {
        floor: floorName,
        floorKey,
        metrics: {
          totalArticles,
          completedArticles,
          completionRate,
          totalPlannedQuantity: stats.totalReceived,
          totalCompletedQuantity: stats.totalCompleted,
          wipQuantity: stats.totalRemaining,
          quantityEfficiency,
          averageProcessingTime
        },
        dailyTrend
      };
    })
  );

  return {
    efficiencyData,
    summary: {
      totalFloors: floors.length,
      averageCompletionRate: Math.round(
        efficiencyData.reduce((sum, floor) => sum + floor.metrics.completionRate, 0) / floors.length
      ),
      averageQuantityEfficiency: Math.round(
        efficiencyData.reduce((sum, floor) => sum + floor.metrics.quantityEfficiency, 0) / floors.length
      )
    },
    dateRange: { startDate, endDate }
  };
};

/**
 * Get quality report
 * @param {Object} filter
 * @returns {Promise<Object>}
 */
export const getQualityReport = async (filter) => {
  const { floor, dateFrom, dateTo } = filter;
  const today = new Date().toISOString().split('T')[0];
  const startDate = dateFrom || today;
  const endDate = dateTo || today;

  // Focus on Final Checking floor for quality metrics (or specified QC floor)
  const qualityFloor = floor || 'Final Checking';
  const floorKey = getFloorKeyFromName(qualityFloor) || 'finalChecking';
  
  // Find articles that have received items on the QC floor
  const articles = await Article.find({
    [`floorQuantities.${floorKey}.received`]: { $gt: 0 },
    updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
  }).select('articleNumber orderId floorQuantities finalQualityConfirmed');

  // Calculate quality metrics from floorQuantities
  const totalArticles = articles.length;
  const qualityCheckedArticles = articles.filter(article => {
    const fd = getFloorData(article.floorQuantities, floorKey);
    return fd.m1Quantity + fd.m2Quantity + fd.m3Quantity + fd.m4Quantity > 0;
  }).length;

  // Aggregate quality quantities from the floor data
  const stats = aggregateFloorStats(articles, floorKey);
  const m1Quantity = stats.m1Total;
  const m2Quantity = stats.m2Total;
  const m3Quantity = stats.m3Total;
  const m4Quantity = stats.m4Total;

  const totalQualityQuantity = m1Quantity + m2Quantity + m3Quantity + m4Quantity;
  const qualityRate = totalQualityQuantity > 0 ? Math.round((m1Quantity / totalQualityQuantity) * 100) : 0;
  const repairRate = totalQualityQuantity > 0 ? 
    Math.round(((m2Quantity + m3Quantity + m4Quantity) / totalQualityQuantity) * 100) : 0;

  // Get quality trends over time
  const qualityTrend = await getQualityTrend(qualityFloor, startDate, endDate);

  // Get articles with quality issues
  const qualityIssues = articles.filter(article => {
    const fd = getFloorData(article.floorQuantities, floorKey);
    return fd.m2Quantity > 0 || fd.m3Quantity > 0 || fd.m4Quantity > 0;
  }).map(article => {
    const fd = getFloorData(article.floorQuantities, floorKey);
    const floorData = article.floorQuantities?.[floorKey] || {};
    return {
      id: article._id,
      articleNumber: article.articleNumber,
      orderId: article.orderId?.toString(),
      m1Quantity: fd.m1Quantity,
      m2Quantity: fd.m2Quantity,
      m3Quantity: fd.m3Quantity,
      m4Quantity: fd.m4Quantity,
      repairStatus: floorData.repairStatus,
      repairRemarks: floorData.repairRemarks,
      finalQualityConfirmed: article.finalQualityConfirmed
    };
  });

  return {
    summary: {
      totalArticles,
      qualityCheckedArticles,
      qualityCheckRate: totalArticles > 0 ? Math.round((qualityCheckedArticles / totalArticles) * 100) : 0,
      totalQualityQuantity,
      m1Quantity,
      m2Quantity,
      m3Quantity,
      m4Quantity,
      qualityRate,
      repairRate,
      firstPassYield: stats.totalReceived > 0 ? Math.round((m1Quantity / stats.totalReceived) * 100) : 0
    },
    qualityTrend,
    qualityIssues,
    dateRange: { startDate, endDate }
  };
};

/**
 * Get order tracking report
 * @param {ObjectId} orderId
 * @returns {Promise<Object>}
 */
export const getOrderTrackingReport = async (orderId) => {
  const order = await ProductionOrder.findById(orderId).populate('articles');
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  }

  // Get order logs
  const logs = await ArticleLog.find({ orderId })
    .sort({ timestamp: 1 })
    .populate('articleId', 'articleNumber')
    .populate('userId', 'name email');

  // Calculate order progress
  const totalArticles = order.articles.length;
  const completedArticles = order.articles.filter(article => article.status === 'Completed').length;
  const inProgressArticles = order.articles.filter(article => article.status === 'In Progress').length;
  const pendingArticles = order.articles.filter(article => article.status === 'Pending').length;

  // Calculate overall progress using floorQuantities
  const totalPlannedQuantity = order.articles.reduce((sum, article) => sum + article.plannedQuantity, 0);
  const totalCompletedQuantity = order.articles.reduce((sum, article) => {
    // Sum up dispatched quantity as the true "completed"
    return sum + (article.floorQuantities?.dispatch?.transferred || 0);
  }, 0);
  const overallProgress = totalPlannedQuantity > 0 ? 
    Math.round((totalCompletedQuantity / totalPlannedQuantity) * 100) : 0;

  // Get floor-wise progress from floorQuantities
  const floorProgress = {};
  for (const floorKey of ALL_FLOOR_KEYS) {
    const floorName = getFloorNameFromKey(floorKey);
    if (!floorName) continue;
    
    let totalReceived = 0;
    let totalCompleted = 0;
    let totalRemaining = 0;
    let articlesOnFloor = 0;
    
    for (const article of order.articles) {
      const fd = getFloorData(article.floorQuantities, floorKey);
      if (fd.received > 0 || fd.remaining > 0) {
        totalReceived += fd.received;
        totalCompleted += fd.completed;
        totalRemaining += fd.remaining;
        if (fd.remaining > 0) articlesOnFloor++;
      }
    }
    
    if (totalReceived > 0 || totalRemaining > 0) {
      floorProgress[floorKey] = {
        floor: floorName,
        floorKey,
        articles: articlesOnFloor,
        totalQuantity: totalReceived,
        completedQuantity: totalCompleted,
        wipQuantity: totalRemaining,
        progress: totalReceived > 0 ? Math.round((totalCompleted / totalReceived) * 100) : 0
      };
    }
  }

  // Get timeline
  const timeline = logs.map(log => ({
    id: log._id,
    action: log.action,
    quantity: log.quantity,
    fromFloor: log.fromFloor,
    toFloor: log.toFloor,
    remarks: log.remarks,
    timestamp: log.timestamp,
    user: log.userId ? {
      id: log.userId._id,
      name: log.userId.name,
      email: log.userId.email
    } : null,
    article: log.articleId ? {
      id: log.articleId._id,
      articleNumber: log.articleId.articleNumber
    } : null
  }));

  return {
    order: {
      id: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      priority: order.priority,
      currentFloor: order.currentFloor,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      customerName: order.customerName,
      customerOrderNumber: order.customerOrderNumber
    },
    progress: {
      totalArticles,
      completedArticles,
      inProgressArticles,
      pendingArticles,
      totalPlannedQuantity,
      totalCompletedQuantity,
      overallProgress
    },
    floorProgress: Object.values(floorProgress),
    articles: order.articles.map(article => {
      // Get quality data from finalChecking floor
      const fcData = getFloorData(article.floorQuantities, 'finalChecking');
      const dispatchData = getFloorData(article.floorQuantities, 'dispatch');
      const totalWip = getTotalWipQuantity(article.floorQuantities);
      
      return {
        id: article._id,
        articleNumber: article.articleNumber,
        status: article.status,
        progress: article.progress,
        plannedQuantity: article.plannedQuantity,
        completedQuantity: dispatchData.transferred, // Dispatched = completed
        wipQuantity: totalWip,
        m1Quantity: fcData.m1Quantity,
        m2Quantity: fcData.m2Quantity,
        m3Quantity: fcData.m3Quantity,
        m4Quantity: fcData.m4Quantity,
        repairStatus: article.floorQuantities?.finalChecking?.repairStatus,
        finalQualityConfirmed: article.finalQualityConfirmed
      };
    }),
    timeline
  };
};

/**
 * Get daily efficiency trend
 * @param {string} floor - Floor name (ProductionFloor enum value)
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Promise<Array>}
 */
const getDailyEfficiencyTrend = async (floor, startDate, endDate) => {
  const floorKey = getFloorKeyFromName(floor);
  if (!floorKey) return [];
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

  const trend = [];
  for (let i = 0; i < days; i++) {
    const currentDate = new Date(start);
    currentDate.setDate(start.getDate() + i);
    const dateStr = currentDate.toISOString().split('T')[0];

    // Find articles with activity on this floor during this date
    const articles = await Article.find({
      [`floorQuantities.${floorKey}.received`]: { $gt: 0 },
      updatedAt: { $gte: new Date(dateStr), $lt: new Date(dateStr + 'T23:59:59.999Z') }
    }).select('floorQuantities');

    // Aggregate floor-specific quantities
    const stats = aggregateFloorStats(articles, floorKey);
    const efficiency = stats.totalReceived > 0 ? Math.round((stats.totalCompleted / stats.totalReceived) * 100) : 0;

    trend.push({
      date: dateStr,
      totalQuantity: stats.totalReceived,
      completedQuantity: stats.totalCompleted,
      wipQuantity: stats.totalRemaining,
      efficiency
    });
  }

  return trend;
};

/**
 * Get quality trend over time
 * @param {string} floor - Floor name (ProductionFloor enum value)
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Promise<Array>}
 */
const getQualityTrend = async (floor, startDate, endDate) => {
  const floorKey = getFloorKeyFromName(floor) || 'finalChecking';
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

  const trend = [];
  for (let i = 0; i < days; i++) {
    const currentDate = new Date(start);
    currentDate.setDate(start.getDate() + i);
    const dateStr = currentDate.toISOString().split('T')[0];

    // Find articles with activity on this QC floor during this date
    const articles = await Article.find({
      [`floorQuantities.${floorKey}.received`]: { $gt: 0 },
      updatedAt: { $gte: new Date(dateStr), $lt: new Date(dateStr + 'T23:59:59.999Z') }
    }).select('floorQuantities');

    // Aggregate quality metrics from floorQuantities
    const stats = aggregateFloorStats(articles, floorKey);
    const m1Quantity = stats.m1Total;
    const m2Quantity = stats.m2Total;
    const m3Quantity = stats.m3Total;
    const m4Quantity = stats.m4Total;

    const totalQualityQuantity = m1Quantity + m2Quantity + m3Quantity + m4Quantity;
    const qualityRate = totalQualityQuantity > 0 ? Math.round((m1Quantity / totalQualityQuantity) * 100) : 0;
    const firstPassYield = stats.totalReceived > 0 ? Math.round((m1Quantity / stats.totalReceived) * 100) : 0;

    trend.push({
      date: dateStr,
      m1Quantity,
      m2Quantity,
      m3Quantity,
      m4Quantity,
      totalQualityQuantity,
      qualityRate,
      firstPassYield,
      received: stats.totalReceived
    });
  }

  return trend;
};

/**
 * Escapes a string for safe use inside a MongoDB `$regex` pattern (literal substring match).
 * @param {string} raw - User-provided search text
 * @returns {string} Escaped pattern fragment
 */
const escapeRegexLiteral = (raw) => raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds a Mongo clause for documents belonging to the current page's distinct `articleNumber` keys.
 * @param {Array} pageKeys - `_id` values from `$group: { _id: '$articleNumber' }`
 * @returns {Object} Fragment to combine with `$and` alongside the base report match
 */
const buildArticleNumberPageClause = (pageKeys) => {
  const normalized = pageKeys.map((k) => (k === undefined ? null : k));
  const nonBlank = [...new Set(normalized.filter((k) => k != null && k !== ''))];
  const hasBlank = normalized.some((k) => k === null || k === '');
  if (!hasBlank) {
    return { articleNumber: { $in: nonBlank } };
  }
  if (nonBlank.length === 0) {
    return {
      $or: [
        { articleNumber: null },
        { articleNumber: '' },
        { articleNumber: { $exists: false } },
      ],
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
 * Get production data grouped by article (factoryCode/articleNumber).
 * Paginates by distinct article number in the database and only loads logs for the current page.
 * @param {Object} filter - { articleNumber, search, knittingCode, status, orderNumber }
 * @param {Object} options - { limit, page, logsPerArticle }
 * @returns {Promise<Object>} { results, page, limit, totalPages, total }
 */
export const getArticleWiseData = async (filter = {}, options = {}) => {
  const { articleNumber: filterArticleNumber, knittingCode: filterKnittingCode, search, status, orderNumber } = filter;
  const limit = Math.min(parseInt(options.limit, 10) || 50, 100);
  const page = parseInt(options.page, 10) || 1;
  const logsPerArticleRaw = parseInt(options.logsPerArticle, 10);
  const logsPerArticle =
    Number.isFinite(logsPerArticleRaw) && logsPerArticleRaw >= 0
      ? Math.min(logsPerArticleRaw, 100)
      : 20;

  const match = {};
  if (filterArticleNumber) {
    match.articleNumber = filterArticleNumber;
  } else if (search && typeof search === 'string' && search.trim()) {
    const trimmed = search.trim();
    const searchRegex = { $regex: escapeRegexLiteral(trimmed), $options: 'i' };
    match.$or = [{ articleNumber: searchRegex }, { knittingCode: searchRegex }];
  }
  if (filterKnittingCode && typeof filterKnittingCode === 'string' && filterKnittingCode.trim()) {
    match.knittingCode = { $regex: escapeRegexLiteral(filterKnittingCode.trim()), $options: 'i' };
  }
  if (status) match.status = status;
  if (orderNumber && typeof orderNumber === 'string' && orderNumber.trim()) {
    const orders = await ProductionOrder.find({
      orderNumber: { $regex: escapeRegexLiteral(orderNumber.trim()), $options: 'i' },
    })
      .select('_id')
      .lean();
    const orderIds = orders.map((o) => o._id);
    if (orderIds.length === 0) {
      return { results: [], page, limit, totalPages: 0, total: 0 };
    }
    match.orderId = { $in: orderIds };
  } else {
    match.orderId = { $exists: true, $ne: null };
  }

  const groupStages = [{ $match: match }, { $group: { _id: '$articleNumber' } }];

  const [countRows, pageGroups] = await Promise.all([
    Article.aggregate([...groupStages, { $count: 'total' }]),
    Article.aggregate([
      ...groupStages,
      { $sort: { _id: 1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ]),
  ]);

  const total = countRows[0]?.total || 0;
  const totalPages = Math.ceil(total / limit) || 1;
  const pageKeys = pageGroups.map((g) => g._id);

  if (pageKeys.length === 0) {
    return {
      results: [],
      page,
      limit,
      totalPages: total === 0 ? 0 : totalPages,
      total,
    };
  }

  const pageClause = buildArticleNumberPageClause(pageKeys);
  const articles = await Article.find({
    $and: [match, pageClause],
  })
    .populate('orderId', 'orderNumber status priority currentFloor orderNote createdAt')
    .populate('machineId', 'machineCode machineNumber model floor')
    .sort({ articleNumber: 1, createdAt: -1 })
    .lean();

  const logsByArticleId = {};
  if (logsPerArticle > 0) {
    const articleIds = articles.map((a) => (a._id && a._id.toString()) || a.id);
    const allLogs = await ArticleLog.find({ articleId: { $in: articleIds } })
      .sort({ timestamp: -1 })
      .lean();

    for (const log of allLogs) {
      const aid = log.articleId && log.articleId.toString();
      if (!aid) continue;
      if (!logsByArticleId[aid]) logsByArticleId[aid] = [];
      if (logsByArticleId[aid].length < logsPerArticle) {
        logsByArticleId[aid].push({
          id: log.id,
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
  for (const a of articles) {
    const orderId = a.orderId;
    if (orderId == null || orderId === undefined) continue;

    const key = a.articleNumber;
    const orderDoc = orderId._id ? orderId : { _id: orderId };
    const articleIdStr = (a._id && a._id.toString()) || a.id;

    if (!byArticleNumber[key]) {
      byArticleNumber[key] = {
        factoryCode: key,
        articleNumber: key,
        orders: [],
      };
    }

    byArticleNumber[key].orders.push({
      articleId: articleIdStr,
      orderId: orderDoc ? orderDoc._id : null,
      orderNumber: orderId && orderId.orderNumber,
      orderStatus: orderId && orderId.status,
      orderPriority: orderId && orderId.priority,
      orderCurrentFloor: orderId && orderId.currentFloor,
      orderNote: orderId && orderId.orderNote,
      orderCreatedAt: orderId && (orderId.createdAt || orderId.created_at),
      plannedQuantity: a.plannedQuantity,
      knittingCode: a.knittingCode,
      status: a.status,
      progress: a.progress,
      linkingType: a.linkingType,
      priority: a.priority,
      remarks: a.remarks,
      machineId: a.machineId,
      machine: a.machineId && (a.machineId.machineCode ? a.machineId : null),
      floorQuantities: a.floorQuantities,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      logs: logsByArticleId[articleIdStr] || [],
    });
  }

  const results = [];
  for (const g of pageGroups) {
    const row = byArticleNumber[g._id];
    if (row) results.push(row);
  }

  return {
    results,
    page,
    limit,
    totalPages,
    total,
  };
};
