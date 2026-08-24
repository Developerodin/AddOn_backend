import httpStatus from 'http-status';
import { FloorStatistics, Article, ProductionOrder, ArticleLog } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';
import { getAllFloorsOrder } from '../../utils/productionHelper.js';
import {
  ALL_FLOOR_NAMES,
  ALL_FLOOR_KEYS,
  getFloorKeyFromName,
  getFloorData,
  aggregateFloorStats,
  isQcFloorKey
} from '../../utils/floorLabelMap.js';

/**
 * Get floor statistics
 * @param {string} floor - ProductionFloor enum value
 * @param {Object} dateRange
 * @returns {Promise<Object>}
 */
export const getFloorStatistics = async (floor, dateRange = {}) => {
  const { dateFrom, dateTo } = dateRange;
  
  // Validate floor using comprehensive floor list
  const validFloors = getAllFloorsOrder();
  
  if (!validFloors.includes(floor)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid floor name');
  }

  const today = new Date().toISOString().split('T')[0];
  const startDate = dateFrom || today;
  const endDate = dateTo || today;

  // Get current statistics from database or calculate real-time
  let statistics = await FloorStatistics.findOne({
    floor,
    date: { $gte: startDate, $lte: endDate }
  });

  if (!statistics) {
    // Calculate real-time statistics
    statistics = await calculateRealTimeStatistics(floor, startDate, endDate);
    
    // Save to database for caching
    await FloorStatistics.findOneAndUpdate(
      { floor, date: startDate },
      statistics,
      { upsert: true, new: true }
    );
  }

  return statistics;
};

/**
 * Calculate real-time floor statistics
 * @param {string} floor - ProductionFloor enum value
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Promise<Object>}
 */
const calculateRealTimeStatistics = async (floor, startDate, endDate) => {
  const floorKey = getFloorKeyFromName(floor);
  if (!floorKey) {
    return {
      floor,
      activeOrders: 0,
      completedToday: 0,
      pendingOrders: 0,
      onHoldOrders: 0,
      totalQuantity: 0,
      completedQuantity: 0,
      wipQuantity: 0,
      efficiency: 0,
      averageProcessingTime: 0,
      lastUpdated: new Date().toISOString()
    };
  }

  // Get articles with WIP on this floor
  const articlesWithWip = await Article.find({
    [`floorQuantities.${floorKey}.remaining`]: { $gt: 0 }
  }).select('orderId status floorQuantities startedAt completedAt');

  // Count unique orders with articles on this floor
  const orderIds = [...new Set(articlesWithWip.map(a => a.orderId?.toString()).filter(Boolean))];
  
  // Get order status counts
  const orders = await ProductionOrder.find({
    _id: { $in: orderIds }
  }).select('status');

  const activeOrders = orders.filter(o => o.status === 'In Progress').length;
  const pendingOrders = orders.filter(o => o.status === 'Pending').length;
  const onHoldOrders = orders.filter(o => o.status === 'On Hold').length;

  // Get articles completed today on this floor (transferred out today)
  const today = new Date().toISOString().split('T')[0];
  const articlesToday = await Article.find({
    [`floorQuantities.${floorKey}.transferred`]: { $gt: 0 },
    updatedAt: { $gte: new Date(today) }
  }).select('floorQuantities');

  const completedToday = articlesToday.reduce((sum, a) => {
    return sum + (a.floorQuantities?.[floorKey]?.transferred || 0);
  }, 0);

  // Aggregate floor-specific quantities
  const stats = aggregateFloorStats(articlesWithWip, floorKey);

  // Calculate average processing time for completed articles
  const completedArticles = await Article.find({
    [`floorQuantities.${floorKey}.completed`]: { $gt: 0 },
    status: 'Completed',
    startedAt: { $exists: true, $ne: null },
    completedAt: { $exists: true, $ne: null }
  }).select('startedAt completedAt').limit(100);

  let averageProcessingTime = 0;
  if (completedArticles.length > 0) {
    const totalTime = completedArticles.reduce((sum, article) => {
      const startTime = new Date(article.startedAt);
      const endTime = new Date(article.completedAt);
      return sum + (endTime - startTime);
    }, 0);
    
    averageProcessingTime = Math.round(totalTime / completedArticles.length / (1000 * 60 * 60));
  }

  // Add quality metrics for QC floors
  let qualityMetrics = null;
  if (isQcFloorKey(floorKey)) {
    qualityMetrics = {
      m1: stats.m1Total,
      m2: stats.m2Total,
      m3: stats.m3Total,
      m4: stats.m4Total,
      firstPassYield: stats.totalReceived > 0 ? Math.round((stats.m1Total / stats.totalReceived) * 100) : 0
    };
  }

  return {
    floor,
    floorKey,
    activeOrders,
    completedToday,
    pendingOrders,
    onHoldOrders,
    totalQuantity: stats.totalReceived,
    completedQuantity: stats.totalCompleted,
    wipQuantity: stats.totalRemaining,
    transferredQuantity: stats.totalTransferred,
    articleCount: stats.articleCount,
    articlesWithWip: stats.articlesWithWip,
    efficiency: stats.totalReceived > 0 ? Math.round((stats.totalCompleted / stats.totalReceived) * 100) : 0,
    averageProcessingTime,
    qualityMetrics,
    lastUpdated: new Date().toISOString()
  };
};

