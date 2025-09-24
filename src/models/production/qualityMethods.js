import ArticleLog from './articleLog.model.js';
import { RepairStatus, ProductionFloor } from './enums.js';

/**
 * Quality-related methods for Article model
 * Extracted to keep article.model.js under 500 lines
 */

/**
 * Update quality categories for checking floors
 */
export const updateQualityCategories = async function(qualityData, userId, floorSupervisorId) {
  if (this.currentFloor !== ProductionFloor.CHECKING && this.currentFloor !== ProductionFloor.FINAL_CHECKING) {
    throw new Error('Quality categories can only be updated in Checking or Final Checking floor');
  }
  
  const { m1Quantity, m2Quantity, m3Quantity, m4Quantity, repairStatus, repairRemarks } = qualityData;
  
  const currentFloorKey = this.getFloorKey(this.currentFloor);
  const currentFloorData = this.floorQuantities[currentFloorKey];
  const currentFloorCompleted = currentFloorData?.completed || 0;
  
  if (m1Quantity + m2Quantity + m3Quantity + m4Quantity > currentFloorCompleted) {
    throw new Error('Quality quantities cannot exceed completed quantity on current floor');
  }
  
  const previousValues = {
    m1Quantity: currentFloorData?.m1Quantity || 0,
    m2Quantity: currentFloorData?.m2Quantity || 0,
    m3Quantity: currentFloorData?.m3Quantity || 0,
    m4Quantity: currentFloorData?.m4Quantity || 0,
    repairStatus: currentFloorData?.repairStatus || RepairStatus.NOT_REQUIRED
  };
  
  // Create logs for each quality category update
  try {
    if (m1Quantity !== undefined && m1Quantity !== previousValues.m1Quantity) {
      await ArticleLog.createLogEntry({
        articleId: this._id.toString(),
        orderId: this.orderId.toString(),
        action: 'M1 Quantity Updated',
        quantity: m1Quantity - previousValues.m1Quantity,
        remarks: `M1 quantity updated to ${m1Quantity} (Good Quality) on ${this.currentFloor} floor`,
        previousValue: previousValues.m1Quantity,
        newValue: m1Quantity,
        changeReason: 'Quality inspection',
        userId: userId || 'system',
        floorSupervisorId: floorSupervisorId || 'system',
        qualityStatus: 'M1 - Good Quality'
      });
    }
    
    if (m2Quantity !== undefined && m2Quantity !== previousValues.m2Quantity) {
      await ArticleLog.createLogEntry({
        articleId: this._id.toString(),
        orderId: this.orderId.toString(),
        action: 'M2 Quantity Updated',
        quantity: m2Quantity - previousValues.m2Quantity,
        remarks: `M2 quantity updated to ${m2Quantity} (Needs Repair) on ${this.currentFloor} floor`,
        previousValue: previousValues.m2Quantity,
        newValue: m2Quantity,
        changeReason: 'Quality inspection',
        userId: userId || 'system',
        floorSupervisorId: floorSupervisorId || 'system',
        qualityStatus: 'M2 - Needs Repair'
      });
    }
    
    if (m3Quantity !== undefined && m3Quantity !== previousValues.m3Quantity) {
      await ArticleLog.createLogEntry({
        articleId: this._id.toString(),
        orderId: this.orderId.toString(),
        action: 'M3 Quantity Updated',
        quantity: m3Quantity - previousValues.m3Quantity,
        remarks: `M3 quantity updated to ${m3Quantity} (Minor Defects) on ${this.currentFloor} floor`,
        previousValue: previousValues.m3Quantity,
        newValue: m3Quantity,
        changeReason: 'Quality inspection',
        userId: userId || 'system',
        floorSupervisorId: floorSupervisorId || 'system',
        qualityStatus: 'M3 - Minor Defects'
      });
    }
    
    if (m4Quantity !== undefined && m4Quantity !== previousValues.m4Quantity) {
      await ArticleLog.createLogEntry({
        articleId: this._id.toString(),
        orderId: this.orderId.toString(),
        action: 'M4 Quantity Updated',
        quantity: m4Quantity - previousValues.m4Quantity,
        remarks: `M4 quantity updated to ${m4Quantity} (Major Defects) on ${this.currentFloor} floor`,
        previousValue: previousValues.m4Quantity,
        newValue: m4Quantity,
        changeReason: 'Quality inspection',
        userId: userId || 'system',
        floorSupervisorId: floorSupervisorId || 'system',
        qualityStatus: 'M4 - Major Defects'
      });
    }
  } catch (logError) {
    console.error('Error creating quality update logs:', logError);
    // Don't throw error for logging failure, just log it
  }
  
  // Update floor-specific quality data
  currentFloorData.m1Quantity = m1Quantity || 0;
  currentFloorData.m2Quantity = m2Quantity || 0;
  currentFloorData.m3Quantity = m3Quantity || 0;
  currentFloorData.m4Quantity = m4Quantity || 0;
  
  if (repairStatus) {
    currentFloorData.repairStatus = repairStatus;
  }
  if (repairRemarks) {
    currentFloorData.repairRemarks = repairRemarks;
  }
  
  return previousValues;
};

