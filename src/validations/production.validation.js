import Joi from 'joi';
import { objectId } from './custom.validation.js';

// ==================== ORDER VALIDATIONS ====================

const createProductionOrder = {
  body: Joi.object().keys({
    orderNumber: Joi.string().optional(),
    priority: Joi.string().valid('Urgent', 'High', 'Medium', 'Low').required(),
    articles: Joi.array().items(
      Joi.object().keys({
        articleNumber: Joi.string().min(4).max(5).required(),
        plannedQuantity: Joi.number().integer().min(1).max(100000).required(),
        linkingType: Joi.string().valid('Auto Linking', 'Rosso Linking', 'Hand Linking').required(),
        priority: Joi.string().valid('Urgent', 'High', 'Medium', 'Low').required(),
        remarks: Joi.string().optional()
      })
    ).min(1).required(),
    orderNote: Joi.string().optional(),
    customerId: Joi.string().custom(objectId).optional(),
    customerName: Joi.string().optional(),
    customerOrderNumber: Joi.string().optional(),
    plannedStartDate: Joi.date().optional(),
    plannedEndDate: Joi.date().optional(),
    createdBy: Joi.string().custom(objectId).required()
  }),
};

const getProductionOrders = {
  query: Joi.object().keys({
    orderNumber: Joi.string(),
    priority: Joi.string().valid('Urgent', 'High', 'Medium', 'Low'),
    status: Joi.string().valid('Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled'),
    currentFloor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse'),
    customerId: Joi.string().custom(objectId),
    customerName: Joi.string(),
    customerOrderNumber: Joi.string(),
    createdBy: Joi.string().custom(objectId),
    lastModifiedBy: Joi.string().custom(objectId),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    populate: Joi.string()
  }),
};

const getProductionOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId),
  }),
};

const updateProductionOrder = {
  params: Joi.object().keys({
    orderId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      orderNumber: Joi.string(),
      priority: Joi.string().valid('Urgent', 'High', 'Medium', 'Low'),
      status: Joi.string().valid('Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled'),
      orderNote: Joi.string(),
      customerId: Joi.string().custom(objectId),
      customerName: Joi.string(),
      customerOrderNumber: Joi.string(),
      plannedStartDate: Joi.date(),
      plannedEndDate: Joi.date(),
      lastModifiedBy: Joi.string().custom(objectId)
    })
    .min(1),
};

const deleteProductionOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId),
  }),
};

// ==================== FLOOR OPERATIONS VALIDATIONS ====================

const getFloorOrders = {
  params: Joi.object().keys({
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse').required(),
  }),
  query: Joi.object().keys({
    status: Joi.string().valid('Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled'),
    priority: Joi.string().valid('Urgent', 'High', 'Medium', 'Low'),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    populate: Joi.string()
  }),
};

const updateArticleProgress = {
  params: Joi.object().keys({
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse').required(),
    orderId: Joi.string().custom(objectId).required(),
    articleId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    completedQuantity: Joi.number().integer().min(0).optional(),
    remarks: Joi.string().optional(),
    // Final Checking specific fields
    m1Quantity: Joi.number().integer().min(0).optional(),
    m2Quantity: Joi.number().integer().min(0).optional(),
    m3Quantity: Joi.number().integer().min(0).optional(),
    m4Quantity: Joi.number().integer().min(0).optional(),
    repairStatus: Joi.string().valid('Not Required', 'In Review', 'Repaired', 'Rejected').optional(),
    repairRemarks: Joi.string().optional(),
    userId: Joi.string().custom(objectId).required(),
    floorSupervisorId: Joi.string().custom(objectId).required(),
    machineId: Joi.string().optional(),
    shiftId: Joi.string().optional()
  }),
};

const transferArticle = {
  params: Joi.object().keys({
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse').required(),
    orderId: Joi.string().custom(objectId).required(),
    articleId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    remarks: Joi.string().optional(),
    userId: Joi.string().custom(objectId).required(),
    floorSupervisorId: Joi.string().custom(objectId).required(),
    batchNumber: Joi.string().optional()
  }),
};

const getFloorStatistics = {
  params: Joi.object().keys({
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse').required(),
  }),
  query: Joi.object().keys({
    dateFrom: Joi.date(),
    dateTo: Joi.date()
  }),
};

// ==================== QUALITY CONTROL VALIDATIONS ====================

const updateQualityCategories = {
  params: Joi.object().keys({
    articleId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    m1Quantity: Joi.number().integer().min(0).required(),
    m2Quantity: Joi.number().integer().min(0).required(),
    m3Quantity: Joi.number().integer().min(0).required(),
    m4Quantity: Joi.number().integer().min(0).required(),
    repairStatus: Joi.string().valid('Not Required', 'In Review', 'Repaired', 'Rejected').optional(),
    repairRemarks: Joi.string().optional(),
    userId: Joi.string().custom(objectId).required(),
    floorSupervisorId: Joi.string().custom(objectId).required()
  }),
};

const shiftM2Items = {
  params: Joi.object().keys({
    articleId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    fromM2: Joi.number().integer().min(1).required(),
    toM1: Joi.number().integer().min(0).optional(),
    toM3: Joi.number().integer().min(0).optional(),
    toM4: Joi.number().integer().min(0).optional(),
    remarks: Joi.string().optional(),
    userId: Joi.string().custom(objectId).required(),
    floorSupervisorId: Joi.string().custom(objectId).required()
  }).custom((value, helpers) => {
    const { fromM2, toM1 = 0, toM3 = 0, toM4 = 0 } = value;
    if (toM1 + toM3 + toM4 !== fromM2) {
      return helpers.error('any.invalid', { message: 'Total shifted quantities must equal M2 quantity to shift' });
    }
    return value;
  }),
};

