import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import { cleanFilterObjectIds } from '../utils/validateObjectId.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as productionService from '../services/production/index.js';

// ==================== ORDER MANAGEMENT ====================

export const createProductionOrder = catchAsync(async (req, res) => {
  const order = await productionService.createProductionOrder(req.body, req.user);
  res.status(httpStatus.CREATED).send(order);
});

export const getProductionOrders = catchAsync(async (req, res) => {
  const allowedFilterFields = [
    'orderNumber', 'priority', 'status', 'currentFloor', 'customerId', 
    'customerName', 'customerOrderNumber', 'createdBy', 'lastModifiedBy'
  ];
  
  const filter = pick(req.query, allowedFilterFields);
  const cleanFilter = cleanFilterObjectIds(filter, ['customerId', 'createdBy', 'lastModifiedBy']);
  
  const allowedOptions = ['sortBy', 'limit', 'page', 'populate'];
  const options = pick(req.query, allowedOptions);
  
  if (options.limit) options.limit = parseInt(options.limit, 10);
  if (options.page) options.page = parseInt(options.page, 10);
  
  const result = await productionService.queryProductionOrders(cleanFilter, options);
  res.send(result);
});

export const getProductionOrder = catchAsync(async (req, res) => {
  const order = await productionService.getProductionOrderById(req.params.orderId);
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  }
  res.send(order);
});

export const updateProductionOrder = catchAsync(async (req, res) => {
  const order = await productionService.updateProductionOrderById(req.params.orderId, req.body);
  res.send(order);
});

export const deleteProductionOrder = catchAsync(async (req, res) => {
  await productionService.deleteProductionOrderById(req.params.orderId);
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Production order deleted successfully'
  });
});

// ==================== FLOOR OPERATIONS ====================

export const getFloorOrders = catchAsync(async (req, res) => {
  const { floor } = req.params;
  const allowedFilterFields = ['status', 'priority', 'search'];
  const filter = pick(req.query, allowedFilterFields);
  
  const allowedOptions = ['sortBy', 'limit', 'page', 'populate'];
  const options = pick(req.query, allowedOptions);
  
  if (options.limit) options.limit = parseInt(options.limit, 10);
  if (options.page) options.page = parseInt(options.page, 10);
  
  const result = await productionService.getOrdersByFloor(floor, filter, options);
  res.send(result);
});

export const updateArticleProgress = catchAsync(async (req, res) => {
  const { floor, orderId, articleId } = req.params;
  const article = await productionService.updateArticleProgress(floor, orderId, articleId, req.body, req.user);
  res.send(article);
});

export const transferArticle = catchAsync(async (req, res) => {
  const { floor, orderId, articleId } = req.params;
  const result = await productionService.transferArticle(floor, orderId, articleId, req.body, req.user);
  res.send(result);
});

export const getFloorStatistics = catchAsync(async (req, res) => {
  const { floor } = req.params;
  const { dateFrom, dateTo } = req.query;
  const statistics = await productionService.getFloorStatistics(floor, { dateFrom, dateTo });
  res.send(statistics);
});

// ==================== QUALITY CONTROL (FINAL CHECKING) ====================

export const updateQualityCategories = catchAsync(async (req, res) => {
  const { floor, articleId } = req.params;
  const article = await productionService.updateQualityCategories(articleId, req.body, req.user);
  res.send(article);
});

export const shiftM2Items = catchAsync(async (req, res) => {
  const { floor, articleId } = req.params;
  const result = await productionService.shiftM2Items(articleId, req.body, req.user);
  res.send(result);
});

export const confirmFinalQuality = catchAsync(async (req, res) => {
  const { articleId } = req.params;
  const result = await productionService.confirmFinalQuality(articleId, req.body, req.user);
  res.send(result);
});

export const forwardToWarehouse = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const result = await productionService.forwardToWarehouse(orderId, req.body, req.user);
  res.send(result);
});

export const qualityInspection = catchAsync(async (req, res) => {
  const { articleId } = req.params;
  const result = await productionService.qualityInspection(articleId, req.body, req.user);
  res.send(result);
});

// ==================== REPORTS AND ANALYTICS ====================

export const getProductionDashboard = catchAsync(async (req, res) => {
  const { dateFrom, dateTo, floor } = req.query;
  const dashboard = await productionService.getProductionDashboard({ dateFrom, dateTo, floor });
  res.send(dashboard);
});

export const getEfficiencyReport = catchAsync(async (req, res) => {
  const { floor, dateFrom, dateTo } = req.query;
  const report = await productionService.getEfficiencyReport({ floor, dateFrom, dateTo });
  res.send(report);
});

