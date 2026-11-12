import httpStatus from 'http-status';
import { ArticleLog, Article, ProductionOrder } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';
import {
  cachedRead,
  invalidateProductionData,
  ProductionCacheResource,
  ProductionCacheTtl,
} from './productionCache.helper.js';

/**
 * Get logs for a specific article
 * @param {ObjectId} articleId
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
export const getArticleLogs = async (articleId, filter = {}, options = {}) => {
  const articleIdStr = articleId?.toString?.() ?? String(articleId);
  const { dateFrom, dateTo, action, floor } = filter;

  const logFilter = {
    $or: [{ articleId: articleIdStr }, { articleId }],
  };

  if (dateFrom || dateTo) {
    logFilter.timestamp = {};
    if (dateFrom) logFilter.timestamp.$gte = new Date(dateFrom);
    if (dateTo) logFilter.timestamp.$lte = new Date(dateTo);
  }

  if (action) logFilter.action = action;

  if (floor) {
    logFilter.$and = [
      ...(logFilter.$and || []),
      { $or: [{ fromFloor: floor }, { toFloor: floor }] },
    ];
  }

  return cachedRead({
    resource: ProductionCacheResource.LOGS,
    operation: 'getArticleLogs',
    input: { logFilter, options },
    ttlSeconds: ProductionCacheTtl.REPORT,
    loader: () =>
      ArticleLog.paginate(logFilter, {
        ...options,
        sortBy: options.sortBy || 'timestamp:desc',
      }),
  });
};

/**
 * Get logs for a specific order
 * @param {ObjectId} orderId
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
export const getOrderLogs = async (orderId, filter = {}, options = {}) => {
  const orderIdStr = orderId?.toString?.() ?? String(orderId);
  const { dateFrom, dateTo, action, floor } = filter;

  const logFilter = {
    $or: [{ orderId: orderIdStr }, { orderId }],
  };

  if (dateFrom || dateTo) {
    logFilter.timestamp = {};
    if (dateFrom) logFilter.timestamp.$gte = new Date(dateFrom);
    if (dateTo) logFilter.timestamp.$lte = new Date(dateTo);
  }

  if (action) logFilter.action = action;

  if (floor) {
    logFilter.$and = [
      ...(logFilter.$and || []),
      { $or: [{ fromFloor: floor }, { toFloor: floor }] },
    ];
  }

  return cachedRead({
    resource: ProductionCacheResource.LOGS,
    operation: 'getOrderLogs',
    input: { logFilter, options },
    ttlSeconds: ProductionCacheTtl.REPORT,
    loader: () =>
      ArticleLog.paginate(logFilter, {
        ...options,
        sortBy: options.sortBy || 'timestamp:desc',
      }),
  });
};

/**
 * Get logs for a specific floor
 * @param {string} floor
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
export const getFloorLogs = async (floor, filter, options) => {
  const logFilter = {
    $or: [
      { fromFloor: floor },
      { toFloor: floor }
    ],
    ...filter
  };

  // Add date range filter
  if (filter.dateFrom || filter.dateTo) {
    logFilter.timestamp = {};
    if (filter.dateFrom) {
      logFilter.timestamp.$gte = new Date(filter.dateFrom);
    }
    if (filter.dateTo) {
      logFilter.timestamp.$lte = new Date(filter.dateTo);
    }
  }

  // Add action filter
  if (filter.action) {
    logFilter.action = filter.action;
  }

  // Add user filter
  if (filter.userId) {
    logFilter.userId = filter.userId;
  }

  return cachedRead({
    resource: ProductionCacheResource.LOGS,
    operation: 'getFloorLogs',
    input: { logFilter, options },
    ttlSeconds: ProductionCacheTtl.REPORT,
    loader: () =>
      ArticleLog.paginate(logFilter, {
        ...options,
        sortBy: 'timestamp:desc',
        populate: 'articleId orderId'
      }),
  });
};

/**
 * Get logs for a specific user
 * @param {ObjectId} userId
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
export const getUserLogs = async (userId, filter, options) => {
  const logFilter = {
    userId,
    ...filter
  };

  // Add date range filter
  if (filter.dateFrom || filter.dateTo) {
    logFilter.timestamp = {};
    if (filter.dateFrom) {
      logFilter.timestamp.$gte = new Date(filter.dateFrom);
    }
    if (filter.dateTo) {
      logFilter.timestamp.$lte = new Date(filter.dateTo);
    }
  }

  // Add action filter
  if (filter.action) {
    logFilter.action = filter.action;
  }

  // Add floor filter
  if (filter.floor) {
    logFilter.$or = [
      { fromFloor: filter.floor },
      { toFloor: filter.floor }
    ];
  }

  return cachedRead({
    resource: ProductionCacheResource.LOGS,
    operation: 'getUserLogs',
    input: { logFilter, options },
    ttlSeconds: ProductionCacheTtl.REPORT,
    loader: () =>
      ArticleLog.paginate(logFilter, {
        ...options,
        sortBy: 'timestamp:desc',
        populate: 'articleId orderId'
      }),
  });
};

/**
 * Get log statistics
 * @param {Object} filter
 * @returns {Promise<Object>}
 */