const confirmFinalQuality = {
  params: Joi.object().keys({
    articleId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    confirmed: Joi.boolean().required(),
    remarks: Joi.string().optional(),
    userId: Joi.string().custom(objectId).required(),
    floorSupervisorId: Joi.string().custom(objectId).required()
  }),
};

const forwardToWarehouse = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    remarks: Joi.string().optional(),
    userId: Joi.string().custom(objectId).required(),
    floorSupervisorId: Joi.string().custom(objectId).required()
  }),
};

// ==================== REPORTS VALIDATIONS ====================

const getProductionDashboard = {
  query: Joi.object().keys({
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse')
  }),
};

const getEfficiencyReport = {
  query: Joi.object().keys({
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse'),
    dateFrom: Joi.date(),
    dateTo: Joi.date()
  }),
};

const getQualityReport = {
  query: Joi.object().keys({
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse'),
    dateFrom: Joi.date(),
    dateTo: Joi.date()
  }),
};

const getOrderTrackingReport = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
};

// ==================== LOGGING VALIDATIONS ====================

const getArticleLogs = {
  params: Joi.object().keys({
    articleId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    action: Joi.string(),
    limit: Joi.number().integer(),
    offset: Joi.number().integer(),
    sortBy: Joi.string(),
    page: Joi.number().integer()
  }),
};

const getOrderLogs = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    action: Joi.string(),
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse'),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer()
  }),
};

const getFloorLogs = {
  params: Joi.object().keys({
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse').required(),
  }),
  query: Joi.object().keys({
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    action: Joi.string(),
    userId: Joi.string().custom(objectId),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer()
  }),
};

const getUserLogs = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    action: Joi.string(),
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse'),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer()
  }),
};

const getLogStatistics = {
  query: Joi.object().keys({
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    groupBy: Joi.string().valid('day', 'week', 'month'),
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse'),
    action: Joi.string()
  }),
};

const getAuditTrail = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    includeSystemLogs: Joi.boolean(),
    includeUserActions: Joi.boolean()
  }),
};


// ==================== BULK OPERATIONS VALIDATIONS ====================

const bulkCreateOrders = {
  body: Joi.object().keys({
    orders: Joi.array().items(
      Joi.object().keys({
        orderNumber: Joi.string().optional(),
        priority: Joi.string().valid('Urgent', 'High', 'Medium', 'Low').required(),
        articles: Joi.array().items(
          Joi.object().keys({
            articleNumber: Joi.string().min(4).max(5).required(),
            plannedQuantity: Joi.number().integer().min(1).max(100000).required(),
            linkingType: Joi.string().valid('Auto Linking', 'Rosso Linking', 'Hand Linking').required(),
            priority: Joi.string().valid('Urgent', 'High', 'Medium', 'Low').required(),
            remarks: Joi.string().optional()
          })
        ).min(1).required(),
        orderNote: Joi.string().optional(),
        customerId: Joi.string().custom(objectId).optional(),
        customerName: Joi.string().optional(),
        customerOrderNumber: Joi.string().optional(),
        plannedStartDate: Joi.date().optional(),
        plannedEndDate: Joi.date().optional(),
        createdBy: Joi.string().custom(objectId).required()
      })
    ).min(1).max(100),
    batchSize: Joi.number().integer().min(1).max(50).default(50)
  }),
};

const bulkUpdateArticles = {
  body: Joi.object().keys({
    updates: Joi.array().items(
      Joi.object().keys({
        floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Branding', 'Final Checking', 'Warehouse').required(),
        orderId: Joi.string().custom(objectId).required(),
        articleId: Joi.string().custom(objectId).required(),
        completedQuantity: Joi.number().integer().min(0).optional(),
        remarks: Joi.string().optional(),
        m1Quantity: Joi.number().integer().min(0).optional(),
        m2Quantity: Joi.number().integer().min(0).optional(),
        m3Quantity: Joi.number().integer().min(0).optional(),
        m4Quantity: Joi.number().integer().min(0).optional(),
        repairStatus: Joi.string().valid('Not Required', 'In Review', 'Repaired', 'Rejected').optional(),
        repairRemarks: Joi.string().optional(),
        userId: Joi.string().custom(objectId).required(),
        floorSupervisorId: Joi.string().custom(objectId).required(),
        machineId: Joi.string().optional(),
        shiftId: Joi.string().optional()
      })
    ).min(1).max(100),
    batchSize: Joi.number().integer().min(1).max(50).default(50)
  }),
};

export default {
  // Order validations
  createProductionOrder,
  getProductionOrders,
  getProductionOrder,
  updateProductionOrder,
  deleteProductionOrder,
  
  // Floor operations validations
  getFloorOrders,
  updateArticleProgress,
  transferArticle,
  getFloorStatistics,
  
  // Quality control validations
  updateQualityCategories,
  shiftM2Items,
  confirmFinalQuality,
  forwardToWarehouse,
  
  // Reports validations
  getProductionDashboard,
  getEfficiencyReport,
  getQualityReport,
  getOrderTrackingReport,
  
  // Logging validations
  getArticleLogs,
  getOrderLogs,
  getFloorLogs,
  getUserLogs,
  getLogStatistics,
  getAuditTrail,
  
  // Bulk operations validations
  bulkCreateOrders,
  bulkUpdateArticles,
};
