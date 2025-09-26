import httpStatus from 'http-status';
import { Article, ArticleLog } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Update quality categories for an article in Checking or Final Checking
 * @param {ObjectId} articleId
 * @param {Object} qualityData
 * @returns {Promise<Article>}
 */
export const updateQualityCategories = async (articleId, qualityData) => {
  const article = await Article.findById(articleId);
  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
  }

  if (article.currentFloor !== 'Checking' && article.currentFloor !== 'Final Checking') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Article must be on Checking or Final Checking floor');
  }

  const {
    m1Quantity = 0,
    m2Quantity = 0,
    m3Quantity = 0,
    m4Quantity = 0,
    repairStatus = 'Not Required',
    repairRemarks = '',
    userId,
    floorSupervisorId
  } = qualityData;

  // Validate quality quantities
  const totalQualityQuantity = m1Quantity + m2Quantity + m3Quantity + m4Quantity;
  if (totalQualityQuantity > article.completedQuantity) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Total quality quantities cannot exceed completed quantity');
  }

  // Store previous values for logging
  const previousValues = {
    m1Quantity: article.m1Quantity || 0,
    m2Quantity: article.m2Quantity || 0,
    m3Quantity: article.m3Quantity || 0,
    m4Quantity: article.m4Quantity || 0,
    repairStatus: article.repairStatus || 'Not Required'
  };

  // Update quality categories
  article.m1Quantity = m1Quantity;
  article.m2Quantity = m2Quantity;
  article.m3Quantity = m3Quantity;
  article.m4Quantity = m4Quantity;
  article.repairStatus = repairStatus;
  article.repairRemarks = repairRemarks;

  await article.save();

  // Create logs for each quality category update
  if (m1Quantity !== previousValues.m1Quantity) {
    await createArticleLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      action: 'M1 Quantity Updated',
      quantity: m1Quantity,
      remarks: `M1 quantity updated to ${m1Quantity}`,
      previousValue: previousValues.m1Quantity,
      newValue: m1Quantity,
      changeReason: 'Quality inspection',
      userId,
      floorSupervisorId,
      qualityStatus: 'M1 - Good Quality'
    });
  }

  if (m2Quantity !== previousValues.m2Quantity) {
    await createArticleLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      action: 'M2 Quantity Updated',
      quantity: m2Quantity,
      remarks: `M2 quantity updated to ${m2Quantity}`,
      previousValue: previousValues.m2Quantity,
      newValue: m2Quantity,
      changeReason: 'Quality inspection',
      userId,
      floorSupervisorId,
      qualityStatus: 'M2 - Needs Repair'
    });
  }

  if (m3Quantity !== previousValues.m3Quantity) {
    await createArticleLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      action: 'M3 Quantity Updated',
      quantity: m3Quantity,
      remarks: `M3 quantity updated to ${m3Quantity}`,
      previousValue: previousValues.m3Quantity,
      newValue: m3Quantity,
      changeReason: 'Quality inspection',
      userId,
      floorSupervisorId,
      qualityStatus: 'M3 - Minor Defects'
    });
  }

  if (m4Quantity !== previousValues.m4Quantity) {
    await createArticleLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      action: 'M4 Quantity Updated',
      quantity: m4Quantity,
      remarks: `M4 quantity updated to ${m4Quantity}`,
      previousValue: previousValues.m4Quantity,
      newValue: m4Quantity,
      changeReason: 'Quality inspection',
      userId,
      floorSupervisorId,
      qualityStatus: 'M4 - Major Defects'
    });
  }

  if (repairStatus !== previousValues.repairStatus) {
    await createArticleLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      action: 'Repair Status Updated',
      quantity: 0,
      remarks: `Repair status updated to ${repairStatus}`,
      previousValue: previousValues.repairStatus,
      newValue: repairStatus,
      changeReason: 'Quality control process',
      userId,
      floorSupervisorId
    });
  }

  return article;
};

