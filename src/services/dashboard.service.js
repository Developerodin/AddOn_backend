import mongoose from 'mongoose';
import Sales from '../models/sales.model.js';
import Store from '../models/store.model.js';
import Product from '../models/product.model.js';
import Category from '../models/category.model.js';

/**
 * Get comprehensive dashboard data
 */
const getDashboardData = async (query = {}) => {
  const { period = 'week' } = query;
  
  // Get date ranges
  const { currentPeriod, previousPeriod } = getDateRanges(period);
  
  // Get all metrics in parallel
  const [
    totalSales,
    totalOrders,
    currentPeriodSales,
    previousPeriodSales,
    topStores,
    monthlyTrends,
    categoryAnalytics,
    cityPerformance
  ] = await Promise.all([
    getTotalSales(currentPeriod),
    getTotalOrders(currentPeriod),
    getPeriodSales(currentPeriod),
    getPeriodSales(previousPeriod),
    getTopStores(5),
    getMonthlyTrends(),
    getCategoryAnalytics(period),
    getCityPerformance()
  ]);

  // Calculate percentage change
  const salesChange = calculatePercentageChange(previousPeriodSales, currentPeriodSales);

  return {
    overview: {
      totalSales,
      totalOrders,
      salesChange,
      period
    },
    topStores,
    monthlyTrends,
    categoryAnalytics,
    cityPerformance
  };
};

/**
 * Get sales analytics for specific period
 */
const getSalesAnalytics = async (period = 'week', startDate, endDate) => {
  let dateRange;
  
  if (startDate && endDate) {
    dateRange = {
      start: new Date(startDate),
      end: new Date(endDate)
    };
  } else {
    dateRange = getDateRanges(period).currentPeriod;
  }

  const sales = await Sales.aggregate([
    {
      $match: {
        date: { $gte: dateRange.start, $lte: dateRange.end }
      }
    },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'store'
      }
    },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'product'
      }
    },
    {
      $unwind: '$store'
    },
    {
      $unwind: '$product'
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          store: '$store.storeName'
        },
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' },
        totalOrders: { $sum: 1 }
      }
    },
    {
      $sort: { '_id.date': 1 }
    }
  ]);

  return {
    period,
    dateRange,
    sales
  };
};

/**
 * Get top performing stores
 */
const getStorePerformance = async (limit = 5) => {
  const stores = await Sales.aggregate([
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'store'
      }
    },
    {
      $unwind: '$store'
    },
    {
      $group: {
        _id: '$store._id',
        storeName: { $first: '$store.storeName' },
        storeId: { $first: '$store.storeId' },
        city: { $first: '$store.city' },
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' },
        totalOrders: { $sum: 1 },
        avgOrderValue: { $avg: '$nsv' }
      }
    },
    {
      $sort: { totalNSV: -1 }
    },
    {
      $limit: parseInt(limit)
    }
  ]);

  return stores;
};

/**
 * Get category-wise analytics
 */
const getCategoryAnalytics = async (period = 'month') => {
  const dateRange = getDateRanges(period).currentPeriod;

  const categories = await Sales.aggregate([
    {
      $match: {
        date: { $gte: dateRange.start, $lte: dateRange.end }
      }
    },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'product'
      }
    },
    {
      $unwind: '$product'
    },
    {
      $lookup: {
        from: 'categories',
        localField: 'product.category',
        foreignField: '_id',
        as: 'category'
      }
    },
    {
      $unwind: {
        path: '$category',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $group: {
        _id: { $ifNull: ['$category._id', 'unknown'] },
        categoryName: { $first: { $ifNull: ['$category.name', 'Unknown Category'] } },
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' },
        totalOrders: { $sum: 1 },
        avgOrderValue: { $avg: '$nsv' }
      }
    },
    {
      $sort: { totalNSV: -1 }
    }
  ]);

  return {
    period,
    categories
  };
};

/**
 * Get city performance
 */
