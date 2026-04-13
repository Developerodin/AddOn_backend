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
        knittingCode: Joi.string().optional().allow(''),
        plannedQuantity: Joi.number().integer().min(1).max(100000).required(),
        linkingType: Joi.string().valid('Auto Linking', 'Rosso Linking', 'Hand Linking').required(),
        priority: Joi.string().valid('Urgent', 'High', 'Medium', 'Low').required(),
        remarks: Joi.string().optional(),
        machineId: Joi.string().custom(objectId).optional()
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
    currentFloor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'Warehouse', 'Dispatch'),
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
      lastModifiedBy: Joi.string().custom(objectId),
      articles: Joi.array().items(
        Joi.object().keys({
          _id: Joi.string().custom(objectId).optional(),
          id: Joi.string().optional(),
          articleNumber: Joi.string().min(4).max(5).optional(),
          knittingCode: Joi.string().optional().allow(''),
          plannedQuantity: Joi.number().integer().min(1).max(100000).optional(),
          linkingType: Joi.string().valid('Auto Linking', 'Rosso Linking', 'Hand Linking').optional(),
          priority: Joi.string().valid('Urgent', 'High', 'Medium', 'Low').optional(),
          remarks: Joi.string().optional(),
          machineId: Joi.string().custom(objectId).optional()
        })
      ).optional()
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
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'Warehouse', 'Dispatch').required(),
  }),
  query: Joi.object().keys({
    status: Joi.string().valid('Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled'),
    priority: Joi.string().valid('Urgent', 'High', 'Medium', 'Low'),
    search: Joi.string(),
    machineId: Joi.string().custom(objectId),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    populate: Joi.string()
  }),
};

/** Dispatch-only: same query as floor orders, but dispatch `transferredData` is pending warehouse inward only. */
const getDispatchPendingWarehousePrintOrders = {
  params: Joi.object().keys({
    floor: Joi.string().valid('Dispatch').required(),
  }),
  query: Joi.object().keys({
    status: Joi.string().valid('Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled'),
    priority: Joi.string().valid('Urgent', 'High', 'Medium', 'Low'),
    search: Joi.string(),
    machineId: Joi.string().custom(objectId),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    populate: Joi.string()
  }),
};

const updateArticleProgress = {
  params: Joi.object().keys({
    floor: Joi.string()
      .valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'FinalChecking', 'Warehouse', 'Dispatch')
      .required(),
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
    // Knitting floor: weight of article (e.g. kg)
    weight: Joi.number().min(0).optional(),
    repairStatus: Joi.string().valid('Not Required', 'In Review', 'Repaired', 'Rejected').optional(),
    repairRemarks: Joi.string().optional(),
    userId: Joi.string().custom(objectId).required(),
    floorSupervisorId: Joi.string().custom(objectId).required(),
    machineId: Joi.string().custom(objectId).optional(),
    shiftId: Joi.string().optional(),
    // Branding / Final Checking / Dispatch: breakdown by styleCode/brand when PATCH triggers transfer
    // transferItems = canonical; transferredData = alias (frontend may send either)
    transferItems: Joi.array().items(
      Joi.object().keys({
        transferred: Joi.number().integer().min(1).required(),
        styleCode: Joi.string().trim().allow('').optional(),
        brand: Joi.string().trim().allow('').optional()
      })
    ).optional(),
    transferredData: Joi.array().items(
      Joi.object().keys({
        transferred: Joi.number().integer().min(1).required(),
        styleCode: Joi.string().trim().allow('').optional(),
        brand: Joi.string().trim().allow('').optional()
      })
    ).optional()
  }),
};

