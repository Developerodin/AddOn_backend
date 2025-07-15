import Sales from '../models/sales.model.js';
import Store from '../models/store.model.js';
import Product from '../models/product.model.js';
import Category from '../models/category.model.js';
import mongoose from 'mongoose';

/**
 * Get time-based sales trends
 * @param {Object} filter - Date range filter
 * @returns {Promise<Object>}
 */
export const getTimeBasedSalesTrends = async (filter = {}) => {
  const { dateFrom, dateTo, groupBy = 'day' } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  let groupStage;
  if (groupBy === 'month') {
    groupStage = {
      year: { $year: '$date' },
      month: { $month: '$date' }
    };
  } else {
    groupStage = {
      year: { $year: '$date' },
      month: { $month: '$date' },
      day: { $dayOfMonth: '$date' }
    };
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'plantData'
      }
    },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $group: {
        _id: groupStage,
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' },
        totalGSV: { $sum: '$gsv' },
        totalDiscount: { $sum: '$discount' },
        totalTax: { $sum: '$totalTax' },
        recordCount: { $sum: 1 }
      }
    },
    {
      $project: {
        _id: 0,
        date: {
          $dateFromParts: {
            year: '$_id.year',
            month: '$_id.month',
            day: '$_id.day'
          }
        },
        totalQuantity: '$totalQuantity',
        totalNSV: '$totalNSV',
        totalGSV: '$totalGSV',
        totalDiscount: '$totalDiscount',
        totalTax: '$totalTax',
        recordCount: '$recordCount'
      }
    },
    { $sort: { date: 1 } }
  ];

  return Sales.aggregate(pipeline);
};