const getCityPerformance = async () => {
  const cities = await Sales.aggregate([
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'store'
      }
    },
    {
      $unwind: '$store'
    },
    {
      $group: {
        _id: '$store.city',
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' },
        totalOrders: { $sum: 1 },
        storeCount: { $addToSet: '$store._id' }
      }
    },
    {
      $addFields: {
        storeCount: { $size: '$storeCount' },
        avgOrderValue: { $divide: ['$totalNSV', '$totalOrders'] }
      }
    },
    {
      $sort: { totalNSV: -1 }
    }
  ]);

  return cities;
};

/**
 * Get demand forecast vs actual
 */
const getDemandForecast = async (period = 'month') => {
  const dateRange = getDateRanges(period).currentPeriod;
  
  // Get actual demand
  const actualDemand = await Sales.aggregate([
    {
      $match: {
        date: { $gte: dateRange.start, $lte: dateRange.end }
      }
    },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'product'
      }
    },
    {
      $unwind: '$product'
    },
    {
      $group: {
        _id: '$product._id',
        productName: { $first: '$product.name' },
        actualQuantity: { $sum: '$quantity' },
        actualNSV: { $sum: '$nsv' }
      }
    }
  ]);

  // Simple forecast based on historical data (you can enhance this)
  const forecast = await generateForecast(actualDemand, period);

  return {
    period,
    actualDemand,
    forecast
  };
};

// Helper functions
const getDateRanges = (period) => {
  const now = new Date();
  const currentPeriod = { start: new Date(), end: new Date() };
  const previousPeriod = { start: new Date(), end: new Date() };

  switch (period) {
    case 'week':
      currentPeriod.start.setDate(now.getDate() - 7);
      previousPeriod.start.setDate(now.getDate() - 14);
      previousPeriod.end.setDate(now.getDate() - 8);
      break;
    case 'month':
      currentPeriod.start.setMonth(now.getMonth() - 1);
      previousPeriod.start.setMonth(now.getMonth() - 2);
      previousPeriod.end.setMonth(now.getMonth() - 1);
      break;
    case 'quarter':
      currentPeriod.start.setMonth(now.getMonth() - 3);
      previousPeriod.start.setMonth(now.getMonth() - 6);
      previousPeriod.end.setMonth(now.getMonth() - 3);
      break;
    default:
      currentPeriod.start.setDate(now.getDate() - 7);
      previousPeriod.start.setDate(now.getDate() - 14);
      previousPeriod.end.setDate(now.getDate() - 8);
  }

  return { currentPeriod, previousPeriod };
};

const getTotalSales = async (dateRange) => {
  const result = await Sales.aggregate([
    {
      $match: {
        date: { $gte: dateRange.start, $lte: dateRange.end }
      }
    },
    {
      $group: {
        _id: null,
        totalNSV: { $sum: '$nsv' },
        totalGSV: { $sum: '$gsv' }
      }
    }
  ]);

  return result[0] || { totalNSV: 0, totalGSV: 0 };
};

const getTotalOrders = async (dateRange) => {
  const result = await Sales.aggregate([
    {
      $match: {
        date: { $gte: dateRange.start, $lte: dateRange.end }
      }
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 }
      }
    }
  ]);

  return result[0]?.totalOrders || 0;
};

const getPeriodSales = async (dateRange) => {
  const result = await Sales.aggregate([
    {
      $match: {
        date: { $gte: dateRange.start, $lte: dateRange.end }
      }
    },
    {
      $group: {
        _id: null,
        totalNSV: { $sum: '$nsv' }
      }
    }
  ]);

  return result[0]?.totalNSV || 0;
};

const getTopStores = async (limit) => {
  return await Sales.aggregate([
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'store'
      }
    },
    {
      $unwind: '$store'
    },
    {
      $group: {
        _id: '$store._id',
        storeName: { $first: '$store.storeName' },
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' }
      }
    },
    {
      $sort: { totalNSV: -1 }
    },
    {
      $limit: parseInt(limit)
    }
  ]);
};

const getMonthlyTrends = async () => {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  return await Sales.aggregate([
    {
      $match: {
        date: { $gte: twelveMonthsAgo }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$date' },
          month: { $month: '$date' }
        },
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' },
        totalOrders: { $sum: 1 }
      }
    },
    {
      $sort: { '_id.year': 1, '_id.month': 1 }
    }
  ]);
};

const calculatePercentageChange = (previous, current) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
};

