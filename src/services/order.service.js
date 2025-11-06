import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import Order from '../models/order.model.js';
import logger from '../config/logger.js';

// Import source services
import * as websiteService from './sources/website.service.js';
import * as amazonService from './sources/amazon.service.js';
import * as flipkartService from './sources/flipkart.service.js';
import * as blinkitService from './sources/blinkit.service.js';

/**
 * Source service mapping
 */
const SOURCE_SERVICES = {
  Website: websiteService,
  Amazon: amazonService,
  Flipkart: flipkartService,
  Blinkit: blinkitService,
};

/**
 * Sync orders from a specific source
 * @param {string} source - Order source (Website, Amazon, Flipkart, Blinkit)
 * @param {Object} options - Sync options
 * @param {Date} [options.startDate] - Start date for fetching orders
 * @param {Date} [options.endDate] - End date for fetching orders
 * @param {number} [options.limit] - Maximum number of orders to fetch
 * @returns {Promise<Object>} Sync result with stats
 */
const syncOrdersFromSource = async (source, options = {}) => {
  const sourceService = SOURCE_SERVICES[source];
  
  if (!sourceService) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Invalid source: ${source}`);
  }

  try {
    logger.info(`Starting order sync from ${source}...`);
    
    // Fetch orders from the source
    const rawOrders = await sourceService.fetchOrders({
      startDate: options.startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Default: last 7 days
      endDate: options.endDate || new Date(),
      limit: options.limit || 100,
    });

    logger.info(`Fetched ${rawOrders.length} orders from ${source}`);

    // Normalize and save orders
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const rawOrder of rawOrders) {
      try {
        const normalizedOrder = sourceService.normalizeOrder(rawOrder);
        
        // Check if order already exists
        const existingOrder = await Order.findBySourceAndExternalId(
          normalizedOrder.source,
          normalizedOrder.externalOrderId
        );

        if (existingOrder) {
          // Update existing order
          Object.assign(existingOrder, normalizedOrder);
          existingOrder.timestamps.updatedAt = new Date();
          await existingOrder.save();
          updated++;
        } else {
          // Create new order
          await Order.create(normalizedOrder);
          created++;
        }
      } catch (error) {
        logger.error(`Error processing order from ${source}:`, error);
        errors++;
      }
    }

    const result = {
      source,
      totalFetched: rawOrders.length,
      created,
      updated,
      errors,
      success: errors === 0,
    };

    logger.info(`Order sync from ${source} completed:`, result);
    return result;
  } catch (error) {
    logger.error(`Error syncing orders from ${source}:`, error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to sync orders from ${source}: ${error.message}`
    );
  }
};

/**
 * Sync orders from all sources
 * @param {Object} options - Sync options
 * @param {Date} [options.startDate] - Start date for fetching orders
 * @param {Date} [options.endDate] - End date for fetching orders
 * @param {number} [options.limit] - Maximum number of orders per source
 * @param {Array<string>} [options.sources] - Specific sources to sync (default: all)
 * @returns {Promise<Object>} Combined sync results
 */
const syncOrdersFromAllSources = async (options = {}) => {
  const sources = options.sources || Object.keys(SOURCE_SERVICES);
  const results = [];
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  for (const source of sources) {
    try {
      const result = await syncOrdersFromSource(source, options);
      results.push(result);
      totalCreated += result.created;
      totalUpdated += result.updated;
      totalErrors += result.errors;
    } catch (error) {
      logger.error(`Failed to sync from ${source}:`, error);
      results.push({
        source,
        totalFetched: 0,
        created: 0,
        updated: 0,
        errors: 1,
        success: false,
        error: error.message,
      });
      totalErrors++;
    }
  }

  return {
    success: totalErrors === 0,
    summary: {
      totalCreated,
      totalUpdated,
      totalErrors,
      sourcesProcessed: sources.length,
    },
    results,
  };
};

/**
 * Create an order
 * @param {Object} orderBody
 * @returns {Promise<Order>}
 */
const createOrder = async (orderBody) => {
  // Check if order already exists
  const existingOrder = await Order.findBySourceAndExternalId(
    orderBody.source,
    orderBody.externalOrderId
  );
  
  if (existingOrder) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Order already exists');
  }

  return Order.create(orderBody);
};