export const getLogStatistics = async (filter) =>
  cachedRead({
    resource: ProductionCacheResource.LOGS,
    operation: 'getLogStatistics',
    input: filter,
    ttlSeconds: ProductionCacheTtl.REPORT,
    loader: () => loadLogStatistics(filter),
  });

/**
 * Uncached source for {@link getLogStatistics}.
 * @param {Object} filter
 * @returns {Promise<Object>}
 */
const loadLogStatistics = async (filter) => {
  const {
    dateFrom,
    dateTo,
    groupBy = 'day',
    floor,
    action
  } = filter;

  const matchFilter = {};

  // Add date range filter
  if (dateFrom || dateTo) {
    matchFilter.timestamp = {};
    if (dateFrom) {
      matchFilter.timestamp.$gte = new Date(dateFrom);
    }
    if (dateTo) {
      matchFilter.timestamp.$lte = new Date(dateTo);
    }
  }

  // Add floor filter
  if (floor) {
    matchFilter.$or = [
      { fromFloor: floor },
      { toFloor: floor }
    ];
  }

  // Add action filter
  if (action) {
    matchFilter.action = action;
  }

  // Build group stage based on groupBy parameter
  let groupStage;
  switch (groupBy) {
    case 'day':
      groupStage = {
        _id: {
          year: { $year: '$timestamp' },
          month: { $month: '$timestamp' },
          day: { $dayOfMonth: '$timestamp' }
        },
        count: { $sum: 1 },
        totalQuantity: { $sum: '$quantity' }
      };
      break;
    case 'week':
      groupStage = {
        _id: {
          year: { $year: '$timestamp' },
          week: { $week: '$timestamp' }
        },
        count: { $sum: 1 },
        totalQuantity: { $sum: '$quantity' }
      };
      break;
    case 'month':
      groupStage = {
        _id: {
          year: { $year: '$timestamp' },
          month: { $month: '$timestamp' }
        },
        count: { $sum: 1 },
        totalQuantity: { $sum: '$quantity' }
      };
      break;
    default:
      groupStage = {
        _id: null,
        count: { $sum: 1 },
        totalQuantity: { $sum: '$quantity' }
      };
  }

  const pipeline = [
    { $match: matchFilter },
    { $group: groupStage },
    { $sort: { '_id': 1 } }
  ];

  // The three aggregations are independent, so run them together.
  const [statistics, actionBreakdown, floorBreakdown] = await Promise.all([
    ArticleLog.aggregate(pipeline),
    ArticleLog.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$action',
          count: { $sum: 1 },
          totalQuantity: { $sum: '$quantity' }
        }
      },
      { $sort: { count: -1 } }
    ]),
    ArticleLog.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$fromFloor',
          count: { $sum: 1 },
          totalQuantity: { $sum: '$quantity' }
        }
      },
      { $sort: { count: -1 } }
    ]),
  ]);

  return {
    timeSeries: statistics,
    actionBreakdown,
    floorBreakdown,
    totalLogs: statistics.reduce((sum, item) => sum + item.count, 0),
    totalQuantity: statistics.reduce((sum, item) => sum + item.totalQuantity, 0)
  };
};

export { getAuditTrail } from './auditTrail.service.js';

/**
 * Create a manual log entry
 * @param {Object} logData
 * @returns {Promise<ArticleLog>}
 */
export const createManualLog = async (logData) => {
  const {
    articleId,
    orderId,
    action,
    quantity = 0,
    fromFloor,
    toFloor,
    remarks = '',
    userId,
    floorSupervisorId,
    previousValue,
    newValue,
    changeReason,
    qualityStatus,
    machineId,
    shiftId,
    batchNumber
  } = logData;

  // Validate required fields
  if (!action || !userId || !floorSupervisorId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Action, userId, and floorSupervisorId are required');
  }

  // Validate article exists if articleId provided
  if (articleId) {
    const article = await Article.findById(articleId);
    if (!article) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
    }
  }

  // Validate order exists if orderId provided
  if (orderId) {
    const order = await ProductionOrder.findById(orderId);
    if (!order) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
    }
  }

  const created = await ArticleLog.createLogEntry({
    articleId,
    orderId,
    action,
    quantity,
    fromFloor,
    toFloor,
    remarks,
    userId,
    floorSupervisorId,
    previousValue,
    newValue,
    changeReason,
    qualityStatus,
    machineId,
    shiftId,
    batchNumber
  });

  await invalidateProductionData('createManualLog');

  return created;
};