const generateForecast = async (actualDemand, period) => {
  // Simple forecast based on historical trends
  // You can enhance this with more sophisticated forecasting algorithms
  const forecast = actualDemand.map(item => ({
    productId: item._id,
    productName: item.productName,
    forecastedQuantity: Math.round(item.actualQuantity * 1.1), // 10% growth assumption
    forecastedNSV: Math.round(item.actualNSV * 1.1),
    confidence: 0.85
  }));

  return forecast;
};

/**
 * Get top performing products
 */
const getTopProducts = async (limit = 5, period = 'month') => {
  const dateRange = getDateRanges(period).currentPeriod;

  const products = await Sales.aggregate([
    {
      $match: {
        date: { $gte: dateRange.start, $lte: dateRange.end }
      }
    },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'product'
      }
    },
    {
      $unwind: '$product'
    },
    {
      $lookup: {
        from: 'categories',
        localField: 'product.category',
        foreignField: '_id',
        as: 'category'
      }
    },
    {
      $unwind: {
        path: '$category',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $group: {
        _id: '$product._id',
        productName: { $first: '$product.name' },
        productCode: { $first: '$product.softwareCode' },
        categoryName: { $first: { $ifNull: ['$category.name', 'Unknown Category'] } },
        categoryId: { $first: { $ifNull: ['$category._id', null] } },
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' },
        totalOrders: { $sum: 1 },
        avgOrderValue: { $avg: '$nsv' },
        avgQuantity: { $avg: '$quantity' }
      }
    },
    {
      $sort: { totalNSV: -1 }
    },
    {
      $limit: parseInt(limit)
    }
  ]);

  return {
    period,
    products
  };
};

/**
 * Get all stores performance (unlimited) with date range support
 */
const getAllStoresPerformance = async (startDate, endDate) => {
  let dateFilter = {};
  
  if (startDate && endDate) {
    dateFilter = {
      date: { $gte: new Date(startDate), $lte: new Date(endDate) }
    };
  }

  const stores = await Sales.aggregate([
    {
      $match: dateFilter
    },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'store'
      }
    },
    {
      $unwind: '$store'
    },
    {
      $group: {
        _id: '$store._id',
        storeName: { $first: '$store.storeName' },
        storeId: { $first: '$store.storeId' },
        city: { $first: '$store.city' },
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' },
        totalOrders: { $sum: 1 },
        avgOrderValue: { $avg: '$nsv' }
      }
    },
    {
      $sort: { totalNSV: -1 }
    }
  ]);

  return {
    stores,
    dateRange: startDate && endDate ? { startDate, endDate } : null,
    totalCount: stores.length
  };
};

/**
 * Get all products performance (unlimited) with date range support
 */
const getAllProductsPerformance = async (period = 'month', startDate, endDate) => {
  let dateFilter = {};
  
  if (startDate && endDate) {
    dateFilter = {
      date: { $gte: new Date(startDate), $lte: new Date(endDate) }
    };
  } else {
    const dateRange = getDateRanges(period).currentPeriod;
    dateFilter = {
      date: { $gte: dateRange.start, $lte: dateRange.end }
    };
  }

  const products = await Sales.aggregate([
    {
      $match: dateFilter
    },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'product'
      }
    },
    {
      $unwind: '$product'
    },
    {
      $lookup: {
        from: 'categories',
        localField: 'product.category',
        foreignField: '_id',
        as: 'category'
      }
    },
    {
      $unwind: {
        path: '$category',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $group: {
        _id: '$product._id',
        productName: { $first: '$product.name' },
        productCode: { $first: '$product.softwareCode' },
        categoryName: { $first: { $ifNull: ['$category.name', 'Unknown Category'] } },
        categoryId: { $first: { $ifNull: ['$category._id', null] } },
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' },
        totalOrders: { $sum: 1 },
        avgOrderValue: { $avg: '$nsv' },
        avgQuantity: { $avg: '$quantity' }
      }
    },
    {
      $sort: { totalNSV: -1 }
    }
  ]);

  return {
    period: startDate && endDate ? 'custom' : period,
    products,
    dateRange: startDate && endDate ? { startDate, endDate } : null,
    totalCount: products.length
  };
};

/**
 * Get all sales data (unlimited)
 */