/**
 * Get product performance analysis
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getProductPerformanceAnalysis = async (filter = {}) => {
  const { limit = 10, sortBy = 'quantity', dateFrom, dateTo } = filter;
  const limitNum = parseInt(limit, 10) || 10;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $unwind: '$productData'
    },
    {
      $lookup: {
        from: 'categories',
        localField: 'productData.category',
        foreignField: '_id',
        as: 'categoryData'
      }
    },
    {
      $unwind: {
        path: '$categoryData',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $group: {
        _id: '$materialCode',
        productName: { $first: '$productData.name' },
        productCode: { $first: '$productData.softwareCode' },
        categoryName: { $first: '$categoryData.name' },
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' },
        totalGSV: { $sum: '$gsv' },
        totalDiscount: { $sum: '$discount' },
        recordCount: { $sum: 1 }
      }
    },
    {
      $sort: { [`total${sortBy.charAt(0).toUpperCase() + sortBy.slice(1)}`]: -1 }
    },
    { $limit: limitNum }
  ];

  return Sales.aggregate(pipeline);
};

/**
 * Get store/plant-wise performance
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getStorePerformanceAnalysis = async (filter = {}) => {
  const { dateFrom, dateTo, sortBy = 'nsv' } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $unwind: '$storeData'
    },
    {
      $group: {
        _id: '$plant',
        storeName: { $first: '$storeData.storeName' },
        storeId: { $first: '$storeData.storeId' },
        city: { $first: '$storeData.city' },
        state: { $first: '$storeData.state' },
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' },
        totalGSV: { $sum: '$gsv' },
        totalDiscount: { $sum: '$discount' },
        totalTax: { $sum: '$totalTax' },
        recordCount: { $sum: 1 }
      }
    },
    {
      $sort: { [`total${sortBy.charAt(0).toUpperCase() + sortBy.slice(1)}`]: -1 }
    }
  ];

  return Sales.aggregate(pipeline);
};

/**
 * Get store heatmap data
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getStoreHeatmapData = async (filter = {}) => {
  const { dateFrom, dateTo } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $group: {
        _id: {
          storeId: '$plant',
          year: { $year: '$date' },
          month: { $month: '$date' },
          day: { $dayOfMonth: '$date' }
        },
        storeName: { $first: '$storeData.storeName' },
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' }
      }
    },
    {
      $project: {
        _id: 0,
        storeId: '$_id.storeId',
        storeName: 1,
        date: {
          $dateFromParts: {
            year: '$_id.year',
            month: '$_id.month',
            day: '$_id.day'
          }
        },
        totalNSV: '$totalNSV',
        totalQuantity: '$totalQuantity'
      }
    },
    { $sort: { date: 1, storeName: 1 } }
  ];

  return Sales.aggregate(pipeline);
};

/**
 * Get brand/division performance
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getBrandPerformanceAnalysis = async (filter = {}) => {
  const { dateFrom, dateTo } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $unwind: '$storeData'
    },
    {
      $group: {
        _id: '$storeData.brand',
        brandName: { $first: '$storeData.brand' },
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' },
        totalGSV: { $sum: '$gsv' },
        totalDiscount: { $sum: '$discount' },
        recordCount: { $sum: 1 }
      }
    },
    {
      $match: { _id: { $ne: null } }
    },
    {
      $sort: { totalNSV: -1 }
    }
  ];

  return Sales.aggregate(pipeline);
};

/**
 * Get discount impact analysis
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getDiscountImpactAnalysis = async (filter = {}) => {
  const { dateFrom, dateTo } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $addFields: {
        discountPercentage: {
          $cond: {
            if: { $gt: ['$gsv', 0] },
            then: { $multiply: [{ $divide: ['$discount', '$gsv'] }, 100] },
            else: 0
          }
        }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$date' },
          month: { $month: '$date' },
          day: { $dayOfMonth: '$date' }
        },
        avgDiscountPercentage: { $avg: '$discountPercentage' },
        totalDiscount: { $sum: '$discount' },
        totalNSV: { $sum: '$nsv' },
        totalTax: { $sum: '$totalTax' },
        recordCount: { $sum: 1 }
      }
    },
    {
      $project: {
        _id: 0,
        date: {
          $dateFromParts: {
            year: '$_id.year',
            month: '$_id.month',
            day: '$_id.day'
          }
        },
        avgDiscountPercentage: { $round: ['$avgDiscountPercentage', 2] },
        totalDiscount: '$totalDiscount',
        totalNSV: '$totalNSV',
        totalTax: '$totalTax',
        recordCount: '$recordCount'
      }
    },
    { $sort: { date: 1 } }
  ];

  return Sales.aggregate(pipeline);
};

/**
 * Get tax and MRP analytics
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getTaxAndMRPAnalytics = async (filter = {}) => {
  const { dateFrom, dateTo } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const dailyTaxPipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: {
          year: { $year: '$date' },
          month: { $month: '$date' },
          day: { $dayOfMonth: '$date' }
        },
        totalTax: { $sum: '$totalTax' },
        avgMRP: { $avg: '$mrp' },
        recordCount: { $sum: 1 }
      }
    },
    {
      $project: {
        _id: 0,
        date: {
          $dateFromParts: {
            year: '$_id.year',
            month: '$_id.month',
            day: '$_id.day'
          }
        },
        totalTax: '$totalTax',
        avgMRP: { $round: ['$avgMRP', 2] },
        recordCount: '$recordCount'
      }
    },
    { $sort: { date: 1 } }
  ];

  const mrpDistributionPipeline = [
    { $match: matchStage },
    {
      $bucket: {
        groupBy: '$mrp',
        boundaries: [0, 100, 200, 300, 400, 500, 1000, 2000, 5000],
        default: 'Above 5000',
        output: {
          count: { $sum: 1 },
          avgNSV: { $avg: '$nsv' }
        }
      }
    }
  ];

  const [dailyTaxData, mrpDistribution] = await Promise.all([
    Sales.aggregate(dailyTaxPipeline),
    Sales.aggregate(mrpDistributionPipeline)
  ]);

  return {
    dailyTaxData,
    mrpDistribution
  };
};

/**
 * Get summary KPIs
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getSummaryKPIs = async (filter = {}) => {
  const { dateFrom, dateTo } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const kpiPipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $group: {
        _id: null,
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' },
        totalGSV: { $sum: '$gsv' },
        totalDiscount: { $sum: '$discount' },
        totalTax: { $sum: '$totalTax' },
        recordCount: { $sum: 1 },
        avgDiscountPercentage: {
          $avg: {
            $cond: {
              if: { $gt: ['$gsv', 0] },
              then: { $multiply: [{ $divide: ['$discount', '$gsv'] }, 100] },
              else: 0
            }
          }
        }
      }
    },
    {
      $project: {
        _id: 0,
        totalQuantity: 1,
        totalNSV: 1,
        totalGSV: 1,
        totalDiscount: 1,
        totalTax: 1,
        recordCount: 1,
        avgDiscountPercentage: { $round: ['$avgDiscountPercentage', 2] }
      }
    }
  ];

  const topSellingProductPipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $group: {
        _id: '$materialCode',
        productName: { $first: '$productData.name' },
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' }
      }
    },
    {
      $sort: { totalQuantity: -1 }
    },
    { $limit: 1 }
  ];

  const [kpiData, topSellingProduct] = await Promise.all([
    Sales.aggregate(kpiPipeline),
    Sales.aggregate(topSellingProductPipeline)
  ]);

  return {
    ...kpiData[0],
    topSellingSKU: topSellingProduct[0] || null
  };
};

/**
 * Get comprehensive analytics dashboard data
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getAnalyticsDashboard = async (filter = {}) => {
  const [
    timeBasedTrends,
    productPerformance,
    storePerformance,
    brandPerformance,
    discountImpact,
    taxAndMRP,
    summaryKPIs
  ] = await Promise.all([
    getTimeBasedSalesTrends(filter),
    getProductPerformanceAnalysis({ ...filter, limit: 10 }),
    getStorePerformanceAnalysis(filter),
    getBrandPerformanceAnalysis(filter),
    getDiscountImpactAnalysis(filter),
    getTaxAndMRPAnalytics(filter),
    getSummaryKPIs(filter)
  ]);

  return {
    timeBasedTrends,
    productPerformance,
    storePerformance,
    brandPerformance,
    discountImpact,
    taxAndMRP,
    summaryKPIs
  };
}; 

/**
 * Get individual store analysis
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getIndividualStoreAnalysis = async (filter = {}) => {
  const { storeId, dateFrom, dateTo } = filter;
  
  if (!storeId) {
    throw new Error('Store ID is required');
  }

  const matchStage = { plant: new mongoose.Types.ObjectId(storeId) };
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  // Get store info
  const storeInfo = await Store.findById(storeId);
  if (!storeInfo) {
    throw new Error('Store not found');
  }

  // Get current month vs last month trend
  const currentDate = new Date();
  const currentMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const lastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  const nextMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);

  const currentMonthSales = await Sales.aggregate([
    { $match: { plant: new mongoose.Types.ObjectId(storeId), date: { $gte: currentMonth, $lt: nextMonth } } },
    {
      $group: {
        _id: null,
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' },
        totalOrders: { $sum: 1 }
      }
    }
  ]);

  const lastMonthSales = await Sales.aggregate([
    { $match: { plant: new mongoose.Types.ObjectId(storeId), date: { $gte: lastMonth, $lt: currentMonth } } },
    {
      $group: {
        _id: null,
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' },
        totalOrders: { $sum: 1 }
      }
    }
  ]);

  // Calculate trend percentage
  const currentNSV = currentMonthSales[0]?.totalNSV || 0;
  const lastNSV = lastMonthSales[0]?.totalNSV || 0;
  const trendPercentage = lastNSV > 0 ? ((currentNSV - lastNSV) / lastNSV) * 100 : 0;

  // Get gross LTV (lifetime value)
  const ltvData = await Sales.aggregate([
    { $match: { plant: new mongoose.Types.ObjectId(storeId) } },
    {
      $group: {
        _id: null,
        grossLTV: { $sum: '$nsv' },
        totalOrders: { $sum: 1 },
        totalQuantity: { $sum: '$quantity' }
      }
    }
  ]);

  // Monthly sales analysis
  const monthlySalesAnalysis = await Sales.aggregate([
    { $match: matchStage },
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
      $project: {
        _id: 0,
        month: {
          $dateFromParts: {
            year: '$_id.year',
            month: '$_id.month',
            day: 1
          }
        },
        totalNSV: { $round: ['$totalNSV', 2] },
        totalQuantity: '$totalQuantity',
        totalOrders: '$totalOrders'
      }
    },
    { $sort: { month: 1 } }
  ]);

  // Product sales analysis
  const productSalesAnalysis = await Sales.aggregate([
    { $match: matchStage },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $group: {
        _id: '$materialCode',
        productName: { $first: '$productData.name' },
        productCode: { $first: '$productData.softwareCode' },
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' },
        totalOrders: { $sum: 1 }
      }
    },
    {
      $project: {
        _id: 0,
        productId: '$_id',
        productName: 1,
        productCode: 1,
        totalNSV: { $round: ['$totalNSV', 2] },
        totalQuantity: '$totalQuantity',
        totalOrders: '$totalOrders'
      }
    },
    { $sort: { totalNSV: -1 } }
  ]);

  // All sales entries
  const salesEntries = await Sales.aggregate([
    { $match: matchStage },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $project: {
        _id: 1,
        date: 1,
        quantity: 1,
        mrp: 1,
        discount: 1,
        gsv: 1,
        nsv: 1,
        totalTax: 1,
        productName: { $first: '$productData.name' },
        productCode: { $first: '$productData.softwareCode' }
      }
    },
    { $sort: { date: -1 } }
  ]);

  return {
    storeInfo: {
      storeId: storeInfo.storeId,
      storeName: storeInfo.storeName,
      address: `${storeInfo.addressLine1}, ${storeInfo.city}, ${storeInfo.state}`,
      contactPerson: storeInfo.contactPerson,
      grossLTV: Math.round(ltvData[0]?.grossLTV || 0),
      currentMonthTrend: Math.round(trendPercentage),
      norms: storeInfo.totalNorms || 0,
      totalOrders: ltvData[0]?.totalOrders || 0,
      totalQuantity: ltvData[0]?.totalQuantity || 0
    },
    monthlySalesAnalysis,
    productSalesAnalysis,
    salesEntries
  };
};

/**
 * Get individual product analysis
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getIndividualProductAnalysis = async (filter = {}) => {
  const { productId, dateFrom, dateTo } = filter;
  
  if (!productId) {
    throw new Error('Product ID is required');
  }

  const matchStage = { materialCode: new mongoose.Types.ObjectId(productId) };
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  // Get product info
  const productInfo = await Product.findById(productId);
  if (!productInfo) {
    throw new Error('Product not found');
  }

  // Get current month vs last month trend
  const currentDate = new Date();
  const currentMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const lastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  const nextMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);

  const currentMonthSales = await Sales.aggregate([
    { $match: { materialCode: new mongoose.Types.ObjectId(productId), date: { $gte: currentMonth, $lt: nextMonth } } },
    {
      $group: {
        _id: null,
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' },
        totalUnits: { $sum: '$quantity' }
      }
    }
  ]);

  const lastMonthSales = await Sales.aggregate([
    { $match: { materialCode: new mongoose.Types.ObjectId(productId), date: { $gte: lastMonth, $lt: currentMonth } } },
    {
      $group: {
        _id: null,
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' },
        totalUnits: { $sum: '$quantity' }
      }
    }
  ]);

  // Calculate trend percentage
  const currentNSV = currentMonthSales[0]?.totalNSV || 0;
  const lastNSV = lastMonthSales[0]?.totalNSV || 0;
  const trendPercentage = lastNSV > 0 ? ((currentNSV - lastNSV) / lastNSV) * 100 : 0;

  // Get total sales data
  const totalSalesData = await Sales.aggregate([
    { $match: { materialCode: new mongoose.Types.ObjectId(productId) } },
    {
      $group: {
        _id: null,
        totalQuantity: { $sum: '$quantity' },
        totalUnits: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' }
      }
    }
  ]);

  // Monthly sales analysis
  const monthlySalesAnalysis = await Sales.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: {
          year: { $year: '$date' },
          month: { $month: '$date' }
        },
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' }
      }
    },
    {
      $project: {
        _id: 0,
        month: {
          $dateFromParts: {
            year: '$_id.year',
            month: '$_id.month',
            day: 1
          }
        },
        totalNSV: { $round: ['$totalNSV', 2] },
        totalQuantity: '$totalQuantity'
      }
    },
    { $sort: { month: 1 } }
  ]);

  // Store-wise sales analysis
  const storeWiseSalesAnalysis = await Sales.aggregate([
    { $match: matchStage },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $group: {
        _id: '$plant',
        storeName: { $first: '$storeData.storeName' },
        storeId: { $first: '$storeData.storeId' },
        totalNSV: { $sum: '$nsv' },
        totalQuantity: { $sum: '$quantity' }
      }
    },
    {
      $project: {
        _id: 0,
        storeId: '$_id',
        storeName: 1,
        storeCode: '$storeId',
        totalNSV: { $round: ['$totalNSV', 2] },
        totalQuantity: '$totalQuantity'
      }
    },
    { $sort: { totalNSV: -1 } }
  ]);

  // All sales entries
  const salesEntries = await Sales.aggregate([
    { $match: matchStage },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $project: {
        _id: 1,
        date: 1,
        quantity: 1,
        mrp: 1,
        discount: 1,
        gsv: 1,
        nsv: 1,
        totalTax: 1,
        storeName: { $first: '$storeData.storeName' },
        storeId: { $first: '$storeData.storeId' }
      }
    },
    { $sort: { date: -1 } }
  ]);

  return {
    productInfo: {
      productId: productInfo._id,
      productName: productInfo.name,
      productCode: productInfo.softwareCode,
      description: productInfo.description,
      totalQuantity: totalSalesData[0]?.totalQuantity || 0,
      totalUnits: totalSalesData[0]?.totalUnits || 0,
      currentTrend: Math.round(trendPercentage)
    },
    monthlySalesAnalysis,
    storeWiseSalesAnalysis,
    salesEntries
  };
};

/**
 * Get demand forecasting for stores
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getStoreDemandForecasting = async (filter = {}) => {
  const { storeId, months = 6 } = filter;
  
  const matchStage = {};
  if (storeId) {
    matchStage.plant = new mongoose.Types.ObjectId(storeId);
  }

  // Get historical data for the last 12 months
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const historicalData = await Sales.aggregate([
    { $match: { ...matchStage, date: { $gte: twelveMonthsAgo } } },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$date' },
          month: { $month: '$date' },
          productId: '$materialCode'
        },
        productName: { $first: '$productData.name' },
        productCode: { $first: '$productData.softwareCode' },
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' }
      }
    },
    {
      $project: {
        _id: 0,
        year: '$_id.year',
        month: '$_id.month',
        productId: '$_id.productId',
        productName: 1,
        productCode: 1,
        totalQuantity: 1,
        totalNSV: 1
      }
    },
    { $sort: { year: 1, month: 1 } }
  ]);

  // Simple forecasting using moving average
  const forecastData = [];
  const currentDate = new Date();

  for (let i = 1; i <= months; i++) {
    const forecastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
    
    // Group products and calculate forecast
    const productForecasts = {};
    
    historicalData.forEach(record => {
      if (!productForecasts[record.productId]) {
        productForecasts[record.productId] = {
          productId: record.productId,
          productName: record.productName,
          productCode: record.productCode,
          historicalQuantities: []
        };
      }
      productForecasts[record.productId].historicalQuantities.push(record.totalQuantity);
    });

    // Calculate forecast for each product
    Object.values(productForecasts).forEach(product => {
      const avgQuantity = product.historicalQuantities.length > 0 
        ? product.historicalQuantities.reduce((a, b) => a + b, 0) / product.historicalQuantities.length 
        : 0;
      
      const avgNSV = product.historicalQuantities.length > 0 
        ? historicalData
            .filter(r => r.productId.toString() === product.productId.toString())
            .reduce((sum, r) => sum + r.totalNSV, 0) / product.historicalQuantities.length 
        : 0;

      forecastData.push({
        forecastMonth: forecastMonth.toISOString().split('T')[0],
        productId: product.productId,
        productName: product.productName,
        productCode: product.productCode,
        forecastedQuantity: Math.round(avgQuantity),
        forecastedNSV: Math.round(avgNSV),
        confidence: Math.min(0.95, 0.7 + (product.historicalQuantities.length * 0.02))
      });
    });
  }

  return {
    forecastData,
    forecastPeriod: months,
    generatedAt: new Date().toISOString()
  };
};

/**
 * Get demand forecasting for products
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getProductDemandForecasting = async (filter = {}) => {
  const { productId, months = 6 } = filter;
  
  const matchStage = {};
  if (productId) {
    matchStage.materialCode = new mongoose.Types.ObjectId(productId);
  }

  // Get historical data for the last 12 months
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const historicalData = await Sales.aggregate([
    { $match: { ...matchStage, date: { $gte: twelveMonthsAgo } } },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$date' },
          month: { $month: '$date' },
          storeId: '$plant'
        },
        storeName: { $first: '$storeData.storeName' },
        storeId: { $first: '$storeData.storeId' },
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' }
      }
    },
    {
      $project: {
        _id: 0,
        year: '$_id.year',
        month: '$_id.month',
        storeId: '$_id.storeId',
        storeName: 1,
        storeCode: '$storeId',
        totalQuantity: 1,
        totalNSV: 1
      }
    },
    { $sort: { year: 1, month: 1 } }
  ]);

  // Simple forecasting using moving average
  const forecastData = [];
  const currentDate = new Date();

  for (let i = 1; i <= months; i++) {
    const forecastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
    
    // Group stores and calculate forecast
    const storeForecasts = {};
    
    historicalData.forEach(record => {
      if (!storeForecasts[record.storeId]) {
        storeForecasts[record.storeId] = {
          storeId: record.storeId,
          storeName: record.storeName,
          storeCode: record.storeCode,
          historicalQuantities: []
        };
      }
      storeForecasts[record.storeId].historicalQuantities.push(record.totalQuantity);
    });

    // Calculate forecast for each store
    Object.values(storeForecasts).forEach(store => {
      const avgQuantity = store.historicalQuantities.length > 0 
        ? store.historicalQuantities.reduce((a, b) => a + b, 0) / store.historicalQuantities.length 
        : 0;
      
      const avgNSV = store.historicalQuantities.length > 0 
        ? historicalData
            .filter(r => r.storeId.toString() === store.storeId.toString())
            .reduce((sum, r) => sum + r.totalNSV, 0) / store.historicalQuantities.length 
        : 0;

      forecastData.push({
        forecastMonth: forecastMonth.toISOString().split('T')[0],
        storeId: store.storeId,
        storeName: store.storeName,
        storeCode: store.storeCode,
        forecastedQuantity: Math.round(avgQuantity),
        forecastedNSV: Math.round(avgNSV),
        confidence: Math.min(0.95, 0.7 + (store.historicalQuantities.length * 0.02))
      });
    });
  }

  return {
    forecastData,
    forecastPeriod: months,
    generatedAt: new Date().toISOString()
  };
};

/**
 * Get replenishment recommendations for stores
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getStoreReplenishmentRecommendations = async (filter = {}) => {
  const { storeId } = filter;
  
  const matchStage = {};
  if (storeId) {
    matchStage.plant = new mongoose.Types.ObjectId(storeId);
  }

  // Get current inventory levels (assuming we have inventory data)
  // For now, we'll use sales data to estimate inventory needs
  
  // Get last 30 days sales
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentSales = await Sales.aggregate([
    { $match: { ...matchStage, date: { $gte: thirtyDaysAgo } } },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $group: {
        _id: '$materialCode',
        productName: { $first: '$productData.name' },
        productCode: { $first: '$productData.softwareCode' },
        totalQuantity: { $sum: '$quantity' },
        avgDailySales: { $avg: '$quantity' }
      }
    }
  ]);

  // Get store norms if available
  const storeInfo = storeId ? await Store.findById(storeId) : null;
  const storeNorms = storeInfo?.totalNorms || 1000; // Default norm

  const recommendations = recentSales.map(sale => {
    const dailySalesRate = sale.avgDailySales || 0;
    const monthlyProjection = dailySalesRate * 30;
    const recommendedStock = Math.max(monthlyProjection * 1.5, storeNorms * 0.1); // 1.5 months stock or 10% of norms
    const reorderPoint = Math.max(monthlyProjection * 0.5, storeNorms * 0.05); // 0.5 months stock or 5% of norms
    
    return {
      productId: sale._id,
      productName: sale.productName,
      productCode: sale.productCode,
      currentDailySales: Math.round(dailySalesRate),
      monthlyProjection: Math.round(monthlyProjection),
      recommendedStock: Math.round(recommendedStock),
      reorderPoint: Math.round(reorderPoint),
      priority: dailySalesRate > storeNorms * 0.01 ? 'High' : 'Medium',
      recommendation: dailySalesRate > storeNorms * 0.01 ? 'Increase stock levels' : 'Maintain current levels'
    };
  });

  return {
    recommendations,
    storeNorms,
    analysisPeriod: '30 days',
    generatedAt: new Date().toISOString()
  };
};

/**
 * Get replenishment recommendations for products
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getProductReplenishmentRecommendations = async (filter = {}) => {
  const { productId } = filter;
  
  const matchStage = {};
  if (productId) {
    matchStage.materialCode = new mongoose.Types.ObjectId(productId);
  }

  // Get last 30 days sales by store
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentSales = await Sales.aggregate([
    { $match: { ...matchStage, date: { $gte: thirtyDaysAgo } } },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $group: {
        _id: '$plant',
        storeName: { $first: '$storeData.storeName' },
        storeId: { $first: '$storeData.storeId' },
        totalQuantity: { $sum: '$quantity' },
        avgDailySales: { $avg: '$quantity' },
        storeNorms: { $first: '$storeData.totalNorms' }
      }
    }
  ]);

  const recommendations = recentSales.map(sale => {
    const dailySalesRate = sale.avgDailySales || 0;
    const monthlyProjection = dailySalesRate * 30;
    const storeNorms = sale.storeNorms || 1000;
    const recommendedStock = Math.max(monthlyProjection * 1.5, storeNorms * 0.1);
    const reorderPoint = Math.max(monthlyProjection * 0.5, storeNorms * 0.05);
    
    return {
      storeId: sale._id,
      storeName: sale.storeName,
      storeCode: sale.storeId,
      currentDailySales: Math.round(dailySalesRate),
      monthlyProjection: Math.round(monthlyProjection),
      recommendedStock: Math.round(recommendedStock),
      reorderPoint: Math.round(reorderPoint),
      storeNorms: storeNorms,
      priority: dailySalesRate > storeNorms * 0.01 ? 'High' : 'Medium',
      recommendation: dailySalesRate > storeNorms * 0.01 ? 'Increase stock levels' : 'Maintain current levels'
    };
  });

  return {
    recommendations,
    analysisPeriod: '30 days',
    generatedAt: new Date().toISOString()
  };
}; 

/**
 * Get complete time-based sales data (all records without limits)
 * @param {Object} filter - Date range filter
 * @returns {Promise<Object>}
 */
