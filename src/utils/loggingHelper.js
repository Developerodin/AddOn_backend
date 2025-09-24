import { ArticleLog } from '../models/production/index.js';
import { LogAction } from '../models/production/enums.js';

/**
 * Comprehensive logging helper for production system
 * Ensures all logs are generated correctly with proper correlation
 */

/**
 * Create a production log entry with proper validation and correlation
 * @param {Object} logData - Log data object
 * @returns {Promise<ArticleLog>}
 */
export const createProductionLog = async (logData) => {
  try {
    // Validate required fields
    if (!logData.action) {
      throw new Error('Action is required for log entry');
    }
    if (!logData.orderId) {
      throw new Error('OrderId is required for log entry');
    }
    if (!logData.userId) {
      throw new Error('UserId is required for log entry');
    }
    if (!logData.floorSupervisorId) {
      throw new Error('FloorSupervisorId is required for log entry');
    }

    // Ensure action is valid
    if (!Object.values(LogAction).includes(logData.action)) {
      console.warn(`Invalid log action: ${logData.action}. Using generic action.`);
      logData.action = 'System Action';
    }

    // Create the log entry
    const log = await ArticleLog.createLogEntry({
      action: logData.action,
      quantity: logData.quantity || 0,
      fromFloor: logData.fromFloor || null,
      toFloor: logData.toFloor || null,
      remarks: logData.remarks || '',
      userId: logData.userId,
      floorSupervisorId: logData.floorSupervisorId,
      orderId: logData.orderId,
      articleId: logData.articleId || null,
      previousValue: logData.previousValue || null,
      newValue: logData.newValue || null,
      changeReason: logData.changeReason || '',
      qualityStatus: logData.qualityStatus || null,
      machineId: logData.machineId || null,
      shiftId: logData.shiftId || null,
      batchNumber: logData.batchNumber || null
    });

    console.log(`✅ Log created: ${logData.action} - Order: ${logData.orderId}, Article: ${logData.articleId || 'N/A'}`);
    return log;

  } catch (error) {
    console.error('❌ Error creating production log:', error);
    // Don't throw error for logging failure, just log it
    return null;
  }
};

/**
 * Create a quantity update log
 * @param {Object} params - Log parameters
 * @returns {Promise<ArticleLog>}
 */
export const createQuantityUpdateLog = async (params) => {
  const {
    articleId,
    orderId,
    floor,
    previousQuantity,
    newQuantity,
    userId,
    floorSupervisorId,
    remarks,
    machineId,
    shiftId
  } = params;

  const deltaQuantity = newQuantity - previousQuantity;
  
  return createProductionLog({
    action: LogAction.QUANTITY_UPDATED,
    articleId,
    orderId,
    quantity: deltaQuantity,
    remarks: remarks || `Quantity updated from ${previousQuantity} to ${newQuantity} on ${floor} floor`,
    previousValue: previousQuantity,
    newValue: newQuantity,
    changeReason: 'Production progress update',
    userId,
    floorSupervisorId,
    machineId,
    shiftId
  });
};

/**
 * Create a floor transfer log
 * @param {Object} params - Log parameters
 * @returns {Promise<ArticleLog>}
 */
export const createTransferLog = async (params) => {
  const {
    articleId,
    orderId,
    fromFloor,
    toFloor,
    quantity,
    userId,
    floorSupervisorId,
    remarks,
    batchNumber
  } = params;

  const transferAction = getTransferAction(toFloor);
  
  return createProductionLog({
    action: transferAction,
    articleId,
    orderId,
    quantity,
    fromFloor,
    toFloor,
    remarks: remarks || `Transferred ${quantity} units from ${fromFloor} to ${toFloor}`,
    previousValue: fromFloor,
    newValue: toFloor,
    changeReason: 'Floor transfer',
    userId,
    floorSupervisorId,
    batchNumber
  });
};

/**
 * Create a quality inspection log
 * @param {Object} params - Log parameters
 * @returns {Promise<ArticleLog>}
 */