/**
 * Shift M2 items to other quality categories
 * @param {ObjectId} articleId
 * @param {Object} shiftData
 * @returns {Promise<Object>}
 */
export const shiftM2Items = async (articleId, shiftData) => {
  const article = await Article.findById(articleId);
  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
  }

  if (article.currentFloor !== 'Final Checking') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Article must be on Final Checking floor');
  }

  const {
    fromM2,
    toM1 = 0,
    toM3 = 0,
    toM4 = 0,
    remarks = '',
    userId,
    floorSupervisorId
  } = shiftData;

  // Validate shift quantities
  const totalShifted = toM1 + toM3 + toM4;
  if (totalShifted !== fromM2) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Total shifted quantities must equal M2 quantity to shift');
  }

  if (fromM2 > article.m2Quantity) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot shift more M2 items than available');
  }

  // Store previous values
  const previousValues = {
    m1Quantity: article.m1Quantity || 0,
    m2Quantity: article.m2Quantity || 0,
    m3Quantity: article.m3Quantity || 0,
    m4Quantity: article.m4Quantity || 0
  };

  // Update quantities
  article.m1Quantity = (article.m1Quantity || 0) + toM1;
  article.m2Quantity = (article.m2Quantity || 0) - fromM2;
  article.m3Quantity = (article.m3Quantity || 0) + toM3;
  article.m4Quantity = (article.m4Quantity || 0) + toM4;

  await article.save();

  // Create logs for each shift
  if (toM1 > 0) {
    await createArticleLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      action: 'M2 Item Shifted to M1',
      quantity: toM1,
      remarks: `${toM1} M2 items shifted to M1. ${remarks}`,
      previousValue: previousValues.m2Quantity,
      newValue: article.m2Quantity,
      changeReason: 'M2 repair process - items successfully repaired',
      userId,
      floorSupervisorId,
      qualityStatus: 'M1 - Good Quality'
    });
  }

  if (toM3 > 0) {
    await createArticleLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      action: 'M2 Item Shifted to M3',
      quantity: toM3,
      remarks: `${toM3} M2 items shifted to M3. ${remarks}`,
      previousValue: previousValues.m2Quantity,
      newValue: article.m2Quantity,
      changeReason: 'M2 repair process - items have minor defects',
      userId,
      floorSupervisorId,
      qualityStatus: 'M3 - Minor Defects'
    });
  }

  if (toM4 > 0) {
    await createArticleLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      action: 'M2 Item Shifted to M4',
      quantity: toM4,
      remarks: `${toM4} M2 items shifted to M4. ${remarks}`,
      previousValue: previousValues.m2Quantity,
      newValue: article.m2Quantity,
      changeReason: 'M2 repair process - items have major defects',
      userId,
      floorSupervisorId,
      qualityStatus: 'M4 - Major Defects'
    });
  }

  return {
    article,
    shiftDetails: {
      fromM2,
      toM1,
      toM3,
      toM4,
      previousValues,
      newValues: {
        m1Quantity: article.m1Quantity,
        m2Quantity: article.m2Quantity,
        m3Quantity: article.m3Quantity,
        m4Quantity: article.m4Quantity
      }
    }
  };
};

/**
 * Confirm final quality for an article
 * @param {ObjectId} articleId
 * @param {Object} confirmData
 * @returns {Promise<Object>}
 */