export const getCompleteTimeBasedSalesData = async (filter = {}) => {
  const { dateFrom, dateTo, groupBy = 'day' } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  let groupStage;
  if (groupBy === 'month') {
    groupStage = {
      year: { $year: '$date' },
      month: { $month: '$date' }
    };
  } else {
    groupStage = {
      year: { $year: '$date' },
      month: { $month: '$date' },
      day: { $dayOfMonth: '$date' }
    };
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'plantData'
      }
    },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $group: {
        _id: groupStage,
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' },
        totalGSV: { $sum: '$gsv' },
        totalDiscount: { $sum: '$discount' },
        totalTax: { $sum: '$totalTax' },
        recordCount: { $sum: 1 },
        allRecords: { $push: '$$ROOT' }
      }
    },
    {
      $project: {
        _id: 0,
        date: {
          $dateFromParts: {
            year: '$_id.year',
            month: '$_id.month',
            day: '$_id.day'
          }
        },
        totalQuantity: '$totalQuantity',
        totalNSV: '$totalNSV',
        totalGSV: '$totalGSV',
        totalDiscount: '$totalDiscount',
        totalTax: '$totalTax',
        recordCount: '$recordCount',
        allRecords: '$allRecords'
      }
    },
    { $sort: { date: 1 } }
  ];

  return Sales.aggregate(pipeline);
};