export const createQualityInspectionLog = async (params) => {
  const {
    articleId,
    orderId,
    floor,
    inspectedQuantity,
    m1Quantity,
    m2Quantity,
    m3Quantity,
    m4Quantity,
    userId,
    floorSupervisorId,
    remarks,
    machineId,
    shiftId
  } = params;

  return createProductionLog({
    action: LogAction.QUALITY_INSPECTION,
    articleId,
    orderId,
    quantity: inspectedQuantity,
    remarks: remarks || `Quality inspection completed: M1=${m1Quantity}, M2=${m2Quantity}, M3=${m3Quantity}, M4=${m4Quantity}`,
    previousValue: `Inspected: ${inspectedQuantity}`,
    newValue: `M1:${m1Quantity}, M2:${m2Quantity}, M3:${m3Quantity}, M4:${m4Quantity}`,
    changeReason: 'Quality inspection',
    userId,
    floorSupervisorId,
    machineId,
    shiftId,
    qualityStatus: 'Quality Inspection'
  });
};

/**
 * Create a quality category update log
 * @param {Object} params - Log parameters
 * @returns {Promise<ArticleLog>}
 */
export const createQualityCategoryLog = async (params) => {
  const {
    articleId,
    orderId,
    floor,
    category,
    previousQuantity,
    newQuantity,
    userId,
    floorSupervisorId,
    remarks
  } = params;

  const action = getQualityCategoryAction(category);
  const deltaQuantity = newQuantity - previousQuantity;
  
  return createProductionLog({
    action,
    articleId,
    orderId,
    quantity: deltaQuantity,
    remarks: remarks || `${category} quantity updated from ${previousQuantity} to ${newQuantity} on ${floor} floor`,
    previousValue: previousQuantity,
    newValue: newQuantity,
    changeReason: 'Quality inspection',
    userId,
    floorSupervisorId,
    qualityStatus: `${category} - ${getQualityCategoryDescription(category)}`
  });
};

/**
 * Create a progress update log
 * @param {Object} params - Log parameters
 * @returns {Promise<ArticleLog>}
 */
export const createProgressUpdateLog = async (params) => {
  const {
    articleId,
    orderId,
    previousProgress,
    newProgress,
    userId,
    floorSupervisorId,
    remarks
  } = params;

  return createProductionLog({
    action: LogAction.PROGRESS_UPDATED,
    articleId,
    orderId,
    quantity: 0,
    remarks: remarks || `Progress updated from ${previousProgress}% to ${newProgress}%`,
    previousValue: previousProgress,
    newValue: newProgress,
    changeReason: 'Progress calculation',
    userId,
    floorSupervisorId
  });
};

/**
 * Create a remarks update log
 * @param {Object} params - Log parameters
 * @returns {Promise<ArticleLog>}
 */
export const createRemarksUpdateLog = async (params) => {
  const {
    articleId,
    orderId,
    previousRemarks,
    newRemarks,
    userId,
    floorSupervisorId
  } = params;

  return createProductionLog({
    action: LogAction.REMARKS_UPDATED,
    articleId,
    orderId,
    quantity: 0,
    remarks: newRemarks,
    previousValue: previousRemarks,
    newValue: newRemarks,
    changeReason: 'Remarks update',
    userId,
    floorSupervisorId
  });
};

/**
 * Create a final quality confirmation log
 * @param {Object} params - Log parameters
 * @returns {Promise<ArticleLog>}
 */
export const createFinalQualityLog = async (params) => {
  const {
    articleId,
    orderId,
    confirmed,
    userId,
    floorSupervisorId,
    remarks
  } = params;

  const action = confirmed ? LogAction.FINAL_QUALITY_CONFIRMED : LogAction.FINAL_QUALITY_REJECTED;
  
  return createProductionLog({
    action,
    articleId,
    orderId,
    quantity: 0,
    remarks: remarks || `Final quality ${confirmed ? 'confirmed' : 'rejected'}`,
    previousValue: false,
    newValue: confirmed,
    changeReason: 'Final quality inspection',
    userId,
    floorSupervisorId,
    qualityStatus: confirmed ? 'Approved for Warehouse' : 'Rejected'
  });
};