/**
 * Shift M2 items to other categories
 */
export const shiftM2Items = async function(shiftData, userId, floorSupervisorId) {
  if (this.currentFloor !== ProductionFloor.CHECKING && this.currentFloor !== ProductionFloor.FINAL_CHECKING) {
    throw new Error('M2 shifting can only be done in Checking or Final Checking floor');
  }
  
  const { fromM2, toM1, toM3, toM4 } = shiftData;
  const currentFloorKey = this.getFloorKey(this.currentFloor);
  const currentFloorData = this.floorQuantities[currentFloorKey];
  
  if (fromM2 > currentFloorData.m2Quantity) {
    throw new Error('Cannot shift more M2 items than available');
  }
  
  const totalShifted = (toM1 || 0) + (toM3 || 0) + (toM4 || 0);
  if (totalShifted !== fromM2) {
    throw new Error('Total shifted quantity must equal fromM2 quantity');
  }
  
  const previousValues = {
    m1Quantity: currentFloorData.m1Quantity,
    m2Quantity: currentFloorData.m2Quantity,
    m3Quantity: currentFloorData.m3Quantity,
    m4Quantity: currentFloorData.m4Quantity
  };
  
  // Create logs for M2 shifts
  try {
    // Create individual logs for each shift
    if (toM1 > 0) {
      await ArticleLog.createLogEntry({
        articleId: this._id.toString(),
        orderId: this.orderId.toString(),
        action: 'M2 Item Shifted to M1',
        quantity: toM1,
        remarks: `${toM1} M2 items shifted to M1`,
        previousValue: this.m2Quantity,
        newValue: this.m2Quantity - toM1,
        changeReason: 'M2 repair process - items successfully repaired',
        userId: userId || 'system',
        floorSupervisorId: floorSupervisorId || 'system',
        qualityStatus: 'M1 - Good Quality'
      });
    }
    
    if (toM3 > 0) {
      await ArticleLog.createLogEntry({
        articleId: this._id.toString(),
        orderId: this.orderId.toString(),
        action: 'M2 Item Shifted to M3',
        quantity: toM3,
        remarks: `${toM3} M2 items shifted to M3`,
        previousValue: this.m2Quantity,
        newValue: this.m2Quantity - toM3,
        changeReason: 'M2 repair process - items have minor defects',
        userId: userId || 'system',
        floorSupervisorId: floorSupervisorId || 'system',
        qualityStatus: 'M3 - Minor Defects'
      });
    }
    
    if (toM4 > 0) {
      await ArticleLog.createLogEntry({
        articleId: this._id.toString(),
        orderId: this.orderId.toString(),
        action: 'M2 Item Shifted to M4',
        quantity: toM4,
        remarks: `${toM4} M2 items shifted to M4`,
        previousValue: this.m2Quantity,
        newValue: this.m2Quantity - toM4,
        changeReason: 'M2 repair process - items have major defects',
        userId: userId || 'system',
        floorSupervisorId: floorSupervisorId || 'system',
        qualityStatus: 'M4 - Major Defects'
      });
    }
  } catch (logError) {
    console.error('Error creating M2 shift logs:', logError);
    // Don't throw error for logging failure, just log it
  }
  
  currentFloorData.m2Quantity -= fromM2;
  currentFloorData.m1Quantity += toM1 || 0;
  currentFloorData.m3Quantity += toM3 || 0;
  currentFloorData.m4Quantity += toM4 || 0;
  
  return {
    previousValues,
    shiftData
  };
};

/**
 * Confirm final quality
 */
