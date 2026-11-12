import httpStatus from 'http-status';
import { ProductionOrder, ArticleLog } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';
import {
  ALL_FLOOR_KEYS,
  getFloorNameFromKey,
  getFloorData,
  getTotalWipQuantity,
} from '../../utils/floorLabelMap.js';
import { cachedRead, ProductionCacheResource, ProductionCacheTtl } from './productionCache.helper.js';

/**
 * Order tracking report: one order's floor-wise progress plus its full log
 * timeline. Split out of `report.service.js` to keep that file small.
 */

/**
 * Get order tracking report
 * @param {ObjectId} orderId
 * @returns {Promise<Object>}
 */
export const getOrderTrackingReport = async (orderId) =>
  cachedRead({
    resource: ProductionCacheResource.REPORTS,
    operation: 'getOrderTrackingReport',
    input: { orderId: String(orderId) },
    ttlSeconds: ProductionCacheTtl.REPORT,
    loader: () => loadOrderTrackingReport(orderId),
  });

/**
 * Uncached source for {@link getOrderTrackingReport}.
 * @param {ObjectId} orderId
 * @returns {Promise<Object>}
 */
const loadOrderTrackingReport = async (orderId) => {
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
