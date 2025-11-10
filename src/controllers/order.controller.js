import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as orderService from '../services/order.service.js';
import logger from '../config/logger.js';

/**
 * Sync orders from a specific source
 * @route POST /v1/orders/sync/:source
 */
const syncOrdersFromSource = catchAsync(async (req, res) => {
  const { source } = req.params;
  const options = pick(req.body, ['startDate', 'endDate', 'limit']);
  
  // Convert date strings to Date objects if provided
  if (options.startDate) {
    options.startDate = new Date(options.startDate);
  }
  if (options.endDate) {
    options.endDate = new Date(options.endDate);
  }

  const result = await orderService.syncOrdersFromSource(source, options);
  
  res.status(httpStatus.OK).json({
    success: true,
    message: `Orders synced from ${source}`,
    data: result,
  });
});

/**
 * Sync orders from all sources
 * @route POST /v1/orders/sync
 */
const syncOrdersFromAllSources = catchAsync(async (req, res) => {
  const options = pick(req.body, ['startDate', 'endDate', 'limit', 'sources']);
  
  // Convert date strings to Date objects if provided
  if (options.startDate) {
    options.startDate = new Date(options.startDate);
  }
  if (options.endDate) {
    options.endDate = new Date(options.endDate);
  }

  const result = await orderService.syncOrdersFromAllSources(options);
  
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Orders synced from all sources',
    data: result,
  });
});

/**
 * Create a new order
 * @route POST /v1/orders
 */
const createOrder = catchAsync(async (req, res) => {
  const order = await orderService.createOrder(req.body);
  res.status(httpStatus.CREATED).send(order);
});

/**
 * Get all orders
 * @route GET /v1/orders
 */
const getOrders = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['source', 'orderStatus', 'customer.email', 'logistics.trackingId']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await orderService.queryOrders(filter, options);
  res.send(result);
});

/**
 * Get order by ID
 * @route GET /v1/orders/:orderId
 */
const getOrder = catchAsync(async (req, res) => {
  const order = await orderService.getOrderById(req.params.orderId);
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  }
  res.send(order);
});

/**
 * Get order by source and external ID
 * @route GET /v1/orders/source/:source/:externalOrderId
 */
const getOrderBySourceAndExternalId = catchAsync(async (req, res) => {
  const { source, externalOrderId } = req.params;
  const order = await orderService.getOrderBySourceAndExternalId(source, externalOrderId);
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  }
  res.send(order);
});

/**
 * Update order by ID
 * @route PATCH /v1/orders/:orderId
 */
const updateOrder = catchAsync(async (req, res) => {
  const order = await orderService.updateOrderById(req.params.orderId, req.body);
  res.send(order);
});

/**
 * Update order status only
 * @route PATCH /v1/orders/:orderId/status
 */
const updateOrderStatus = catchAsync(async (req, res) => {
  const { orderStatus } = req.body;
  const order = await orderService.updateOrderStatus(req.params.orderId, orderStatus);
  res.send(order);
});

const buildWebsiteStatusHandler = (action) =>
  catchAsync(async (req, res) => {
    const { externalOrderId } = req.params;
    logger.debug(
      `Website status update request received ${JSON.stringify({
        action,
        externalOrderId,
        params: req.params,
        query: req.query,
        body: req.body,
      })}`
    );
    const result = await orderService.updateWebsiteOrderStatus(externalOrderId, action);
    logger.debug(
      `Website status update succeeded ${JSON.stringify({
        action,
        externalOrderId,
        medusaOrderId: result?.medusaOrder?.id || result?.medusaOrder?.order?.id,
        hasLocalOrder: Boolean(result?.order?._id),
      })}`
    );

    res.status(httpStatus.OK).json({
      success: true,
      message: `Website order ${externalOrderId} updated via ${action}`,
      data: result,
    });
  });

const cancelWebsiteOrder = buildWebsiteStatusHandler('cancel');
const completeWebsiteOrder = buildWebsiteStatusHandler('complete');
const archiveWebsiteOrder = buildWebsiteStatusHandler('archive');

/**
 * Update logistics information
 * @route PATCH /v1/orders/:orderId/logistics
 */
const updateLogistics = catchAsync(async (req, res) => {
  const order = await orderService.updateLogistics(req.params.orderId, req.body);
  res.send(order);
});

/**
 * Delete order by ID
 * @route DELETE /v1/orders/:orderId
 */
const deleteOrder = catchAsync(async (req, res) => {
  await orderService.deleteOrderById(req.params.orderId);
  res.status(httpStatus.NO_CONTENT).send();
});

/**
 * Get order statistics
 * @route GET /v1/orders/stats
 */
const getOrderStatistics = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['source', 'orderStatus']);
  const stats = await orderService.getOrderStatistics(filter);
  res.send(stats);
});

export {
  syncOrdersFromSource,
  syncOrdersFromAllSources,
  createOrder,
  getOrders,
  getOrder,
  getOrderBySourceAndExternalId,
  updateOrder,
  updateOrderStatus,
  cancelWebsiteOrder,
  completeWebsiteOrder,
  archiveWebsiteOrder,
  updateLogistics,
  deleteOrder,
  getOrderStatistics,
};
