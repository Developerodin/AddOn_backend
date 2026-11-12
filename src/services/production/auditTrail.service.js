import httpStatus from 'http-status';
import { ArticleLog, ProductionOrder } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';
import { cachedRead, ProductionCacheResource, ProductionCacheTtl } from './productionCache.helper.js';

/**
 * Order audit trail: the order header, its articles and every matching log row.
 * Split out of `log.service.js` to keep that file small.
 */

/**
 * Get audit trail for an order
 * @param {ObjectId} orderId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getAuditTrail = async (orderId, options) =>
  cachedRead({
    resource: ProductionCacheResource.LOGS,
    operation: 'getAuditTrail',
    input: { orderId: String(orderId), options },
    ttlSeconds: ProductionCacheTtl.REPORT,
    loader: () => loadAuditTrail(orderId, options),
  });

/**
 * Uncached source for {@link getAuditTrail}.
 * @param {ObjectId} orderId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
const loadAuditTrail = async (orderId, options) => {
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
            'Transferred to Boarding', 'Transferred to Branding', 'Transferred to Re-Boarding',
            'Transferred to Final Checking', 'Transferred to Warehouse', 'Transferred to Dispatch',
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
    .sort({ timestamp: 1 })
    .lean();

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
