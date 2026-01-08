import httpStatus from 'http-status';
import { FloorStatistics, Article, ProductionOrder, ArticleLog } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';
import { getAllFloorsOrder } from '../../utils/productionHelper.js';

/**
 * Get floor statistics
 * @param {string} floor
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
 * @param {string} floor
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Promise<Object>}
 */
const calculateRealTimeStatistics = async (floor, startDate, endDate) => {
  // Get orders currently on this floor
  const activeOrders = await ProductionOrder.countDocuments({
    currentFloor: floor,
    status: { $in: ['In Progress', 'Pending'] }
  });

  // Get orders completed today on this floor
  const today = new Date().toISOString().split('T')[0];
  const completedToday = await ProductionOrder.countDocuments({
    currentFloor: floor,
    status: 'Completed',
    updatedAt: { $gte: new Date(today) }
  });

  // Get pending orders (waiting to start on this floor)
  const pendingOrders = await ProductionOrder.countDocuments({
    currentFloor: floor,
    status: 'Pending'
  });

  // Get orders on hold on this floor
  const onHoldOrders = await ProductionOrder.countDocuments({
    currentFloor: floor,
    status: 'On Hold'
  });

  // Get total quantity on this floor
  const articlesOnFloor = await Article.find({
    currentFloor: floor,
    status: { $in: ['In Progress', 'Pending'] }
  });

  const totalQuantity = articlesOnFloor.reduce((sum, article) => sum + article.plannedQuantity, 0);
  const completedQuantity = articlesOnFloor.reduce((sum, article) => sum + article.completedQuantity, 0);

  // Calculate efficiency
  const efficiency = totalQuantity > 0 ? Math.round((completedQuantity / totalQuantity) * 100) : 0;

  // Calculate average processing time
  const completedArticles = await Article.find({
    currentFloor: floor,
    status: 'Completed',
    startedAt: { $exists: true },
    completedAt: { $exists: true }
  });

  let averageProcessingTime = 0;
  if (completedArticles.length > 0) {
    const totalTime = completedArticles.reduce((sum, article) => {
      const startTime = new Date(article.startedAt);
      const endTime = new Date(article.completedAt);
      return sum + (endTime - startTime);
    }, 0);
    
    averageProcessingTime = Math.round(totalTime / completedArticles.length / (1000 * 60 * 60)); // Convert to hours
  }

  return {
    floor,
    activeOrders,
    completedToday,
    pendingOrders,
    onHoldOrders,
    totalQuantity,
    completedQuantity,
    efficiency,
    averageProcessingTime,
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

  const floors = [
    'Knitting', 'Linking', 'Checking', 'Washing',
    'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'Warehouse'
  ];

  const statistics = await Promise.all(
    floors.map(floor => getFloorStatistics(floor, { dateFrom: startDate, dateTo: endDate }))
  );

  return statistics;
};

/**
 * Get floor performance metrics
 * @param {string} floor
 * @param {Object} dateRange
 * @returns {Promise<Object>}
 */
export const getFloorPerformanceMetrics = async (floor, dateRange = {}) => {
  const { dateFrom, dateTo } = dateRange;
  const today = new Date().toISOString().split('T')[0];
  const startDate = dateFrom || today;
  const endDate = dateTo || today;

  // Get articles processed on this floor in the date range
  const articles = await Article.find({
    currentFloor: floor,
    updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
  });

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
    
    averageProcessingTime = Math.round(totalTime / completedWithTimes.length / (1000 * 60 * 60)); // Convert to hours
  }

  // Calculate quantity metrics
  const totalPlannedQuantity = articles.reduce((sum, article) => sum + article.plannedQuantity, 0);
  const totalCompletedQuantity = articles.reduce((sum, article) => sum + article.completedQuantity, 0);
  const quantityEfficiency = totalPlannedQuantity > 0 ? 
    Math.round((totalCompletedQuantity / totalPlannedQuantity) * 100) : 0;

  // Get quality metrics for Final Checking floor
  let qualityMetrics = null;
  if (floor === 'Final Checking') {
    const m1Quantity = articles.reduce((sum, article) => sum + (article.m1Quantity || 0), 0);
    const m2Quantity = articles.reduce((sum, article) => sum + (article.m2Quantity || 0), 0);
    const m3Quantity = articles.reduce((sum, article) => sum + (article.m3Quantity || 0), 0);
    const m4Quantity = articles.reduce((sum, article) => sum + (article.m4Quantity || 0), 0);
    
    const totalQualityQuantity = m1Quantity + m2Quantity + m3Quantity + m4Quantity;
    
    qualityMetrics = {
      m1Quantity,
      m2Quantity,
      m3Quantity,
      m4Quantity,
      totalQualityQuantity,
      qualityRate: totalQualityQuantity > 0 ? Math.round((m1Quantity / totalQualityQuantity) * 100) : 0,
      repairRate: totalQualityQuantity > 0 ? Math.round(((m2Quantity + m3Quantity + m4Quantity) / totalQualityQuantity) * 100) : 0
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
    dateRange: { startDate, endDate },
    metrics: {
      totalArticles,
      completedArticles,
      completionRate,
      averageProcessingTime,
      totalPlannedQuantity,
      totalCompletedQuantity,
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

  const floors = [
    'Knitting', 'Linking', 'Checking', 'Washing',
    'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'Warehouse'
  ];

  const workload = await Promise.all(
    floors.map(async (floor) => {
      const articles = await Article.find({
        currentFloor: floor,
        updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
      });

      const totalQuantity = articles.reduce((sum, article) => sum + article.plannedQuantity, 0);
      const completedQuantity = articles.reduce((sum, article) => sum + article.completedQuantity, 0);
      const pendingQuantity = totalQuantity - completedQuantity;

      return {
        floor,
        totalQuantity,
        completedQuantity,
        pendingQuantity,
        articleCount: articles.length,
        efficiency: totalQuantity > 0 ? Math.round((completedQuantity / totalQuantity) * 100) : 0
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

  const floors = [
    'Knitting', 'Linking', 'Checking', 'Washing',
    'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'Warehouse'
  ];

  const analysis = await Promise.all(
    floors.map(async (floor, index) => {
      // Get articles on current floor
      const currentFloorArticles = await Article.find({
        currentFloor: floor,
        updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
      });

      // Get articles waiting for this floor (from previous floor)
      const previousFloor = index > 0 ? floors[index - 1] : null;
      let waitingArticles = [];
      
      if (previousFloor) {
        waitingArticles = await Article.find({
          currentFloor: previousFloor,
          status: 'Completed',
          updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
        });
      }

      // Calculate metrics
      const currentWorkload = currentFloorArticles.reduce((sum, article) => sum + article.plannedQuantity, 0);
      const pendingWorkload = waitingArticles.reduce((sum, article) => sum + article.plannedQuantity, 0);
      const totalWorkload = currentWorkload + pendingWorkload;

      // Calculate average processing time
      const completedArticles = currentFloorArticles.filter(article => 
        article.status === 'Completed' && article.startedAt && article.completedAt
      );

      let averageProcessingTime = 0;
      if (completedArticles.length > 0) {
        const totalTime = completedArticles.reduce((sum, article) => {
          const startTime = new Date(article.startedAt);
          const endTime = new Date(article.completedAt);
          return sum + (endTime - startTime);
        }, 0);
        
        averageProcessingTime = Math.round(totalTime / completedArticles.length / (1000 * 60 * 60)); // Convert to hours
      }

      return {
        floor,
        currentWorkload,
        pendingWorkload,
        totalWorkload,
        articleCount: currentFloorArticles.length,
        waitingCount: waitingArticles.length,
        averageProcessingTime,
        bottleneckScore: totalWorkload > 0 ? Math.round((currentWorkload / totalWorkload) * 100) : 0
      };
    })
  );

  // Identify bottlenecks (floors with high workload and low efficiency)
  const bottlenecks = analysis
    .filter(floor => floor.bottleneckScore > 70)
    .sort((a, b) => b.bottleneckScore - a.bottleneckScore);

  return {
    analysis,
    bottlenecks,
    summary: {
      totalFloors: floors.length,
      bottleneckCount: bottlenecks.length,
      criticalBottlenecks: bottlenecks.filter(b => b.bottleneckScore > 90).length
    }
  };
};