export const confirmFinalQuality = async (articleId, confirmData) => {
  const article = await Article.findById(articleId);
  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
  }

  if (article.currentFloor !== 'Final Checking') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Article must be on Final Checking floor');
  }

  const { confirmed, remarks = '', userId, floorSupervisorId } = confirmData;

  // Validate quality quantities before confirmation
  const totalQualityQuantity = (article.m1Quantity || 0) + (article.m2Quantity || 0) + 
                              (article.m3Quantity || 0) + (article.m4Quantity || 0);
  
  if (totalQualityQuantity !== article.completedQuantity) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Quality quantities must equal completed quantity before confirmation');
  }

  // Check if M2 items are properly handled
  if (article.m2Quantity > 0 && article.repairStatus === 'In Review') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'M2 items must be reviewed before final confirmation');
  }

  const previousValue = article.finalQualityConfirmed;
  article.finalQualityConfirmed = confirmed;
  await article.save();

  // Create confirmation log
  await createArticleLog({
    articleId: article._id.toString(),
    orderId: article.orderId.toString(),
    action: confirmed ? 'Final Quality Confirmed' : 'Final Quality Rejected',
    quantity: article.completedQuantity,
    remarks: confirmed ? 
      `Final quality confirmed for ${article.completedQuantity} units. ${remarks}` :
      `Final quality rejected. ${remarks}`,
    previousValue,
    newValue: confirmed,
    changeReason: 'Final quality control process',
    userId,
    floorSupervisorId,
    qualityStatus: confirmed ? 'Approved for Warehouse' : 'Rejected'
  });

  return {
    article,
    confirmationDetails: {
      confirmed,
      totalQuantity: article.completedQuantity,
      qualityBreakdown: {
        m1: article.m1Quantity || 0,
        m2: article.m2Quantity || 0,
        m3: article.m3Quantity || 0,
        m4: article.m4Quantity || 0
      },
      timestamp: new Date().toISOString()
    }
  };
};

/**
 * Forward order to warehouse after quality confirmation
 * @param {ObjectId} orderId
 * @param {Object} forwardData
 * @returns {Promise<Object>}
 */
export const forwardToWarehouse = async (orderId, forwardData) => {
  const order = await ProductionOrder.findById(orderId).populate('articles');
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  }

  if (order.currentFloor !== 'Final Checking') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Order must be on Final Checking floor');
  }

  // Check if all articles are quality confirmed
  const unconfirmedArticles = order.articles.filter(article => !article.finalQualityConfirmed);
  if (unconfirmedArticles.length > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'All articles must be quality confirmed before forwarding to warehouse');
  }

  const { remarks = '', userId, floorSupervisorId } = forwardData;

  // Update order
  order.currentFloor = 'Warehouse';
  order.forwardedToBranding = true;
  await order.save();

  // Update all articles
  for (const article of order.articles) {
    article.currentFloor = 'Warehouse';
    article.status = 'Completed';
    article.progress = 100;
    article.quantityFromPreviousFloor = article.completedQuantity;
    article.completedQuantity = article.completedQuantity; // Keep same quantity
    article.completedAt = new Date().toISOString();

    await article.save();

    // Create transfer log for each article
    await createArticleLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      action: 'Transferred to Warehouse',
      quantity: article.completedQuantity,
      fromFloor: 'Final Checking',
      toFloor: 'Warehouse',
      remarks: `Order forwarded to warehouse. ${remarks}`,
      previousValue: 'Final Checking',
      newValue: 'Warehouse',
      changeReason: 'Quality confirmed - ready for dispatch',
      userId,
      floorSupervisorId
    });
  }

  // Create order completion log
  await createArticleLog({
    orderId: order._id,
    action: 'Order Completed',
    quantity: 0,
    remarks: `Order ${order.orderNumber} completed and forwarded to warehouse`,
    previousValue: 'Final Checking',
    newValue: 'Warehouse',
    changeReason: 'All articles quality confirmed',
    userId,
    floorSupervisorId
  });

  return {
    order,
    forwardDetails: {
      articlesCount: order.articles.length,
      totalQuantity: order.articles.reduce((sum, article) => sum + article.completedQuantity, 0),
      timestamp: new Date().toISOString()
    }
  };
};

/**
 * Create article log helper function
 * @param {Object} logData
 * @returns {Promise<ArticleLog>}
 */
const createArticleLog = async (logData) => {
  // Use the proper createLogEntry method instead of creating manually
  return ArticleLog.createLogEntry({
    ...logData,
    date: new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString()
  });
};
