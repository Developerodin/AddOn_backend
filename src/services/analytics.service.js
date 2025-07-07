import Sales from '../models/sales.model.js';
import Store from '../models/store.model.js';
import Product from '../models/product.model.js';
import Category from '../models/category.model.js';

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
      $lookup: {
        from: 'categories',
        localField: 'productData.category',
        foreignField: '_id',
        as: 'categoryData'
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