/**
 * Get the proper transfer action for a floor
 * @param {string} floor - Floor name
 * @returns {string} Transfer action
 */
const getTransferAction = (floor) => {
  const transferActions = {
    'Knitting': LogAction.TRANSFERRED_TO_KNITTING,
    'Linking': LogAction.TRANSFERRED_TO_LINKING,
    'Checking': LogAction.TRANSFERRED_TO_CHECKING,
    'Washing': LogAction.TRANSFERRED_TO_WASHING,
    'Boarding': LogAction.TRANSFERRED_TO_BOARDING,
    'Branding': LogAction.TRANSFERRED_TO_BRANDING,
    'Final Checking': LogAction.TRANSFERRED_TO_FINAL_CHECKING,
    'Warehouse': LogAction.TRANSFERRED_TO_WAREHOUSE
  };
  
  return transferActions[floor] || 'Transferred to Next Floor';
};

/**
 * Get the proper quality category action
 * @param {string} category - Quality category (M1, M2, M3, M4)
 * @returns {string} Quality action
 */
const getQualityCategoryAction = (category) => {
  const qualityActions = {
    'M1': LogAction.M1_QUANTITY_UPDATED,
    'M2': LogAction.M2_QUANTITY_UPDATED,
    'M3': LogAction.M3_QUANTITY_UPDATED,
    'M4': LogAction.M4_QUANTITY_UPDATED
  };
  
  return qualityActions[category] || LogAction.QUALITY_INSPECTION;
};

/**
 * Get quality category description
 * @param {string} category - Quality category
 * @returns {string} Description
 */
const getQualityCategoryDescription = (category) => {
  const descriptions = {
    'M1': 'Good Quality',
    'M2': 'Needs Repair',
    'M3': 'Minor Defects',
    'M4': 'Major Defects'
  };
  
  return descriptions[category] || 'Unknown Quality';
};

/**
 * Create a bulk log entry for multiple operations
 * @param {Array} logEntries - Array of log data objects
 * @returns {Promise<Array>} Array of created logs
 */
export const createBulkLogs = async (logEntries) => {
  const results = [];
  
  for (const logData of logEntries) {
    try {
      const log = await createProductionLog(logData);
      results.push(log);
    } catch (error) {
      console.error('Error creating bulk log entry:', error);
      results.push(null);
    }
  }
  
  return results;
};

/**
 * Get log statistics for debugging
 * @param {Object} filter - Filter options
 * @returns {Promise<Object>} Log statistics
 */
export const getLogStatistics = async (filter = {}) => {
  try {
    const matchFilter = {};
    
    if (filter.dateFrom) {
      matchFilter.timestamp = { ...matchFilter.timestamp, $gte: new Date(filter.dateFrom) };
    }
    if (filter.dateTo) {
      matchFilter.timestamp = { ...matchFilter.timestamp, $lte: new Date(filter.dateTo) };
    }
    if (filter.action) {
      matchFilter.action = filter.action;
    }
    if (filter.orderId) {
      matchFilter.orderId = filter.orderId;
    }
    if (filter.articleId) {
      matchFilter.articleId = filter.articleId;
    }

    const stats = await ArticleLog.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$action',
          count: { $sum: 1 },
          totalQuantity: { $sum: '$quantity' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    return {
      success: true,
      statistics: stats,
      totalLogs: stats.reduce((sum, stat) => sum + stat.count, 0),
      totalQuantity: stats.reduce((sum, stat) => sum + stat.totalQuantity, 0)
    };
  } catch (error) {
    console.error('Error getting log statistics:', error);
    return {
      success: false,
      error: error.message,
      statistics: [],
      totalLogs: 0,
      totalQuantity: 0
    };
  }
};