const transferArticle = {
  params: Joi.object().keys({
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'Warehouse', 'Dispatch').required(),
    orderId: Joi.string().custom(objectId).required(),
    articleId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    remarks: Joi.string().optional(),
    userId: Joi.string().custom(objectId).required(),
    floorSupervisorId: Joi.string().custom(objectId).required(),
    batchNumber: Joi.string().optional(),
    machineId: Joi.string().custom(objectId).optional(),
    quantity: Joi.number().integer().min(0).optional(),
    // Branding / Final Checking / Dispatch: breakdown; sum of transferred must equal transfer quantity.
    transferItems: Joi.array().items(
      Joi.object().keys({
        transferred: Joi.number().integer().min(1).required(),
        styleCode: Joi.string().trim().allow('').optional(),
        brand: Joi.string().trim().allow('').optional()
      })
    ).optional(),
    transferredData: Joi.array().items(
      Joi.object().keys({
        transferred: Joi.number().integer().min(1).required(),
        styleCode: Joi.string().trim().allow('').optional(),
        brand: Joi.string().trim().allow('').optional()
      })
    ).optional()
  }),
};

const getFloorStatistics = {
  params: Joi.object().keys({
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'Warehouse', 'Dispatch').required(),
  }),
  query: Joi.object().keys({
    dateFrom: Joi.date(),
    dateTo: Joi.date()
  }),
};

// ==================== QUALITY CONTROL VALIDATIONS ====================

const updateQualityCategories = {
  params: Joi.object().keys({
    floor: Joi.string().valid('Checking', 'Secondary Checking', 'Final Checking').required(),
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

const transferM2ForRepair = {
  params: Joi.object().keys({
    floor: Joi.string().valid('Checking', 'Secondary Checking', 'Final Checking').required(),
    orderId: Joi.string().custom(objectId).required(),
    articleId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    quantity: Joi.number().integer().min(1).optional(),
    targetFloor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking').optional(),
    remarks: Joi.string().optional(),
    userId: Joi.string().custom(objectId).optional(),
    floorSupervisorId: Joi.string().custom(objectId).optional()
  }),
};

const shiftM2Items = {
  params: Joi.object().keys({
    floor: Joi.string().valid('Checking', 'Secondary Checking', 'Final Checking').required(),
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

/** Get single article by id */
const getArticle = {
  params: Joi.object().keys({
    articleId: Joi.string().custom(objectId).required(),
  }),
};

const qualityInspection = {
  params: Joi.object().keys({
    articleId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    inspectedQuantity: Joi.number().integer().min(0).allow(null).optional(),
    m1Quantity: Joi.number().integer().min(0).required(),
    m2Quantity: Joi.number().integer().min(0).required(),
    m3Quantity: Joi.number().integer().min(0).required(),
    m4Quantity: Joi.number().integer().min(0).required(),
    repairStatus: Joi.string().valid('Not Required', 'In Review', 'Repaired', 'Rejected').optional(),
    repairRemarks: Joi.string().allow('').optional(),
    remarks: Joi.string().allow('').optional(),
    floor: Joi.string().valid('Checking', 'Secondary Checking', 'Final Checking').optional(),
    userId: Joi.string().custom(objectId).optional(),
    floorSupervisorId: Joi.string().custom(objectId).optional(),
    machineId: Joi.string().optional(),
    shiftId: Joi.string().optional(),
    // For Final Checking: brand-wise transfer breakdown when M1 transfers to Warehouse
    transferItems: Joi.array().items(
      Joi.object().keys({
        transferred: Joi.number().integer().min(1).required(),
        styleCode: Joi.string().trim().allow('').optional(),
        brand: Joi.string().trim().allow('').optional()
      })
    ).optional()
  }).custom((value, helpers) => {
    const { inspectedQuantity, m1Quantity, m2Quantity, m3Quantity, m4Quantity } = value;
    const totalQualityQuantities = m1Quantity + m2Quantity + m3Quantity + m4Quantity;
    
    // Skip validation if inspectedQuantity is null
    if (inspectedQuantity !== null && totalQualityQuantities !== inspectedQuantity) {
      return helpers.error('any.invalid', { 
        message: `Total quality quantities (${totalQualityQuantities}) must equal inspected quantity (${inspectedQuantity})` 
      });
    }
    return value;
  }),
};

// ==================== REPORTS VALIDATIONS ====================

const getProductionDashboard = {
  query: Joi.object().keys({
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'Warehouse', 'Dispatch')
  }),
};

const getEfficiencyReport = {
  query: Joi.object().keys({
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'Warehouse', 'Dispatch'),
    dateFrom: Joi.date(),
    dateTo: Joi.date()
  }),
};

const getQualityReport = {
  query: Joi.object().keys({
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'Warehouse', 'Dispatch'),
    dateFrom: Joi.date(),
    dateTo: Joi.date()
  }),
};

const getOrderTrackingReport = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
};

const getArticleWiseData = {
  query: Joi.object().keys({
    articleNumber: Joi.string().min(1).max(20),
    knittingCode: Joi.string().min(1).max(50).optional(),
    search: Joi.string().min(1).max(50),
    status: Joi.string().valid('Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled'),
    orderNumber: Joi.string().min(1).max(50),
    limit: Joi.number().integer().min(1).max(100),
    page: Joi.number().integer().min(1),
    logsPerArticle: Joi.number().integer().min(1).max(100),
  }),
};

/** Update receivedData for a floor on an article. quantity = container qty to add to received (container accept flow) */
const updateArticleFloorReceivedData = {
  params: Joi.object().keys({
    articleId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    floor: Joi.string()
      .valid(
        'Knitting',
        'Linking',
        'Checking',
        'Washing',
        'Boarding',
        'Silicon',
        'Secondary Checking',
        'Branding',
        'Final Checking',
        'Warehouse',
        'Dispatch'
      )
      .required(),
    receivedData: Joi.object()
      .keys({
        receivedStatusFromPreviousFloor: Joi.string().trim().allow('', null),
        receivedInContainerId: Joi.string().custom(objectId).allow(null),
        receivedTimestamp: Joi.date().allow(null),
        transferred: Joi.number().integer().min(0).optional(),
        styleCode: Joi.string().trim().allow('', null).optional(),
        brand: Joi.string().trim().allow('', null).optional(),
      })
      .optional(),
    quantity: Joi.number().integer().min(0).optional(),
    // For Branding/Final Checking: breakdown by styleCode/brand. Sum of transferred = total quantity.
    receivedTransferItems: Joi.array().items(
      Joi.object().keys({
        transferred: Joi.number().integer().min(1).required(),
        styleCode: Joi.string().trim().allow('').optional(),
        brand: Joi.string().trim().allow('').optional()
      })
    ).optional()
  }),
};

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
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'Warehouse', 'Dispatch'),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer()
  }),
};