/**
 * Query orders
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryOrders = async (filter, options) => {
  const orders = await Order.paginate(filter, options);
  return orders;
};

/**
 * Get order by ID
 * @param {ObjectId} id
 * @returns {Promise<Order>}
 */
const getOrderById = async (id) => {
  return Order.findById(id);
};

/**
 * Get order by source and external ID
 * @param {string} source
 * @param {string} externalOrderId
 * @returns {Promise<Order>}
 */
const getOrderBySourceAndExternalId = async (source, externalOrderId) => {
  return Order.findBySourceAndExternalId(source, externalOrderId);
};

/**
 * Update order by ID
 * @param {ObjectId} orderId
 * @param {Object} updateBody
 * @returns {Promise<Order>}
 */
const updateOrderById = async (orderId, updateBody) => {
  const order = await getOrderById(orderId);
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  }

  // Handle nested object updates (merge existing with updates)
  if (updateBody.customer) {
    const existingCustomer = order.customer?.toObject ? order.customer.toObject() : order.customer || {};
    order.customer = { ...existingCustomer, ...updateBody.customer };
  }
  if (updateBody.payment) {
    const existingPayment = order.payment?.toObject ? order.payment.toObject() : order.payment || {};
    order.payment = { ...existingPayment, ...updateBody.payment };
  }
  if (updateBody.logistics) {
    const existingLogistics = order.logistics?.toObject ? order.logistics.toObject() : order.logistics || {};
    order.logistics = { ...existingLogistics, ...updateBody.logistics };
  }
  if (updateBody.items) {
    order.items = updateBody.items;
  }
  if (updateBody.meta) {
    const existingMeta = order.meta?.toObject ? order.meta.toObject() : order.meta || {};
    order.meta = { ...existingMeta, ...updateBody.meta };
  }
  if (updateBody.orderStatus) {
    order.orderStatus = updateBody.orderStatus;
  }

  // Update timestamps
  order.timestamps.updatedAt = new Date();

  await order.save();
  return order;
};

/**
 * Update order status only
 * @param {ObjectId} orderId
 * @param {string} orderStatus
 * @returns {Promise<Order>}
 */
const updateOrderStatus = async (orderId, orderStatus) => {
  const order = await getOrderById(orderId);
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  }

  order.orderStatus = orderStatus;
  order.timestamps.updatedAt = new Date();
  await order.save();
  return order;
};

/**
 * Update logistics information
 * @param {ObjectId} orderId
 * @param {Object} logisticsUpdate
 * @returns {Promise<Order>}
 */
const updateLogistics = async (orderId, logisticsUpdate) => {
  const order = await getOrderById(orderId);
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  }

  const existingLogistics = order.logistics?.toObject ? order.logistics.toObject() : order.logistics || {};
  order.logistics = { ...existingLogistics, ...logisticsUpdate };
  order.timestamps.updatedAt = new Date();
  await order.save();
  return order;
};

/**
 * Delete order by ID
 * @param {ObjectId} orderId
 * @returns {Promise<Order>}
 */
const deleteOrderById = async (orderId) => {
  const order = await getOrderById(orderId);
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  }
  await order.remove();
  return order;
};

/**
 * Get order statistics
 * @param {Object} filter - Optional filter
 * @returns {Promise<Object>}
 */
const getOrderStatistics = async (filter = {}) => {
  const stats = await Order.aggregate([
    { $match: filter },
    {
      $group: {
        _id: {
          source: '$source',
          orderStatus: '$orderStatus',
        },
        count: { $sum: 1 },
        totalAmount: { $sum: '$payment.amount' },
      },
    },
    {
      $group: {
        _id: '$_id.source',
        statuses: {
          $push: {
            status: '$_id.orderStatus',
            count: '$count',
            amount: '$totalAmount',
          },
        },
        totalOrders: { $sum: '$count' },
        totalRevenue: { $sum: '$totalAmount' },
      },
    },
  ]);

  return stats;
};

export {
  syncOrdersFromSource,
  syncOrdersFromAllSources,
  createOrder,
  queryOrders,
  getOrderById,
  getOrderBySourceAndExternalId,
  updateOrderById,
  updateOrderStatus,
  updateLogistics,
  deleteOrderById,
  getOrderStatistics,
};
