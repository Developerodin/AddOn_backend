import { ProductionOrder, Article, ArticleLog } from '../../models/production/index.js';
import {
  ALL_FLOOR_NAMES,
  getFloorKeyFromName,
  getFloorData,
  aggregateFloorStats,
} from '../../utils/floorLabelMap.js';
import { getDailyEfficiencyTrend, getQualityTrend } from './reportTrends.helper.js';
import { cachedRead, ProductionCacheResource, ProductionCacheTtl } from './productionCache.helper.js';

/**
 * Get production dashboard data
 * @param {Object} filter
 * @returns {Promise<Object>}
 */
export const getProductionDashboard = async (filter) =>
  cachedRead({
    resource: ProductionCacheResource.REPORTS,
    operation: 'getProductionDashboard',
    input: filter,
    ttlSeconds: ProductionCacheTtl.REPORT,
    loader: () => loadProductionDashboard(filter),
  });

/**
 * Uncached source for {@link getProductionDashboard}.
 * @param {Object} filter
 * @returns {Promise<Object>}
 */
const loadProductionDashboard = async (filter) => {
  const { dateFrom, dateTo, floor } = filter;
  const today = new Date().toISOString().split('T')[0];
  const startDate = dateFrom || today;
  const endDate = dateTo || today;

  // The four header counts are independent, so issue them together.
  const [totalOrders, completedOrders, inProgressOrders, onHoldOrders] = await Promise.all([
    ProductionOrder.countDocuments({
      createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
    }),
    ProductionOrder.countDocuments({
      status: 'Completed',
      updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
    }),
    ProductionOrder.countDocuments({
      status: 'In Progress',
      updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
    }),
    ProductionOrder.countDocuments({
      status: 'On Hold',
      updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
    }),
  ]);

  // Get floor-specific data if floor filter is applied
  let floorData = null;
  if (floor) {
    const floorKey = getFloorKeyFromName(floor);
    if (floorKey) {
      // Find articles with WIP on this floor
      const floorArticles = await Article.find({
        [`floorQuantities.${floorKey}.remaining`]: { $gt: 0 },
        updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
      }).select('plannedQuantity floorQuantities').lean();

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
      }).select('plannedQuantity floorQuantities').lean();

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
export const getEfficiencyReport = async (filter) =>
  cachedRead({
    resource: ProductionCacheResource.REPORTS,
    operation: 'getEfficiencyReport',
    input: filter,
    ttlSeconds: ProductionCacheTtl.REPORT,
    loader: () => loadEfficiencyReport(filter),
  });

/**
 * Uncached source for {@link getEfficiencyReport}.
 * @param {Object} filter
 * @returns {Promise<Object>}
 */
const loadEfficiencyReport = async (filter) => {
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
      }).select('plannedQuantity status floorQuantities startedAt completedAt').lean();

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
export const getQualityReport = async (filter) =>
  cachedRead({
    resource: ProductionCacheResource.REPORTS,
    operation: 'getQualityReport',
    input: filter,
    ttlSeconds: ProductionCacheTtl.REPORT,
    loader: () => loadQualityReport(filter),
  });

/**
 * Uncached source for {@link getQualityReport}.
 * @param {Object} filter
 * @returns {Promise<Object>}
 */
const loadQualityReport = async (filter) => {
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
  }).select('articleNumber orderId floorQuantities finalQualityConfirmed').lean();

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

export { getOrderTrackingReport } from './orderTrackingReport.service.js';


export { getArticleWiseData } from './articleWiseQuery.helper.js';