/**
 * Update floor statistics
 * @param {string} floor
 * @param {Object} statisticsData
 * @returns {Promise<FloorStatistics>}
 */
export const updateFloorStatistics = async (floor, statisticsData) => {
  const today = new Date().toISOString().split('T')[0];
  
  const statistics = await FloorStatistics.findOneAndUpdate(
    { floor, date: today },
    {
      ...statisticsData,
      floor,
      date: today,
      lastUpdated: new Date().toISOString()
    },
    { upsert: true, new: true }
  );

  return statistics;
};

/**
 * Get all floor statistics
 * @param {Object} dateRange
 * @returns {Promise<Array>}
 */
export const getAllFloorStatistics = async (dateRange = {}) => {
  const { dateFrom, dateTo } = dateRange;
  const today = new Date().toISOString().split('T')[0];
  const startDate = dateFrom || today;
  const endDate = dateTo || today;

  const statistics = await Promise.all(
    ALL_FLOOR_NAMES.map(floor => getFloorStatistics(floor, { dateFrom: startDate, dateTo: endDate }))
  );

  return statistics;
};

/**
 * Get floor performance metrics
 * @param {string} floor - ProductionFloor enum value
 * @param {Object} dateRange
 * @returns {Promise<Object>}
 */
export const getFloorPerformanceMetrics = async (floor, dateRange = {}) => {
  const { dateFrom, dateTo } = dateRange;
  const today = new Date().toISOString().split('T')[0];
  const startDate = dateFrom || today;
  const endDate = dateTo || today;

  const floorKey = getFloorKeyFromName(floor);
  if (!floorKey) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid floor name');
  }

  // Get articles with activity on this floor in the date range
  const articles = await Article.find({
    [`floorQuantities.${floorKey}.received`]: { $gt: 0 },
    updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
  }).select('status floorQuantities startedAt completedAt');

  // Calculate metrics
  const totalArticles = articles.length;
  const completedArticles = articles.filter(article => article.status === 'Completed').length;
  const completionRate = totalArticles > 0 ? Math.round((completedArticles / totalArticles) * 100) : 0;

  // Calculate average processing time per article
  const completedWithTimes = articles.filter(article => 
    article.status === 'Completed' && 
    article.startedAt && 
    article.completedAt
  );

  let averageProcessingTime = 0;
  if (completedWithTimes.length > 0) {
    const totalTime = completedWithTimes.reduce((sum, article) => {
      const startTime = new Date(article.startedAt);
      const endTime = new Date(article.completedAt);
      return sum + (endTime - startTime);
    }, 0);
    
    averageProcessingTime = Math.round(totalTime / completedWithTimes.length / (1000 * 60 * 60));
  }

  // Aggregate floor-specific quantities
  const stats = aggregateFloorStats(articles, floorKey);
  const quantityEfficiency = stats.totalReceived > 0 ? 
    Math.round((stats.totalCompleted / stats.totalReceived) * 100) : 0;

  // Get quality metrics for QC floors
  let qualityMetrics = null;
  if (isQcFloorKey(floorKey)) {
    const totalQualityQuantity = stats.m1Total + stats.m2Total + stats.m3Total + stats.m4Total;
    
    qualityMetrics = {
      m1Quantity: stats.m1Total,
      m2Quantity: stats.m2Total,
      m3Quantity: stats.m3Total,
      m4Quantity: stats.m4Total,
      totalQualityQuantity,
      qualityRate: totalQualityQuantity > 0 ? Math.round((stats.m1Total / totalQualityQuantity) * 100) : 0,
      repairRate: totalQualityQuantity > 0 ? Math.round(((stats.m2Total + stats.m3Total + stats.m4Total) / totalQualityQuantity) * 100) : 0,
      firstPassYield: stats.totalReceived > 0 ? Math.round((stats.m1Total / stats.totalReceived) * 100) : 0
    };
  }

  // Get recent activity logs
  const recentLogs = await ArticleLog.find({
    $or: [
      { fromFloor: floor },
      { toFloor: floor }
    ],
    timestamp: { $gte: new Date(startDate), $lte: new Date(endDate) }
  })
  .sort({ timestamp: -1 })
  .limit(10)
  .populate('articleId', 'articleNumber')
  .populate('orderId', 'orderNumber');

  return {
    floor,
    floorKey,
    dateRange: { startDate, endDate },
    metrics: {
      totalArticles,
      completedArticles,
      completionRate,
      averageProcessingTime,
      totalPlannedQuantity: stats.totalReceived,
      totalCompletedQuantity: stats.totalCompleted,
      wipQuantity: stats.totalRemaining,
      quantityEfficiency,
      qualityMetrics
    },
    recentActivity: recentLogs.map(log => ({
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
      } : null
    }))
  };
};