const getAllSalesData = async (startDate, endDate) => {
  let dateFilter = {};
  
  if (startDate && endDate) {
    dateFilter = {
      date: { $gte: new Date(startDate), $lte: new Date(endDate) }
    };
  }

  const sales = await Sales.aggregate([
    {
      $match: dateFilter
    },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'store'
      }
    },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'product'
      }
    },
    {
      $unwind: '$store'
    },
    {
      $unwind: '$product'
    },
    {
      $lookup: {
        from: 'categories',
        localField: 'product.category',
        foreignField: '_id',
        as: 'category'
      }
    },
    {
      $unwind: {
        path: '$category',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $project: {
        _id: 1,
        date: 1,
        nsv: 1,
        gsv: 1,
        quantity: 1,
        storeName: '$store.storeName',
        storeId: '$store.storeId',
        storeCity: '$store.city',
        productName: '$product.name',
        productCode: '$product.softwareCode',
        categoryName: { $ifNull: ['$category.name', 'Unknown Category'] }
      }
    },
    {
      $sort: { date: -1 }
    }
  ]);

  return {
    sales,
    totalCount: sales.length,
    dateRange: startDate && endDate ? { startDate, endDate } : null
  };
};

/**
 * Get all categories analytics (unlimited) with date range support
 */
const getAllCategoriesAnalytics = async (period = 'month', startDate, endDate) => {
  let dateFilter = {};
  
  if (startDate && endDate) {
    dateFilter = {
      date: { $gte: new Date(startDate), $lte: new Date(endDate) }
    };
  } else {
    const dateRange = getDateRanges(period).currentPeriod;
    dateFilter = {
      date: { $gte: dateRange.start, $lte: dateRange.end }
    };
  }

  const categories = await Sales.aggregate([
    {
      $match: dateFilter
    },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'product'
      }
    },
    {
      $unwind: '$product'
    },
    {
      $lookup: {
        from: 'categories',
        localField: 'product.category',
        foreignField: '_id',
        as: 'category'
      }
    },
    {
      $unwind: {
        path: '$category',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $group: {
        _id: { $ifNull: ['$category._id', 'unknown'] },
        categoryName: { $first: { $ifNull: ['$category.name', 'Unknown Category'] } },
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' },
        totalOrders: { $sum: 1 },
        avgOrderValue: { $avg: '$nsv' },
        productCount: { $addToSet: '$product._id' }
      }
    },
    {
      $addFields: {
        productCount: { $size: '$productCount' }
      }
    },
    {
      $sort: { totalNSV: -1 }
    }
  ]);

  return {
    period: startDate && endDate ? 'custom' : period,
    categories,
    dateRange: startDate && endDate ? { startDate, endDate } : null,
    totalCount: categories.length
  };
};

/**
 * Get all cities performance (unlimited) with date range support
 */
const getAllCitiesPerformance = async (startDate, endDate) => {
  let dateFilter = {};
  
  if (startDate && endDate) {
    dateFilter = {
      date: { $gte: new Date(startDate), $lte: new Date(endDate) }
    };
  }

  const cities = await Sales.aggregate([
    {
      $match: dateFilter
    },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'store'
      }
    },
    {
      $unwind: '$store'
    },
    {
      $group: {
        _id: '$store.city',
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' },
        totalOrders: { $sum: 1 },
        storeCount: { $addToSet: '$store._id' },
        stores: { $addToSet: '$store.storeName' }
      }
    },
    {
      $addFields: {
        storeCount: { $size: '$storeCount' },
        avgOrderValue: { $divide: ['$totalNSV', '$totalOrders'] }
      }
    },
    {
      $sort: { totalNSV: -1 }
    }
  ]);

  return {
    cities,
    dateRange: startDate && endDate ? { startDate, endDate } : null,
    totalCount: cities.length
  };
};

export default {
  getDashboardData,
  getSalesAnalytics,
  getStorePerformance,
  getCategoryAnalytics,
  getCityPerformance,
  getDemandForecast,
  getTopProducts,
  getAllStoresPerformance,
  getAllProductsPerformance,
  getAllSalesData,
  getAllCategoriesAnalytics,
  getAllCitiesPerformance,
}; 