const getFloorLogs = {
  params: Joi.object().keys({
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'Warehouse', 'Dispatch').required(),
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
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'Warehouse', 'Dispatch'),
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
    floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'Warehouse', 'Dispatch'),
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
            knittingCode: Joi.string().optional().allow(''),
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
        floor: Joi.string().valid('Knitting', 'Linking', 'Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking', 'Branding', 'Final Checking', 'Warehouse', 'Dispatch').required(),
        orderId: Joi.string().custom(objectId).required(),
        articleId: Joi.string().custom(objectId).required(),
        completedQuantity: Joi.number().integer().min(0).optional(),
        remarks: Joi.string().optional(),
        m1Quantity: Joi.number().integer().min(0).optional(),
        m2Quantity: Joi.number().integer().min(0).optional(),
        m3Quantity: Joi.number().integer().min(0).optional(),
        m4Quantity: Joi.number().integer().min(0).optional(),
        weight: Joi.number().min(0).optional(),
        repairStatus: Joi.string().valid('Not Required', 'In Review', 'Repaired', 'Rejected').optional(),
        repairRemarks: Joi.string().optional(),
        userId: Joi.string().custom(objectId).required(),
        floorSupervisorId: Joi.string().custom(objectId).required(),
        machineId: Joi.string().custom(objectId).optional(),
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
  getDispatchPendingWarehousePrintOrders,
  updateArticleProgress,
  transferArticle,
  getFloorStatistics,
  
  // Quality control validations
  updateQualityCategories,
  transferM2ForRepair,
  shiftM2Items,
  confirmFinalQuality,
  forwardToWarehouse,
  qualityInspection,
  getArticle,
  
  // Reports validations
  getProductionDashboard,
  getEfficiencyReport,
  getQualityReport,
  getOrderTrackingReport,
  getArticleWiseData,

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
  updateArticleFloorReceivedData,
};