export const getQualityReport = catchAsync(async (req, res) => {
  const { floor, dateFrom, dateTo } = req.query;
  const report = await productionService.getQualityReport({ floor, dateFrom, dateTo });
  res.send(report);
});

export const getOrderTrackingReport = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const report = await productionService.getOrderTrackingReport(orderId);
  res.send(report);
});

// ==================== LOGGING AND AUDIT ====================

export const getArticleLogs = catchAsync(async (req, res) => {
  const { articleId } = req.params;
  const allowedFilterFields = ['dateFrom', 'dateTo', 'action', 'limit', 'offset'];
  const filter = pick(req.query, allowedFilterFields);
  
  const allowedOptions = ['sortBy', 'limit', 'page'];
  const options = pick(req.query, allowedOptions);
  
  if (options.limit) options.limit = parseInt(options.limit, 10);
  if (options.page) options.page = parseInt(options.page, 10);
  
  const result = await productionService.getArticleLogs(articleId, filter, options);
  res.send(result);
});

export const getOrderLogs = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const allowedFilterFields = ['dateFrom', 'dateTo', 'action', 'floor'];
  const filter = pick(req.query, allowedFilterFields);
  
  const allowedOptions = ['sortBy', 'limit', 'page'];
  const options = pick(req.query, allowedOptions);
  
  if (options.limit) options.limit = parseInt(options.limit, 10);
  if (options.page) options.page = parseInt(options.page, 10);
  
  const result = await productionService.getOrderLogs(orderId, filter, options);
  res.send(result);
});

export const getFloorLogs = catchAsync(async (req, res) => {
  const { floor } = req.params;
  const allowedFilterFields = ['dateFrom', 'dateTo', 'action', 'userId'];
  const filter = pick(req.query, allowedFilterFields);
  
  const allowedOptions = ['sortBy', 'limit', 'page'];
  const options = pick(req.query, allowedOptions);
  
  if (options.limit) options.limit = parseInt(options.limit, 10);
  if (options.page) options.page = parseInt(options.page, 10);
  
  const result = await productionService.getFloorLogs(floor, filter, options);
  res.send(result);
});

export const getUserLogs = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const allowedFilterFields = ['dateFrom', 'dateTo', 'action', 'floor'];
  const filter = pick(req.query, allowedFilterFields);
  
  const allowedOptions = ['sortBy', 'limit', 'page'];
  const options = pick(req.query, allowedOptions);
  
  if (options.limit) options.limit = parseInt(options.limit, 10);
  if (options.page) options.page = parseInt(options.page, 10);
  
  const result = await productionService.getUserLogs(userId, filter, options);
  res.send(result);
});

export const getLogStatistics = catchAsync(async (req, res) => {
  const allowedFilterFields = ['dateFrom', 'dateTo', 'groupBy', 'floor', 'action'];
  const filter = pick(req.query, allowedFilterFields);
  
  const statistics = await productionService.getLogStatistics(filter);
  res.send(statistics);
});

export const getAuditTrail = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const { includeSystemLogs, includeUserActions } = req.query;
  const auditTrail = await productionService.getAuditTrail(orderId, { 
    includeSystemLogs: includeSystemLogs === 'true', 
    includeUserActions: includeUserActions === 'true' 
  });
  res.send(auditTrail);
});


// ==================== BULK OPERATIONS ====================

export const bulkCreateOrders = catchAsync(async (req, res) => {
  const { orders, batchSize = 50 } = req.body;
  
  if (!orders || !Array.isArray(orders) || orders.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Orders array is required and must not be empty');
  }

  const results = await productionService.bulkCreateOrders(orders, batchSize, req.user);
  
  res.status(httpStatus.OK).send({
    message: 'Bulk order creation completed',
    results,
  });
});

export const bulkUpdateArticles = catchAsync(async (req, res) => {
  const { updates, batchSize = 50 } = req.body;
  
  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Updates array is required and must not be empty');
  }

  const results = await productionService.bulkUpdateArticles(updates, batchSize);
  
  res.status(httpStatus.OK).send({
    message: 'Bulk article update completed',
    results,
  });
});

// ==================== UTILITY FUNCTIONS ====================

export const fixCompletionStatus = catchAsync(async (req, res) => {
  const result = await productionService.fixCompletionStatus();
  res.status(httpStatus.OK).send(result);
});

export const fixDataCorruption = catchAsync(async (req, res) => {
  const { articleId } = req.params;
  const result = await productionService.fixDataCorruption(articleId);
  res.status(httpStatus.OK).send(result);
});

export const fixCompletionStatusForOrder = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const result = await productionService.fixCompletionStatus(orderId);
  res.status(httpStatus.OK).send(result);
});
