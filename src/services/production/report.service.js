import httpStatus from 'http-status';
import { ProductionOrder, Article, ArticleLog, FloorStatistics } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';

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
    const floorOrders = await ProductionOrder.find({
      currentFloor: floor,
      updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
    }).populate('articles');

    const floorArticles = floorOrders.flatMap(order => order.articles);
    const totalQuantity = floorArticles.reduce((sum, article) => sum + article.plannedQuantity, 0);
    const completedQuantity = floorArticles.reduce((sum, article) => sum + article.completedQuantity, 0);

    floorData = {
      floor,
      totalOrders: floorOrders.length,
      totalQuantity,
      completedQuantity,
      efficiency: totalQuantity > 0 ? Math.round((completedQuantity / totalQuantity) * 100) : 0
    };
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

  // Get floor statistics
  const floors = [
    'Knitting', 'Linking', 'Checking', 'Washing',
    'Boarding', 'Branding', 'Final Checking', 'Warehouse'
  ];

  const floorStatistics = await Promise.all(
    floors.map(async (floorName) => {
      const floorOrders = await ProductionOrder.countDocuments({
        currentFloor: floorName,
        updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
      });

      const floorArticles = await Article.find({
        currentFloor: floorName,
        updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
      });

      const totalQuantity = floorArticles.reduce((sum, article) => sum + article.plannedQuantity, 0);
      const completedQuantity = floorArticles.reduce((sum, article) => sum + article.completedQuantity, 0);

      return {
        floor: floorName,
        orderCount: floorOrders,
        articleCount: floorArticles.length,
        totalQuantity,
        completedQuantity,
        efficiency: totalQuantity > 0 ? Math.round((completedQuantity / totalQuantity) * 100) : 0
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

  const floors = floor ? [floor] : [
    'Knitting', 'Linking', 'Checking', 'Washing',
    'Boarding', 'Branding', 'Final Checking', 'Warehouse'
  ];

  const efficiencyData = await Promise.all(
    floors.map(async (floorName) => {
      // Get articles processed on this floor
      const articles = await Article.find({
        currentFloor: floorName,
        updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
      });

      const totalArticles = articles.length;
      const completedArticles = articles.filter(article => article.status === 'Completed').length;
      const completionRate = totalArticles > 0 ? Math.round((completedArticles / totalArticles) * 100) : 0;

      // Calculate quantity efficiency
      const totalPlannedQuantity = articles.reduce((sum, article) => sum + article.plannedQuantity, 0);
      const totalCompletedQuantity = articles.reduce((sum, article) => sum + article.completedQuantity, 0);
      const quantityEfficiency = totalPlannedQuantity > 0 ? 
        Math.round((totalCompletedQuantity / totalPlannedQuantity) * 100) : 0;

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
        metrics: {
          totalArticles,
          completedArticles,
          completionRate,
          totalPlannedQuantity,
          totalCompletedQuantity,
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

  // Focus on Final Checking floor for quality metrics
  const qualityFloor = floor === 'Final Checking' ? 'Final Checking' : 'Final Checking';
  
  const articles = await Article.find({
    currentFloor: qualityFloor,
    updatedAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
  });

  // Calculate quality metrics
  const totalArticles = articles.length;
  const qualityCheckedArticles = articles.filter(article => 
    (article.m1Quantity || 0) + (article.m2Quantity || 0) + 
    (article.m3Quantity || 0) + (article.m4Quantity || 0) > 0
  ).length;

  const m1Quantity = articles.reduce((sum, article) => sum + (article.m1Quantity || 0), 0);
  const m2Quantity = articles.reduce((sum, article) => sum + (article.m2Quantity || 0), 0);
  const m3Quantity = articles.reduce((sum, article) => sum + (article.m3Quantity || 0), 0);
  const m4Quantity = articles.reduce((sum, article) => sum + (article.m4Quantity || 0), 0);

  const totalQualityQuantity = m1Quantity + m2Quantity + m3Quantity + m4Quantity;
  const qualityRate = totalQualityQuantity > 0 ? Math.round((m1Quantity / totalQualityQuantity) * 100) : 0;
  const repairRate = totalQualityQuantity > 0 ? 
    Math.round(((m2Quantity + m3Quantity + m4Quantity) / totalQualityQuantity) * 100) : 0;

  // Get quality trends over time
  const qualityTrend = await getQualityTrend(qualityFloor, startDate, endDate);

  // Get articles with quality issues
  const qualityIssues = articles.filter(article => 
    (article.m2Quantity || 0) > 0 || (article.m3Quantity || 0) > 0 || (article.m4Quantity || 0) > 0
  ).map(article => ({
    id: article._id,
    articleNumber: article.articleNumber,
    orderId: article.orderId.toString(),
    m1Quantity: article.m1Quantity || 0,
    m2Quantity: article.m2Quantity || 0,
    m3Quantity: article.m3Quantity || 0,
    m4Quantity: article.m4Quantity || 0,
    repairStatus: article.repairStatus,
    repairRemarks: article.repairRemarks,
    finalQualityConfirmed: article.finalQualityConfirmed
  }));

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
      repairRate
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

  // Calculate overall progress
  const totalPlannedQuantity = order.articles.reduce((sum, article) => sum + article.plannedQuantity, 0);
  const totalCompletedQuantity = order.articles.reduce((sum, article) => sum + article.completedQuantity, 0);
  const overallProgress = totalPlannedQuantity > 0 ? 
    Math.round((totalCompletedQuantity / totalPlannedQuantity) * 100) : 0;

  // Get floor-wise progress
  const floorProgress = order.articles.reduce((acc, article) => {
    const floor = article.currentFloor;
    if (!acc[floor]) {
      acc[floor] = {
        floor,
        articles: 0,
        totalQuantity: 0,
        completedQuantity: 0,
        progress: 0
      };
    }
    
    acc[floor].articles += 1;
    acc[floor].totalQuantity += article.plannedQuantity;
    acc[floor].completedQuantity += article.completedQuantity;
    acc[floor].progress = acc[floor].totalQuantity > 0 ? 
      Math.round((acc[floor].completedQuantity / acc[floor].totalQuantity) * 100) : 0;
    
    return acc;
  }, {});

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
    articles: order.articles.map(article => ({
      id: article._id,
      articleNumber: article.articleNumber,
      status: article.status,
      currentFloor: article.currentFloor,
      progress: article.progress,
      plannedQuantity: article.plannedQuantity,
      completedQuantity: article.completedQuantity,
      m1Quantity: article.m1Quantity || 0,
      m2Quantity: article.m2Quantity || 0,
      m3Quantity: article.m3Quantity || 0,
      m4Quantity: article.m4Quantity || 0,
      repairStatus: article.repairStatus,
      finalQualityConfirmed: article.finalQualityConfirmed
    })),
    timeline
  };
};

/**
 * Get daily efficiency trend
 * @param {string} floor
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Promise<Array>}
 */
const getDailyEfficiencyTrend = async (floor, startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

  const trend = [];
  for (let i = 0; i < days; i++) {
    const currentDate = new Date(start);
    currentDate.setDate(start.getDate() + i);
    const dateStr = currentDate.toISOString().split('T')[0];

    const articles = await Article.find({
      currentFloor: floor,
      updatedAt: { $gte: new Date(dateStr), $lt: new Date(dateStr + 'T23:59:59.999Z') }
    });

    const totalQuantity = articles.reduce((sum, article) => sum + article.plannedQuantity, 0);
    const completedQuantity = articles.reduce((sum, article) => sum + article.completedQuantity, 0);
    const efficiency = totalQuantity > 0 ? Math.round((completedQuantity / totalQuantity) * 100) : 0;

    trend.push({
      date: dateStr,
      totalQuantity,
      completedQuantity,
      efficiency
    });
  }

  return trend;
};

/**
 * Get quality trend over time
 * @param {string} floor
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Promise<Array>}
 */
const getQualityTrend = async (floor, startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

  const trend = [];
  for (let i = 0; i < days; i++) {
    const currentDate = new Date(start);
    currentDate.setDate(start.getDate() + i);
    const dateStr = currentDate.toISOString().split('T')[0];

    const articles = await Article.find({
      currentFloor: floor,
      updatedAt: { $gte: new Date(dateStr), $lt: new Date(dateStr + 'T23:59:59.999Z') }
    });

    const m1Quantity = articles.reduce((sum, article) => sum + (article.m1Quantity || 0), 0);
    const m2Quantity = articles.reduce((sum, article) => sum + (article.m2Quantity || 0), 0);
    const m3Quantity = articles.reduce((sum, article) => sum + (article.m3Quantity || 0), 0);
    const m4Quantity = articles.reduce((sum, article) => sum + (article.m4Quantity || 0), 0);

    const totalQualityQuantity = m1Quantity + m2Quantity + m3Quantity + m4Quantity;
    const qualityRate = totalQualityQuantity > 0 ? Math.round((m1Quantity / totalQualityQuantity) * 100) : 0;

    trend.push({
      date: dateStr,
      m1Quantity,
      m2Quantity,
      m3Quantity,
      m4Quantity,
      totalQualityQuantity,
      qualityRate
    });
  }

  return trend;
};