/**
 * Get floor workload distribution
 * @param {Object} dateRange
 * @returns {Promise<Array>}
 */
export const getFloorWorkloadDistribution = async (dateRange = {}) => {
  const { dateFrom, dateTo } = dateRange;
  const today = new Date().toISOString().split('T')[0];
  const startDate = dateFrom || today;
  const endDate = dateTo || today;

  const workload = await Promise.all(
    ALL_FLOOR_NAMES.map(async (floor) => {
      const floorKey = getFloorKeyFromName(floor);
      
      // Get articles with activity on this floor
      const articles = await Article.find({
        $or: [
          { [`floorQuantities.${floorKey}.received`]: { $gt: 0 } },
          { [`floorQuantities.${floorKey}.remaining`]: { $gt: 0 } }
        ],
        updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
      }).select('floorQuantities');

      const stats = aggregateFloorStats(articles, floorKey);

      return {
        floor,
        floorKey,
        totalQuantity: stats.totalReceived,
        completedQuantity: stats.totalCompleted,
        wipQuantity: stats.totalRemaining,
        transferredQuantity: stats.totalTransferred,
        articleCount: stats.articleCount,
        articlesWithWip: stats.articlesWithWip,
        efficiency: stats.totalReceived > 0 ? Math.round((stats.totalCompleted / stats.totalReceived) * 100) : 0
      };
    })
  );

  return workload;
};

/**
 * Get floor bottleneck analysis
 * @param {Object} dateRange
 * @returns {Promise<Object>}
 */