/**
 * Get complete product performance data (all products without limits)
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getCompleteProductPerformanceData = async (filter = {}) => {
  const { sortBy = 'quantity', dateFrom, dateTo } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $unwind: '$productData'
    },
    {
      $lookup: {
        from: 'categories',
        localField: 'productData.category',
        foreignField: '_id',
        as: 'categoryData'
      }
    },
    {
      $unwind: {
        path: '$categoryData',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $group: {
        _id: '$materialCode',
        productName: { $first: '$productData.name' },
        productCode: { $first: '$productData.softwareCode' },
        categoryName: { $first: '$categoryData.name' },
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' },
        totalGSV: { $sum: '$gsv' },
        totalDiscount: { $sum: '$discount' },
        recordCount: { $sum: 1 },
        allRecords: { $push: '$$ROOT' }
      }
    },
    {
      $sort: { [`total${sortBy.charAt(0).toUpperCase() + sortBy.slice(1)}`]: -1 }
    }
  ];

  return Sales.aggregate(pipeline);
};

/**
 * Get complete store performance data (all stores without limits)
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getCompleteStorePerformanceData = async (filter = {}) => {
  const { dateFrom, dateTo, sortBy = 'nsv' } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $unwind: '$storeData'
    },
    {
      $group: {
        _id: '$plant',
        storeName: { $first: '$storeData.storeName' },
        storeId: { $first: '$storeData.storeId' },
        city: { $first: '$storeData.city' },
        state: { $first: '$storeData.state' },
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' },
        totalGSV: { $sum: '$gsv' },
        totalDiscount: { $sum: '$discount' },
        totalTax: { $sum: '$totalTax' },
        recordCount: { $sum: 1 },
        allRecords: { $push: '$$ROOT' }
      }
    },
    {
      $sort: { [`total${sortBy.charAt(0).toUpperCase() + sortBy.slice(1)}`]: -1 }
    }
  ];

  return Sales.aggregate(pipeline);
}; 

/**
 * Get complete store heatmap data (all stores with detailed information)
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getCompleteStoreHeatmapData = async (filter = {}) => {
  const { dateFrom, dateTo } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $unwind: '$storeData'
    },
    {
      $group: {
        _id: '$plant',
        storeName: { $first: '$storeData.storeName' },
        storeId: { $first: '$storeData.storeId' },
        city: { $first: '$storeData.city' },
        state: { $first: '$storeData.state' },
        latitude: { $first: '$storeData.latitude' },
        longitude: { $first: '$storeData.longitude' },
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' },
        totalGSV: { $sum: '$gsv' },
        totalDiscount: { $sum: '$discount' },
        totalTax: { $sum: '$totalTax' },
        recordCount: { $sum: 1 },
        allRecords: { $push: '$$ROOT' }
      }
    },
    {
      $sort: { totalNSV: -1 }
    }
  ];

  return Sales.aggregate(pipeline);
};

/**
 * Get complete brand performance data (all brands with detailed information)
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getCompleteBrandPerformanceData = async (filter = {}) => {
  const { dateFrom, dateTo } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $unwind: '$productData'
    },
    {
      $lookup: {
        from: 'categories',
        localField: 'productData.category',
        foreignField: '_id',
        as: 'categoryData'
      }
    },
    {
      $unwind: {
        path: '$categoryData',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $group: {
        _id: '$productData.brand',
        brandName: { $first: '$productData.brand' },
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' },
        totalGSV: { $sum: '$gsv' },
        totalDiscount: { $sum: '$discount' },
        totalTax: { $sum: '$totalTax' },
        recordCount: { $sum: 1 },
        allRecords: { $push: '$$ROOT' }
      }
    },
    {
      $sort: { totalNSV: -1 }
    }
  ];

  return Sales.aggregate(pipeline);
};

/**
 * Get complete discount impact data (all discount records)
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getCompleteDiscountImpactData = async (filter = {}) => {
  const { dateFrom, dateTo } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $unwind: '$productData'
    },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $unwind: '$storeData'
    },
    {
      $group: {
        _id: {
          productId: '$materialCode',
          storeId: '$plant'
        },
        productName: { $first: '$productData.name' },
        productCode: { $first: '$productData.softwareCode' },
        storeName: { $first: '$storeData.storeName' },
        storeId: { $first: '$storeData.storeId' },
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' },
        totalGSV: { $sum: '$gsv' },
        totalDiscount: { $sum: '$discount' },
        discountPercentage: { $avg: { $multiply: [{ $divide: ['$discount', '$gsv'] }, 100] } },
        recordCount: { $sum: 1 },
        allRecords: { $push: '$$ROOT' }
      }
    },
    {
      $sort: { totalDiscount: -1 }
    }
  ];

  return Sales.aggregate(pipeline);
};

/**
 * Get complete tax and MRP data (all tax records)
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getCompleteTaxAndMRPData = async (filter = {}) => {
  const { dateFrom, dateTo } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $unwind: '$productData'
    },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $unwind: '$storeData'
    },
    {
      $group: {
        _id: {
          productId: '$materialCode',
          storeId: '$plant'
        },
        productName: { $first: '$productData.name' },
        productCode: { $first: '$productData.softwareCode' },
        mrp: { $first: '$productData.mrp' },
        storeName: { $first: '$storeData.storeName' },
        storeId: { $first: '$storeData.storeId' },
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' },
        totalGSV: { $sum: '$gsv' },
        totalTax: { $sum: '$totalTax' },
        totalMRP: { $sum: { $multiply: ['$quantity', '$productData.mrp'] } },
        taxPercentage: { $avg: { $multiply: [{ $divide: ['$totalTax', '$gsv'] }, 100] } },
        recordCount: { $sum: 1 },
        allRecords: { $push: '$$ROOT' }
      }
    },
    {
      $sort: { totalTax: -1 }
    }
  ];

  return Sales.aggregate(pipeline);
};

/**
 * Get complete summary KPIs data (all KPI calculations)
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getCompleteSummaryKPIsData = async (filter = {}) => {
  const { dateFrom, dateTo } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $group: {
        _id: null,
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' },
        totalGSV: { $sum: '$gsv' },
        totalDiscount: { $sum: '$discount' },
        totalTax: { $sum: '$totalTax' },
        recordCount: { $sum: 1 },
        uniqueProducts: { $addToSet: '$materialCode' },
        uniqueStores: { $addToSet: '$plant' },
        allRecords: { $push: '$$ROOT' }
      }
    },
    {
      $project: {
        _id: 0,
        totalQuantity: 1,
        totalNSV: 1,
        totalGSV: 1,
        totalDiscount: 1,
        totalTax: 1,
        recordCount: 1,
        uniqueProductCount: { $size: '$uniqueProducts' },
        uniqueStoreCount: { $size: '$uniqueStores' },
        averageOrderValue: { $divide: ['$totalNSV', '$recordCount'] },
        discountPercentage: { $multiply: [{ $divide: ['$totalDiscount', '$totalGSV'] }, 100] },
        taxPercentage: { $multiply: [{ $divide: ['$totalTax', '$totalGSV'] }, 100] },
        allRecords: 1
      }
    }
  ];

  return Sales.aggregate(pipeline);
};

/**
 * Get complete analytics dashboard data (all dashboard metrics)
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getCompleteAnalyticsDashboardData = async (filter = {}) => {
  const { dateFrom, dateTo } = filter;
  
  const matchStage = {};
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  // Get all the analytics data in parallel
  const [
    timeBasedTrends,
    productPerformance,
    storePerformance,
    brandPerformance,
    summaryKPIs
  ] = await Promise.all([
    getCompleteTimeBasedSalesData(filter),
    getCompleteProductPerformanceData(filter),
    getCompleteStorePerformanceData(filter),
    getCompleteBrandPerformanceData(filter),
    getCompleteSummaryKPIsData(filter)
  ]);

  return {
    timeBasedTrends,
    productPerformance,
    storePerformance,
    brandPerformance,
    summaryKPIs,
    generatedAt: new Date().toISOString(),
    allRecords: {
      timeBasedTrends,
      productPerformance,
      storePerformance,
      brandPerformance,
      summaryKPIs
    }
  };
};

/**
 * Get complete individual store analysis data
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getCompleteIndividualStoreAnalysisData = async (filter = {}) => {
  const { storeId, dateFrom, dateTo } = filter;
  
  if (!storeId) {
    throw new Error('Store ID is required for individual store analysis');
  }

  const matchStage = { plant: new mongoose.Types.ObjectId(storeId) };
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $unwind: '$storeData'
    },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $unwind: '$productData'
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          productId: '$materialCode'
        },
        productName: { $first: '$productData.name' },
        productCode: { $first: '$productData.softwareCode' },
        storeName: { $first: '$storeData.storeName' },
        storeId: { $first: '$storeData.storeId' },
        quantity: { $sum: '$quantity' },
        nsv: { $sum: '$nsv' },
        gsv: { $sum: '$gsv' },
        discount: { $sum: '$discount' },
        tax: { $sum: '$totalTax' },
        recordCount: { $sum: 1 },
        allRecords: { $push: '$$ROOT' }
      }
    },
    {
      $sort: { '_id.date': 1, '_id.productId': 1 }
    }
  ];

  return Sales.aggregate(pipeline);
};

/**
 * Get complete individual product analysis data
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getCompleteIndividualProductAnalysisData = async (filter = {}) => {
  const { productId, dateFrom, dateTo } = filter;
  
  if (!productId) {
    throw new Error('Product ID is required for individual product analysis');
  }

  const matchStage = { materialCode: new mongoose.Types.ObjectId(productId) };
  if (dateFrom || dateTo) {
    matchStage.date = {};
    if (dateFrom) matchStage.date.$gte = new Date(dateFrom);
    if (dateTo) matchStage.date.$lte = new Date(dateTo);
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $unwind: '$productData'
    },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $unwind: '$storeData'
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          storeId: '$plant'
        },
        productName: { $first: '$productData.name' },
        productCode: { $first: '$productData.softwareCode' },
        storeName: { $first: '$storeData.storeName' },
        storeId: { $first: '$storeData.storeId' },
        quantity: { $sum: '$quantity' },
        nsv: { $sum: '$nsv' },
        gsv: { $sum: '$gsv' },
        discount: { $sum: '$discount' },
        tax: { $sum: '$totalTax' },
        recordCount: { $sum: 1 },
        allRecords: { $push: '$$ROOT' }
      }
    },
    {
      $sort: { '_id.date': 1, '_id.storeId': 1 }
    }
  ];

  return Sales.aggregate(pipeline);
};

/**
 * Get complete store demand forecasting data
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getCompleteStoreDemandForecastingData = async (filter = {}) => {
  const { storeId, months = 3 } = filter;
  
  const matchStage = {};
  if (storeId) {
    matchStage.plant = new mongoose.Types.ObjectId(storeId);
  }

  // Get historical data for all stores
  const historicalData = await Sales.aggregate([
    { $match: matchStage },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $unwind: '$storeData'
    },
    {
      $group: {
        _id: {
          year: { $year: '$date' },
          month: { $month: '$date' },
          storeId: '$plant'
        },
        storeName: { $first: '$storeData.storeName' },
        storeCode: '$storeData.storeId',
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' },
        allRecords: { $push: '$$ROOT' }
      }
    },
    { $sort: { year: 1, month: 1 } }
  ]);

  // Generate complete forecasting data
  const forecastData = [];
  const currentDate = new Date();

  for (let i = 1; i <= months; i++) {
    const forecastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
    
    // Group stores and calculate forecast
    const storeForecasts = {};
    
    historicalData.forEach(record => {
      if (!storeForecasts[record._id.storeId]) {
        storeForecasts[record._id.storeId] = {
          storeId: record._id.storeId,
          storeName: record.storeName,
          storeCode: record.storeCode,
          historicalQuantities: [],
          historicalNSVs: [],
          allRecords: []
        };
      }
      storeForecasts[record._id.storeId].historicalQuantities.push(record.totalQuantity);
      storeForecasts[record._id.storeId].historicalNSVs.push(record.totalNSV);
      storeForecasts[record._id.storeId].allRecords.push(...record.allRecords);
    });

    // Calculate forecast for each store
    Object.values(storeForecasts).forEach(store => {
      const avgQuantity = store.historicalQuantities.length > 0 
        ? store.historicalQuantities.reduce((a, b) => a + b, 0) / store.historicalQuantities.length 
        : 0;
      
      const avgNSV = store.historicalNSVs.length > 0 
        ? store.historicalNSVs.reduce((a, b) => a + b, 0) / store.historicalNSVs.length 
        : 0;

      forecastData.push({
        forecastMonth: forecastMonth.toISOString().split('T')[0],
        storeId: store.storeId,
        storeName: store.storeName,
        storeCode: store.storeCode,
        forecastedQuantity: Math.round(avgQuantity),
        forecastedNSV: Math.round(avgNSV),
        confidence: Math.min(0.95, 0.7 + (store.historicalQuantities.length * 0.02)),
        historicalData: store.allRecords
      });
    });
  }

  return {
    forecastData,
    forecastPeriod: months,
    generatedAt: new Date().toISOString(),
    allRecords: historicalData
  };
};

/**
 * Get complete product demand forecasting data
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getCompleteProductDemandForecastingData = async (filter = {}) => {
  const { productId, months = 3 } = filter;
  
  const matchStage = {};
  if (productId) {
    matchStage.materialCode = new mongoose.Types.ObjectId(productId);
  }

  // Get historical data for all products
  const historicalData = await Sales.aggregate([
    { $match: matchStage },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $unwind: '$productData'
    },
    {
      $group: {
        _id: {
          year: { $year: '$date' },
          month: { $month: '$date' },
          productId: '$materialCode'
        },
        productName: { $first: '$productData.name' },
        productCode: { $first: '$productData.softwareCode' },
        totalQuantity: { $sum: '$quantity' },
        totalNSV: { $sum: '$nsv' },
        allRecords: { $push: '$$ROOT' }
      }
    },
    { $sort: { year: 1, month: 1 } }
  ]);

  // Generate complete forecasting data
  const forecastData = [];
  const currentDate = new Date();

  for (let i = 1; i <= months; i++) {
    const forecastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
    
    // Group products and calculate forecast
    const productForecasts = {};
    
    historicalData.forEach(record => {
      if (!productForecasts[record._id.productId]) {
        productForecasts[record._id.productId] = {
          productId: record._id.productId,
          productName: record.productName,
          productCode: record.productCode,
          historicalQuantities: [],
          historicalNSVs: [],
          allRecords: []
        };
      }
      productForecasts[record._id.productId].historicalQuantities.push(record.totalQuantity);
      productForecasts[record._id.productId].historicalNSVs.push(record.totalNSV);
      productForecasts[record._id.productId].allRecords.push(...record.allRecords);
    });

    // Calculate forecast for each product
    Object.values(productForecasts).forEach(product => {
      const avgQuantity = product.historicalQuantities.length > 0 
        ? product.historicalQuantities.reduce((a, b) => a + b, 0) / product.historicalQuantities.length 
        : 0;
      
      const avgNSV = product.historicalNSVs.length > 0 
        ? product.historicalNSVs.reduce((a, b) => a + b, 0) / product.historicalNSVs.length 
        : 0;

      forecastData.push({
        forecastMonth: forecastMonth.toISOString().split('T')[0],
        productId: product.productId,
        productName: product.productName,
        productCode: product.productCode,
        forecastedQuantity: Math.round(avgQuantity),
        forecastedNSV: Math.round(avgNSV),
        confidence: Math.min(0.95, 0.7 + (product.historicalQuantities.length * 0.02)),
        historicalData: product.allRecords
      });
    });
  }

  return {
    forecastData,
    forecastPeriod: months,
    generatedAt: new Date().toISOString(),
    allRecords: historicalData
  };
};

/**
 * Get complete store replenishment data
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getCompleteStoreReplenishmentData = async (filter = {}) => {
  const { storeId } = filter;
  
  const matchStage = {};
  if (storeId) {
    matchStage.plant = new mongoose.Types.ObjectId(storeId);
  }

  // Get last 30 days sales for all products
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentSales = await Sales.aggregate([
    { $match: { ...matchStage, date: { $gte: thirtyDaysAgo } } },
    {
      $lookup: {
        from: 'products',
        localField: 'materialCode',
        foreignField: '_id',
        as: 'productData'
      }
    },
    {
      $unwind: '$productData'
    },
    {
      $group: {
        _id: '$materialCode',
        productName: { $first: '$productData.name' },
        productCode: { $first: '$productData.softwareCode' },
        totalQuantity: { $sum: '$quantity' },
        avgDailySales: { $avg: '$quantity' },
        allRecords: { $push: '$$ROOT' }
      }
    }
  ]);

  // Get store norms if available
  const storeInfo = storeId ? await Store.findById(storeId) : null;
  const storeNorms = storeInfo?.totalNorms || 1000; // Default norm

  const recommendations = recentSales.map(sale => {
    const dailySalesRate = sale.avgDailySales || 0;
    const monthlyProjection = dailySalesRate * 30;
    const recommendedStock = Math.max(monthlyProjection * 1.5, storeNorms * 0.1);
    const reorderPoint = Math.max(monthlyProjection * 0.5, storeNorms * 0.05);
    
    return {
      productId: sale._id,
      productName: sale.productName,
      productCode: sale.productCode,
      currentDailySales: Math.round(dailySalesRate),
      monthlyProjection: Math.round(monthlyProjection),
      recommendedStock: Math.round(recommendedStock),
      reorderPoint: Math.round(reorderPoint),
      priority: dailySalesRate > storeNorms * 0.01 ? 'High' : 'Medium',
      recommendation: dailySalesRate > storeNorms * 0.01 ? 'Increase stock levels' : 'Maintain current levels',
      allRecords: sale.allRecords
    };
  });

  return {
    recommendations,
    storeNorms,
    analysisPeriod: '30 days',
    generatedAt: new Date().toISOString(),
    allRecords: recentSales
  };
};

/**
 * Get complete product replenishment data
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>}
 */
