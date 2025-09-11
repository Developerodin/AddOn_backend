import httpStatus from 'http-status';
import { ArticleLog, Article, ProductionOrder } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Get logs for a specific article
 * @param {ObjectId} articleId
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
export const getArticleLogs = async (articleId, filter, options) => {
  const logFilter = {
    articleId,
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

  const logs = await ArticleLog.paginate(logFilter, {
    ...options,
    sortBy: 'timestamp:desc'
  });

  return logs;
};

/**
 * Get logs for a specific order
 * @param {ObjectId} orderId
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
export const getOrderLogs = async (orderId, filter, options) => {
  const logFilter = {
    orderId,
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

  const logs = await ArticleLog.paginate(logFilter, {
    ...options,
    sortBy: 'timestamp:desc',
    populate: 'articleId'
  });

  return logs;
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

  const logs = await ArticleLog.paginate(logFilter, {
    ...options,
    sortBy: 'timestamp:desc',
    populate: 'articleId orderId'
  });

  return logs;
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

  const logs = await ArticleLog.paginate(logFilter, {
    ...options,
    sortBy: 'timestamp:desc',
    populate: 'articleId orderId'
  });

  return logs;
};

/**
 * Get log statistics
 * @param {Object} filter
 * @returns {Promise<Object>}
 */
export const getLogStatistics = async (filter) => {
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

  const statistics = await ArticleLog.aggregate(pipeline);

  // Get action breakdown
  const actionBreakdown = await ArticleLog.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: '$action',
        count: { $sum: 1 },
        totalQuantity: { $sum: '$quantity' }
      }
    },
    { $sort: { count: -1 } }
  ]);

  // Get floor breakdown
  const floorBreakdown = await ArticleLog.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: '$fromFloor',
        count: { $sum: 1 },
        totalQuantity: { $sum: '$quantity' }
      }
    },
    { $sort: { count: -1 } }
  ]);

  return {
    timeSeries: statistics,
    actionBreakdown,
    floorBreakdown,
    totalLogs: statistics.reduce((sum, item) => sum + item.count, 0),
    totalQuantity: statistics.reduce((sum, item) => sum + item.totalQuantity, 0)
  };
};

/**
 * Get audit trail for an order
 * @param {ObjectId} orderId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getAuditTrail = async (orderId, options) => {
  const { includeSystemLogs = true, includeUserActions = true } = options;

  const order = await ProductionOrder.findById(orderId).populate('articles');
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  }

  const logFilter = { orderId };

  // Filter by log type
  if (!includeSystemLogs || !includeUserActions) {
    const actionFilters = [];
    
    if (includeSystemLogs) {
      actionFilters.push({
        action: {
          $in: [
            'Order Created', 'Order Updated', 'Order Completed',
            'Article Added', 'Article Updated', 'Article Removed',
            'Transferred to Knitting', 'Transferred to Linking',
            'Transferred to Checking', 'Transferred to Washing',
            'Transferred to Boarding', 'Transferred to Branding',
            'Transferred to Final Checking', 'Transferred to Warehouse',
            'Quality Check Started', 'Quality Check Completed',
            'M1 Quantity Updated', 'M2 Quantity Updated',
            'M3 Quantity Updated', 'M4 Quantity Updated',
            'Final Quality Confirmed', 'Final Quality Rejected'
          ]
        }
      });
    }
    
    if (includeUserActions) {
      actionFilters.push({
        action: {
          $in: [
            'Work Started', 'Work Paused', 'Work Resumed', 'Work Completed',
            'Quantity Updated', 'Progress Updated', 'Remarks Added', 'Remarks Updated',
            'User Login', 'User Logout', 'Permission Changed', 'Password Changed',
            'Profile Updated', 'Error Occurred', 'Issue Reported', 'Issue Resolved'
          ]
        }
      });
    }

    if (actionFilters.length > 0) {
      logFilter.$or = actionFilters;
    }
  }

  const logs = await ArticleLog.find(logFilter)
    .populate('articleId', 'articleNumber')
    .populate('userId', 'name email')
    .populate('floorSupervisorId', 'name email')
    .sort({ timestamp: 1 });

  // Group logs by article for better organization
  const auditTrail = {
    order: {
      id: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      currentFloor: order.currentFloor,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    },
    articles: order.articles.map(article => ({
      id: article._id,
      articleNumber: article.articleNumber,
      status: article.status,
      currentFloor: article.currentFloor,
      progress: article.progress,
      plannedQuantity: article.plannedQuantity,
      completedQuantity: article.completedQuantity
    })),
    logs: logs.map(log => ({
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
      floorSupervisor: log.floorSupervisorId ? {
        id: log.floorSupervisorId._id,
        name: log.floorSupervisorId.name,
        email: log.floorSupervisorId.email
      } : null,
      article: log.articleId ? {
        id: log.articleId._id,
        articleNumber: log.articleId.articleNumber
      } : null,
      previousValue: log.previousValue,
      newValue: log.newValue,
      changeReason: log.changeReason,
      qualityStatus: log.qualityStatus,
      machineId: log.machineId,
      shiftId: log.shiftId,
      batchNumber: log.batchNumber
    })),
    summary: {
      totalLogs: logs.length,
      totalActions: [...new Set(logs.map(log => log.action))].length,
      timeSpan: logs.length > 0 ? {
        start: logs[0].timestamp,
        end: logs[logs.length - 1].timestamp
      } : null,
      floorsInvolved: [...new Set(logs.flatMap(log => [log.fromFloor, log.toFloor]).filter(Boolean))],
      usersInvolved: [...new Set(logs.map(log => log.userId?._id).filter(Boolean))].length
    }
  };

  return auditTrail;
};

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

  const log = new ArticleLog({
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
    batchNumber,
    date: new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString()
  });

  return log.save();
};