export const confirmFinalQuality = async function(confirmed, userId, floorSupervisorId, remarks) {
  if (this.currentFloor !== ProductionFloor.CHECKING && this.currentFloor !== ProductionFloor.FINAL_CHECKING) {
    throw new Error('Final quality confirmation can only be done in Checking or Final Checking floor');
  }
  
  const currentFloorKey = this.getFloorKey(this.currentFloor);
  const currentFloorCompleted = this.floorQuantities[currentFloorKey]?.completed || 0;
  if (confirmed && this.qualityTotal !== currentFloorCompleted) {
    throw new Error('All completed quantity must be categorized before final confirmation');
  }
  
  const previousValue = this.finalQualityConfirmed;
  this.finalQualityConfirmed = confirmed;
  
  // Create log entry for final quality confirmation
  try {
    await ArticleLog.createLogEntry({
      articleId: this._id.toString(),
      orderId: this.orderId.toString(),
      action: confirmed ? 'Final Quality Confirmed' : 'Final Quality Rejected',
      quantity: this.floorQuantities[this.getFloorKey(this.currentFloor)]?.completed || 0,
      remarks: remarks || `Final quality ${confirmed ? 'confirmed' : 'rejected'} for article ${this.articleNumber}`,
      previousValue: previousValue,
      newValue: confirmed,
      changeReason: 'Final quality inspection',
      userId: userId || 'system',
      floorSupervisorId: floorSupervisorId || 'system',
      qualityStatus: confirmed ? 'Approved for Warehouse' : 'Rejected'
    });
  } catch (logError) {
    console.error('Error creating final quality confirmation log:', logError);
    // Don't throw error for logging failure, just log it
  }
  
  return {
    previousValue,
    newValue: confirmed
  };
};

/**
 * Update M4 quantity for knitting floor
 */
export const updateKnittingM4Quantity = async function(m4Quantity, userId, floorSupervisorId, remarks, machineId, shiftId) {
  if (this.currentFloor !== ProductionFloor.KNITTING) {
    throw new Error('M4 quantity can only be updated on knitting floor');
  }
  
  const floorKey = this.getFloorKey(this.currentFloor);
  const floorData = this.floorQuantities[floorKey];
  
  if (!floorData) {
    throw new Error('Invalid floor for M4 quantity update');
  }
  
  if (m4Quantity < 0 || m4Quantity > floorData.completed) {
    throw new Error(`M4 quantity must be between 0 and completed quantity (${floorData.completed})`);
  }
  
  const previousM4Quantity = floorData.m4Quantity || 0;
  floorData.m4Quantity = m4Quantity;
  
  if (remarks) {
    this.remarks = remarks;
  }
  
  // Create log entry for M4 quantity update
  try {
    await ArticleLog.createLogEntry({
      articleId: this._id.toString(),
      orderId: this.orderId.toString(),
      action: 'M4 Quantity Updated (Knitting)',
      quantity: m4Quantity - previousM4Quantity,
      remarks: remarks || `M4 (defect) quantity updated to ${m4Quantity} on knitting floor`,
      previousValue: previousM4Quantity,
      newValue: m4Quantity,
      changeReason: 'Defect quantity tracking',
      userId: userId || 'system',
      floorSupervisorId: floorSupervisorId || 'system',
      machineId,
      shiftId,
      qualityStatus: 'M4 - Major Defects'
    });
  } catch (logError) {
    console.error('Error creating M4 quantity update log:', logError);
    // Don't throw error for logging failure, just log it
  }
  
  return {
    floor: this.currentFloor,
    previousM4Quantity,
    newM4Quantity: m4Quantity,
    deltaM4Quantity: m4Quantity - previousM4Quantity,
    completedQuantity: floorData.completed,
    goodQuantity: floorData.completed - m4Quantity
  };
};

/**
 * Update completed quantity with quality tracking for checking floors
 */