export const getFloorBottleneckAnalysis = async (dateRange = {}) => {
  const { dateFrom, dateTo } = dateRange;
  const today = new Date().toISOString().split('T')[0];
  const startDate = dateFrom || today;
  const endDate = dateTo || today;

  const analysis = await Promise.all(
    ALL_FLOOR_NAMES.map(async (floor, index) => {
      const floorKey = getFloorKeyFromName(floor);
      
      // Get articles with WIP on this floor
      const articlesOnFloor = await Article.find({
        [`floorQuantities.${floorKey}.remaining`]: { $gt: 0 },
        updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
      }).select('floorQuantities startedAt completedAt status');

      // Get articles waiting from previous floor (transferred but not received on this floor)
      const previousFloorKey = index > 0 ? ALL_FLOOR_KEYS[index - 1] : null;
      let waitingQuantity = 0;
      let waitingCount = 0;
      
      if (previousFloorKey) {
        // Articles transferred from previous floor but not yet received on this floor
        const waitingArticles = await Article.find({
          [`floorQuantities.${previousFloorKey}.transferred`]: { $gt: 0 },
          [`floorQuantities.${floorKey}.received`]: 0,
          updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
        }).select('floorQuantities');

        waitingCount = waitingArticles.length;
        waitingQuantity = waitingArticles.reduce((sum, a) => {
          return sum + (a.floorQuantities?.[previousFloorKey]?.transferred || 0);
        }, 0);
      }

      // Aggregate floor statistics
      const stats = aggregateFloorStats(articlesOnFloor, floorKey);

      // Calculate average processing time
      const completedArticles = articlesOnFloor.filter(article => 
        article.status === 'Completed' && article.startedAt && article.completedAt
      );

      let averageProcessingTime = 0;
      if (completedArticles.length > 0) {
        const totalTime = completedArticles.reduce((sum, article) => {
          const startTime = new Date(article.startedAt);
          const endTime = new Date(article.completedAt);
          return sum + (endTime - startTime);
        }, 0);
        
        averageProcessingTime = Math.round(totalTime / completedArticles.length / (1000 * 60 * 60));
      }

      // Calculate backlog days (WIP / average daily throughput)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const recentCompleted = await Article.aggregate([
        {
          $match: {
            [`floorQuantities.${floorKey}.completed`]: { $gt: 0 },
            updatedAt: { $gte: sevenDaysAgo }
          }
        },
        {
          $group: {
            _id: null,
            totalCompleted: { $sum: `$floorQuantities.${floorKey}.completed` }
          }
        }
      ]);

      const avgDailyThroughput = (recentCompleted[0]?.totalCompleted || 0) / 7;
      const backlogDays = avgDailyThroughput > 0 ? Math.round((stats.totalRemaining / avgDailyThroughput) * 10) / 10 : 0;

      const totalWorkload = stats.totalRemaining + waitingQuantity;
      const bottleneckScore = totalWorkload > 0 && avgDailyThroughput > 0 
        ? Math.min(100, Math.round((totalWorkload / (avgDailyThroughput * 3)) * 100))
        : 0;

      return {
        floor,
        floorKey,
        currentWorkload: stats.totalRemaining,
        waitingWorkload: waitingQuantity,
        totalWorkload,
        articleCount: stats.articlesWithWip,
        waitingCount,
        averageProcessingTime,
        avgDailyThroughput: Math.round(avgDailyThroughput),
        backlogDays,
        bottleneckScore
      };
    })
  );

  // Identify bottlenecks (floors with high backlog days)
  const bottlenecks = analysis
    .filter(floor => floor.backlogDays > 1)
    .sort((a, b) => b.backlogDays - a.backlogDays);

  return {
    analysis,
    bottlenecks,
    summary: {
      totalFloors: ALL_FLOOR_NAMES.length,
      bottleneckCount: bottlenecks.length,
      criticalBottlenecks: bottlenecks.filter(b => b.backlogDays > 3).length,
      worstBottleneck: bottlenecks[0] || null
    }
  };
};