export const getCompleteProductReplenishmentData = async (filter = {}) => {
  const { productId } = filter;
  
  const matchStage = {};
  if (productId) {
    matchStage.materialCode = new mongoose.Types.ObjectId(productId);
  }

  // Get last 30 days sales by store for all stores
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentSales = await Sales.aggregate([
    { $match: { ...matchStage, date: { $gte: thirtyDaysAgo } } },
    {
      $lookup: {
        from: 'stores',
        localField: 'plant',
        foreignField: '_id',
        as: 'storeData'
      }
    },
    {
      $unwind: '$storeData'
    },
    {
      $group: {
        _id: '$plant',
        storeName: { $first: '$storeData.storeName' },
        storeId: { $first: '$storeData.storeId' },
        totalQuantity: { $sum: '$quantity' },
        avgDailySales: { $avg: '$quantity' },
        storeNorms: { $first: '$storeData.totalNorms' },
        allRecords: { $push: '$$ROOT' }
      }
    }
  ]);

  const recommendations = recentSales.map(sale => {
    const dailySalesRate = sale.avgDailySales || 0;
    const monthlyProjection = dailySalesRate * 30;
    const storeNorms = sale.storeNorms || 1000;
    const recommendedStock = Math.max(monthlyProjection * 1.5, storeNorms * 0.1);
    const reorderPoint = Math.max(monthlyProjection * 0.5, storeNorms * 0.05);
    
    return {
      storeId: sale._id,
      storeName: sale.storeName,
      storeCode: sale.storeId,
      currentDailySales: Math.round(dailySalesRate),
      monthlyProjection: Math.round(monthlyProjection),
      recommendedStock: Math.round(recommendedStock),
      reorderPoint: Math.round(reorderPoint),
      storeNorms: storeNorms,
      priority: dailySalesRate > storeNorms * 0.01 ? 'High' : 'Medium',
      recommendation: dailySalesRate > storeNorms * 0.01 ? 'Increase stock levels' : 'Maintain current levels',
      allRecords: sale.allRecords
    };
  });

  return {
    recommendations,
    analysisPeriod: '30 days',
    generatedAt: new Date().toISOString(),
    allRecords: recentSales
  };
}; 