export const updateCompletedQuantityWithQuality = async function(updateData, userId, floorSupervisorId, remarks, machineId, shiftId) {
  const { completedQuantity, m1Quantity, m2Quantity, m3Quantity, m4Quantity, repairStatus, repairRemarks } = updateData;
  
  if (this.currentFloor !== ProductionFloor.CHECKING && this.currentFloor !== ProductionFloor.FINAL_CHECKING) {
    throw new Error('Quality tracking can only be updated in Checking or Final Checking floor');
  }
  
  const currentFloorKey = this.getFloorKey(this.currentFloor);
  const floorData = this.floorQuantities[currentFloorKey];
  
  if (!floorData) {
    throw new Error('Invalid floor for quantity update');
  }
  
  if (completedQuantity < 0 || completedQuantity > floorData.received) {
    throw new Error(`Invalid quantity: must be between 0 and received quantity (${floorData.received})`);
  }
  
  // Validate quality quantities
  const qualityTotal = (m1Quantity || 0) + (m2Quantity || 0) + (m3Quantity || 0) + (m4Quantity || 0);
  if (qualityTotal > completedQuantity) {
    throw new Error('Quality quantities cannot exceed completed quantity');
  }
  
  const previousQuantity = floorData.completed;
  const previousQuality = {
    m1Quantity: floorData.m1Quantity || 0,
    m2Quantity: floorData.m2Quantity || 0,
    m3Quantity: floorData.m3Quantity || 0,
    m4Quantity: floorData.m4Quantity || 0,
    repairStatus: floorData.repairStatus || RepairStatus.NOT_REQUIRED
  };
  
  // Update completed quantity
  floorData.completed = completedQuantity;
  floorData.remaining = floorData.received - completedQuantity;
  
  // Update quality quantities
  floorData.m1Quantity = m1Quantity || 0;
  floorData.m2Quantity = m2Quantity || 0;
  floorData.m3Quantity = m3Quantity || 0;
  floorData.m4Quantity = m4Quantity || 0;
  
  if (repairStatus) {
    floorData.repairStatus = repairStatus;
  }
  if (repairRemarks) {
    floorData.repairRemarks = repairRemarks;
  }
  
  // Update progress based on floor quantities
  this.progress = this.calculatedProgress;
  
  if (remarks) {
    this.remarks = remarks;
  }
  
  // Create log entries for quantity and quality updates
  try {
    // Log quantity update
    await ArticleLog.createLogEntry({
      articleId: this._id.toString(),
      orderId: this.orderId.toString(),
      action: 'Quantity Updated',
      quantity: completedQuantity - previousQuantity,
      remarks: remarks || `Completed ${completedQuantity} units on ${this.currentFloor} floor (${floorData.remaining} remaining)`,
      previousValue: previousQuantity,
      newValue: completedQuantity,
      changeReason: 'Production progress update',
      userId: userId || 'system',
      floorSupervisorId: floorSupervisorId || 'system',
      machineId,
      shiftId
    });
    
    // Log quality updates if they changed
    if (m1Quantity !== undefined && m1Quantity !== previousQuality.m1Quantity) {
      await ArticleLog.createLogEntry({
        articleId: this._id.toString(),
        orderId: this.orderId.toString(),
        action: 'M1 Quantity Updated',
        quantity: m1Quantity - previousQuality.m1Quantity,
        remarks: `M1 quantity updated to ${m1Quantity} (Good Quality) on ${this.currentFloor} floor`,
        previousValue: previousQuality.m1Quantity,
        newValue: m1Quantity,
        changeReason: 'Quality inspection',
        userId: userId || 'system',
        floorSupervisorId: floorSupervisorId || 'system',
        qualityStatus: 'M1 - Good Quality'
      });
    }
    
    if (m2Quantity !== undefined && m2Quantity !== previousQuality.m2Quantity) {
      await ArticleLog.createLogEntry({
        articleId: this._id.toString(),
        orderId: this.orderId.toString(),
        action: 'M2 Quantity Updated',
        quantity: m2Quantity - previousQuality.m2Quantity,
        remarks: `M2 quantity updated to ${m2Quantity} (Needs Repair) on ${this.currentFloor} floor`,
        previousValue: previousQuality.m2Quantity,
        newValue: m2Quantity,
        changeReason: 'Quality inspection',
        userId: userId || 'system',
        floorSupervisorId: floorSupervisorId || 'system',
        qualityStatus: 'M2 - Needs Repair'
      });
    }
    
    if (m3Quantity !== undefined && m3Quantity !== previousQuality.m3Quantity) {
      await ArticleLog.createLogEntry({
        articleId: this._id.toString(),
        orderId: this.orderId.toString(),
        action: 'M3 Quantity Updated',
        quantity: m3Quantity - previousQuality.m3Quantity,
        remarks: `M3 quantity updated to ${m3Quantity} (Minor Defects) on ${this.currentFloor} floor`,
        previousValue: previousQuality.m3Quantity,
        newValue: m3Quantity,
        changeReason: 'Quality inspection',
        userId: userId || 'system',
        floorSupervisorId: floorSupervisorId || 'system',
        qualityStatus: 'M3 - Minor Defects'
      });
    }
    
    if (m4Quantity !== undefined && m4Quantity !== previousQuality.m4Quantity) {
      await ArticleLog.createLogEntry({
        articleId: this._id.toString(),
        orderId: this.orderId.toString(),
        action: 'M4 Quantity Updated',
        quantity: m4Quantity - previousQuality.m4Quantity,
        remarks: `M4 quantity updated to ${m4Quantity} (Major Defects) on ${this.currentFloor} floor`,
        previousValue: previousQuality.m4Quantity,
        newValue: m4Quantity,
        changeReason: 'Quality inspection',
        userId: userId || 'system',
        floorSupervisorId: floorSupervisorId || 'system',
        qualityStatus: 'M4 - Major Defects'
      });
    }
  } catch (logError) {
    console.error('Error creating update logs:', logError);
    // Don't throw error for logging failure, just log it
  }
  
  return {
    floor: this.currentFloor,
    previousQuantity,
    newQuantity: completedQuantity,
    deltaQuantity: completedQuantity - previousQuantity,
    remaining: floorData.remaining,
    qualityData: {
      m1Quantity: floorData.m1Quantity,
      m2Quantity: floorData.m2Quantity,
      m3Quantity: floorData.m3Quantity,
      m4Quantity: floorData.m4Quantity,
      repairStatus: floorData.repairStatus,
      repairRemarks: floorData.repairRemarks
    }
  };
};

/**
 * Update quality inspection (bulk quality update)
 */
export const updateQualityInspection = async function(qualityData, userId, floorSupervisorId, remarks, machineId, shiftId) {
  if (this.currentFloor !== ProductionFloor.CHECKING && this.currentFloor !== ProductionFloor.FINAL_CHECKING) {
    throw new Error('Quality inspection can only be updated in Checking or Final Checking floor');
  }
  
  const { inspectedQuantity, m1Quantity, m2Quantity, m3Quantity, m4Quantity } = qualityData;
  
  const currentFloorKey = this.getFloorKey(this.currentFloor);
  const currentFloorData = this.floorQuantities[currentFloorKey];
  
  // Validate inspected quantity against received quantity
  if (inspectedQuantity > currentFloorData.received) {
    throw new Error(`Inspected quantity (${inspectedQuantity}) cannot exceed received quantity (${currentFloorData.received})`);
  }
  
  // Validate quality quantities sum
  const qualityTotal = (m1Quantity || 0) + (m2Quantity || 0) + (m3Quantity || 0) + (m4Quantity || 0);
  if (qualityTotal !== inspectedQuantity) {
    throw new Error(`Quality quantities (${qualityTotal}) must equal inspected quantity (${inspectedQuantity})`);
  }
  
  const previousValues = {
    m1Quantity: currentFloorData?.m1Quantity || 0,
    m2Quantity: currentFloorData?.m2Quantity || 0,
    m3Quantity: currentFloorData?.m3Quantity || 0,
    m4Quantity: currentFloorData?.m4Quantity || 0
  };
  
  // Update quality quantities
  currentFloorData.m1Quantity = m1Quantity || 0;
  currentFloorData.m2Quantity = m2Quantity || 0;
  currentFloorData.m3Quantity = m3Quantity || 0;
  currentFloorData.m4Quantity = m4Quantity || 0;
  
  if (remarks) {
    this.remarks = remarks;
  }
  
  // Create log entry for quality inspection
  try {
    await ArticleLog.createLogEntry({
      articleId: this._id.toString(),
      orderId: this.orderId.toString(),
      action: 'Quality Inspection Completed',
      quantity: inspectedQuantity,
      remarks: remarks || `Quality inspection completed: M1=${m1Quantity}, M2=${m2Quantity}, M3=${m3Quantity}, M4=${m4Quantity}`,
      previousValue: JSON.stringify(previousValues),
      newValue: JSON.stringify({ m1Quantity, m2Quantity, m3Quantity, m4Quantity }),
      changeReason: 'Quality inspection',
      userId: userId || 'system',
      floorSupervisorId: floorSupervisorId || 'system',
      machineId,
      shiftId,
      qualityStatus: 'Quality Inspection'
    });
  } catch (logError) {
    console.error('Error creating quality inspection log:', logError);
    // Don't throw error for logging failure, just log it
  }
  
  return {
    floor: this.currentFloor,
    inspectedQuantity,
    qualityData: {
      m1Quantity,
      m2Quantity,
      m3Quantity,
      m4Quantity
    },
    previousValues
  };
};
