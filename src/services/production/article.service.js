import httpStatus from 'http-status';
import { Article, ArticleLog, ProductionOrder } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';
import { getFloorOrderByLinkingType, getFloorKey, compareFloors } from '../../utils/productionHelper.js';
import { 
  createQuantityUpdateLog, 
  createTransferLog, 
  createProgressUpdateLog, 
  createRemarksUpdateLog,
  createQualityInspectionLog,
  createQualityCategoryLog,
  createFinalQualityLog
} from '../../utils/loggingHelper.js';

/**
 * Update article progress on a specific floor
 * @param {string} floor
 * @param {ObjectId} orderId
 * @param {ObjectId} articleId
 * @param {Object} updateData
 * @param {Object} user - Current user from request
 * @returns {Promise<Article>}
 */
export const updateArticleProgress = async (floor, orderId, articleId, updateData, user = null) => {
  const article = await Article.findOne({ _id: articleId, orderId })
    .populate('machineId', 'machineCode machineNumber model floor status capacityPerShift capacityPerDay assignedSupervisor');
  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found in this order');
  }

  // Map URL-friendly floor names to proper enum values
  const floorMapping = {
    'FinalChecking': 'Final Checking',
    'finalchecking': 'Final Checking',
    'final-checking': 'Final Checking',
    'final_checking': 'Final Checking'
  };

  // Convert floor name if needed
  const normalizedFloor = floorMapping[floor] || floor;

  // Validate floor-specific operations - allow updates on current floor or previous floors
  // Use linking-type-aware floor order for validation
  const floorOrder = getFloorOrderByLinkingType(article.linkingType);
  
  const currentFloorIndex = floorOrder.indexOf(article.currentFloor);
  const requestedFloorIndex = floorOrder.indexOf(normalizedFloor);
  
  if (requestedFloorIndex === -1) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Invalid floor: ${floor} for linking type: ${article.linkingType}`);
  }
  
  // Allow updates to any floor that has work to do in continuous flow
  // Only prevent updates to floors that are too far ahead of the current floor
  // This allows previous floors to continue working even after article has moved forward
  const floorKey = article.getFloorKey(normalizedFloor);
  const floorData = article.floorQuantities[floorKey];
  const hasWorkOnFloor = floorData && (floorData.received > 0 || floorData.completed > 0 || floorData.remaining > 0);
  
  if (requestedFloorIndex > currentFloorIndex && !hasWorkOnFloor) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Cannot update work on ${normalizedFloor} floor - article is currently on ${article.currentFloor} floor and no work exists on ${normalizedFloor} floor.`);
  }

  const previousProgress = article.progress;
  const previousQuantity = floorData?.completed || 0;

  // Update article data
  if (updateData.machineId !== undefined) {
    article.machineId = updateData.machineId;
  }
  
  if (updateData.completedQuantity !== undefined) {
    // Use the floor key already declared above
    const floorData = article.floorQuantities[floorKey];
    
    if (!floorData) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid floor for quantity update');
    }
    
    // Handle both incremental and total quantity inputs
    let newCompletedQuantity;
    const currentCompleted = floorData.completed;
    
    // If the input is less than current completed, treat it as incremental
    if (updateData.completedQuantity < currentCompleted) {
      // This is an incremental update
      newCompletedQuantity = currentCompleted + updateData.completedQuantity;
      
      // Validate that the incremental amount is positive
      if (updateData.completedQuantity <= 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, `Incremental quantity must be positive. You provided: ${updateData.completedQuantity}`);
      }
    } else {
      // This is a total quantity update
      newCompletedQuantity = updateData.completedQuantity;
    }
    
    // Validate final quantity against floor received quantity
    // Special case: Knitting floor can generate excess quantity that gets passed to next floor
    if (newCompletedQuantity < 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Invalid completed quantity: must be positive. Calculated total: ${newCompletedQuantity}`);
    }
    
    // For knitting floor, allow excess quantity (machines can generate more than received)
    // For other floors, completed quantity cannot exceed received quantity
    if (normalizedFloor !== 'Knitting' && newCompletedQuantity > floorData.received) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Invalid completed quantity: must be between 0 and received quantity (${floorData.received}). Calculated total: ${newCompletedQuantity}`);
    }
    
    // Update floor-specific quantities
    const previousFloorCompleted = floorData.completed;
    floorData.completed = newCompletedQuantity;
    
    // For knitting floor, remaining can be negative (excess generation)
    // For other floors, remaining is received - completed
    if (normalizedFloor === 'Knitting') {
      floorData.remaining = Math.max(0, floorData.received - newCompletedQuantity);
    } else {
      floorData.remaining = floorData.received - newCompletedQuantity;
    }
    
    // Update progress based on floor quantities
    article.progress = article.calculatedProgress;
  }

  // Update floor-specific fields for quality inspection floors
  if (normalizedFloor === 'Checking' || normalizedFloor === 'Final Checking') {
    // Update article-level quality fields (additive)
    if (updateData.m1Quantity !== undefined) article.m1Quantity = (article.m1Quantity || 0) + updateData.m1Quantity;
    if (updateData.m2Quantity !== undefined) article.m2Quantity = (article.m2Quantity || 0) + updateData.m2Quantity;
    if (updateData.m3Quantity !== undefined) article.m3Quantity = (article.m3Quantity || 0) + updateData.m3Quantity;
    if (updateData.m4Quantity !== undefined) article.m4Quantity = (article.m4Quantity || 0) + updateData.m4Quantity;
    if (updateData.repairStatus !== undefined) article.repairStatus = updateData.repairStatus;
    if (updateData.repairRemarks !== undefined) article.repairRemarks = updateData.repairRemarks;
    
    // Update floor-level quality fields (additive)
    const floorData = article.floorQuantities[floorKey];
    if (floorData) {
      if (updateData.m1Quantity !== undefined) floorData.m1Quantity = (floorData.m1Quantity || 0) + updateData.m1Quantity;
      if (updateData.m2Quantity !== undefined) floorData.m2Quantity = (floorData.m2Quantity || 0) + updateData.m2Quantity;
      if (updateData.m3Quantity !== undefined) floorData.m3Quantity = (floorData.m3Quantity || 0) + updateData.m3Quantity;
      if (updateData.m4Quantity !== undefined) floorData.m4Quantity = (floorData.m4Quantity || 0) + updateData.m4Quantity;
      if (updateData.repairStatus !== undefined) floorData.repairStatus = updateData.repairStatus;
      if (updateData.repairRemarks !== undefined) floorData.repairRemarks = updateData.repairRemarks;
    }
  }
  
  // Update knitting floor m4Quantity (defect quantity)
  if (normalizedFloor === 'Knitting' && updateData.m4Quantity !== undefined) {
    const knittingFloorData = article.floorQuantities.knitting;
    if (knittingFloorData) {
      knittingFloorData.m4Quantity = updateData.m4Quantity;
    }
  }

  if (updateData.remarks) {
    article.remarks = updateData.remarks;
  }

  // Update timestamps
  if (article.status === 'Pending' && updateData.completedQuantity > 0) {
    article.status = 'In Progress';
    article.startedAt = new Date().toISOString();
  }

  // Check if article is completed based on floor quantities
  const currentFloorKey = article.getFloorKey(article.currentFloor);
  const currentFloorData = article.floorQuantities[currentFloorKey];
  
  // For Checking and Final Checking floors, completion is based on M1 quantity
  let isFloorComplete = false;
  if (article.currentFloor === 'Checking' || article.currentFloor === 'Final Checking') {
    // Floor is complete when all M1 quantity has been transferred
    const totalM1Quantity = currentFloorData.m1Quantity || 0;
    const transferredM1Quantity = currentFloorData.m1Transferred || 0;
    isFloorComplete = totalM1Quantity > 0 && transferredM1Quantity >= totalM1Quantity;
  } else {
    // For other floors, completion is based on completed quantity
    // For knitting floor, allow overproduction - floor is complete when all received work is done
    // For other floors, completed must equal received
    if (article.currentFloor === 'Knitting') {
      isFloorComplete = currentFloorData && currentFloorData.completed >= currentFloorData.received && currentFloorData.remaining === 0;
    } else {
      isFloorComplete = currentFloorData && currentFloorData.completed === currentFloorData.received && currentFloorData.remaining === 0;
    }
  }
  
  if (isFloorComplete) {
    article.status = 'Completed';
    article.completedAt = new Date().toISOString();
    
    // Auto-transfer completed work to next floor
    await autoTransferCompletedWorkToNextFloor(article, updateData, user);
  }

  await article.save();

  // Create logs
  if (updateData.completedQuantity !== undefined) {
    const actualNewQuantity = floorData.completed; // This is the final calculated quantity
    const isIncremental = updateData.completedQuantity < previousQuantity;
    
    if (actualNewQuantity !== previousQuantity) {
      await createQuantityUpdateLog({
        articleId: article._id.toString(),
        orderId: article.orderId.toString(),
        floor: normalizedFloor,
        previousQuantity,
        newQuantity: actualNewQuantity,
        userId: user?.id || updateData.userId || 'system',
        floorSupervisorId: user?.id || updateData.floorSupervisorId || 'system',
        remarks: isIncremental 
          ? `Added ${updateData.completedQuantity} units to ${normalizedFloor} floor (${previousQuantity} + ${updateData.completedQuantity} = ${actualNewQuantity})`
          : `Quantity updated from ${previousQuantity} to ${updateData.completedQuantity} on ${normalizedFloor} floor`,
        machineId: updateData.machineId,
        shiftId: updateData.shiftId
      });
    }
  }

  if (article.progress !== previousProgress) {
    await createProgressUpdateLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      previousProgress,
      newProgress: article.progress,
      userId: user?.id || updateData.userId || 'system',
      floorSupervisorId: user?.id || updateData.floorSupervisorId || 'system',
      remarks: `Progress updated to ${article.progress}%`
    });
  }

  if (updateData.remarks) {
    await createRemarksUpdateLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      previousRemarks: article.remarks || '',
      newRemarks: updateData.remarks,
      userId: user?.id || updateData.userId || 'system',
      floorSupervisorId: user?.id || updateData.floorSupervisorId || 'system'
    });
  }

  // FIXED: Handle transfers based on which floor was updated
  // Auto-transfer completed work to next floor when updating any floor
  // Use the floor data already declared above
  
  if (floorData && floorData.completed > 0) {
    // Check if there's new work to transfer (completed > transferred)
    const alreadyTransferred = floorData.transferred || 0;
    const totalCompleted = floorData.completed;
    
    if (totalCompleted > alreadyTransferred) {
      console.log(`Auto-transferring ${totalCompleted - alreadyTransferred} units from ${normalizedFloor} to next floor`);
      await transferCompletedWorkToNextFloor(article, updateData, user, normalizedFloor);
    }
  }
  
  // Also check for M1 transfer if on Checking or Final Checking floor
  if ((normalizedFloor === 'Checking' || normalizedFloor === 'Final Checking') && floorData?.m1Quantity > 0) {
    const totalM1Quantity = floorData.m1Quantity || 0;
    const transferredM1Quantity = floorData.m1Transferred || 0;
    const remainingM1Quantity = totalM1Quantity - transferredM1Quantity;
    
    if (remainingM1Quantity > 0) {
      console.log(`Auto-transferring remaining M1 quantity: ${remainingM1Quantity} from ${normalizedFloor}`);
      await transferM1ToNextFloor(article, remainingM1Quantity, user, updateData, normalizedFloor);
    }
  }
  
  // Special handling for Final Checking floor - auto-transfer completed work to branding
  if (normalizedFloor === 'Final Checking' && floorData?.completed > 0) {
    const alreadyTransferred = floorData.transferred || 0;
    const totalCompleted = floorData.completed;
    
    if (totalCompleted > alreadyTransferred) {
      console.log(`Auto-transferring ${totalCompleted - alreadyTransferred} units from Final Checking to Branding`);
      await transferCompletedWorkToNextFloor(article, updateData, user, 'Final Checking');
    }
  }
  
  // DISABLED: Check if there's remaining work on other previous floors that needs to be transferred
  // This function was causing conflicts and double-counting issues
  await checkAndTransferPreviousFloorWork(article, updateData, user, normalizedFloor);

  return article;
};

/**
 * Check and transfer completed work from previous floors
 * @param {Article} article
 * @param {Object} updateData
 * @param {Object} user
 * @param {string} excludeFloor - Floor to exclude from transfer (already handled)
 */
const checkAndTransferPreviousFloorWork = async (article, updateData, user = null, excludeFloor = null) => {
  const floorOrder = [
    'Knitting',
    'Linking', 
    'Checking',
    'Washing',
    'Boarding',
    'Final Checking',
    'Branding',
    'Warehouse'
  ];

  const currentIndex = floorOrder.indexOf(article.currentFloor);
  
  // Only check previous floors if we're updating the current floor or a previous floor
  // Don't run this when updating floors that are ahead of current floor
  const updatedFloorIndex = floorOrder.indexOf(excludeFloor);
  if (updatedFloorIndex > currentIndex) {
    console.log(`Skipping previous floor transfer check - updated floor (${excludeFloor}) is ahead of current floor (${article.currentFloor})`);
    return;
  }
  
  // Check all previous floors for completed work
  for (let i = 0; i < currentIndex; i++) {
    const previousFloor = floorOrder[i];
    
    // Skip the floor that was just updated
    if (previousFloor === excludeFloor) continue;
    
    const previousFloorKey = article.getFloorKey(previousFloor);
    const previousFloorData = article.floorQuantities[previousFloorKey];
    
    // Only transfer if there's completed work that hasn't been transferred yet
    if (previousFloorData && previousFloorData.completed > 0 && previousFloorData.transferred < previousFloorData.completed) {
      console.log(`Transferring remaining work from ${previousFloor}: completed=${previousFloorData.completed}, transferred=${previousFloorData.transferred}`);
      await transferFromPreviousFloor(article, previousFloor, previousFloorData.completed, updateData, user);
    }
  }
};

/**
 * Transfer completed work from a specific previous floor
 * @param {Article} article
 * @param {string} fromFloor
 * @param {number} quantity
 * @param {Object} updateData
 * @param {Object} user
 */
const transferFromPreviousFloor = async (article, fromFloor, quantity, updateData, user = null) => {
  const fromFloorKey = article.getFloorKey(fromFloor);
  const fromFloorData = article.floorQuantities[fromFloorKey];
  
  // Calculate how much work is already transferred vs completed
  const alreadyTransferred = fromFloorData.transferred || 0;
  const totalCompleted = fromFloorData.completed || 0;
  
  // Only transfer the newly completed work (not already transferred)
  const newTransferQuantity = totalCompleted - alreadyTransferred;
  
  if (newTransferQuantity <= 0) {
    console.log(`No new work to transfer from ${fromFloor}: completed=${totalCompleted}, transferred=${alreadyTransferred}`);
    return;
  }
  
  console.log(`Transferring ${newTransferQuantity} from ${fromFloor} to ${article.currentFloor}: completed=${totalCompleted}, transferred=${alreadyTransferred}`);
  
  // Update previous floor: mark additional work as transferred
  fromFloorData.transferred = totalCompleted; // Set transferred to total completed
  
  // For knitting floor, remaining can be negative (excess generation)
  // For other floors, remaining = received - completed
  if (fromFloor === 'Knitting') {
    fromFloorData.remaining = Math.max(0, fromFloorData.received - totalCompleted);
  } else {
    fromFloorData.remaining = fromFloorData.received - totalCompleted;
  }
  
  // Update next floor: mark as received (FIXED: transfer to the next floor, not current floor)
  const nextFloor = getNextFloor(fromFloor, article.linkingType);
  if (!nextFloor) {
    console.log(`No next floor available after ${fromFloor}`);
    return;
  }
  
  const nextFloorKey = article.getFloorKey(nextFloor);
  const nextFloorData = article.floorQuantities[nextFloorKey];
  
  // For knitting floor overproduction, transfer the full completed amount (including excess)
  // For other floors, transfer the normal amount
  if (fromFloor === 'Knitting') {
    nextFloorData.received = totalCompleted; // Transfer full completed amount (including overproduction)
  } else {
    nextFloorData.received = fromFloorData.transferred; // Normal transfer
  }
  
  nextFloorData.remaining = nextFloorData.received - (nextFloorData.completed || 0);
  
  await article.save();
  
  // Create transfer log using proper enum value
  await createTransferLog({
    articleId: article._id.toString(),
    orderId: article.orderId.toString(),
    fromFloor: fromFloor,
    toFloor: article.currentFloor,
    quantity: newTransferQuantity,
    userId: user?.id || updateData.userId || 'system',
    floorSupervisorId: user?.id || updateData.floorSupervisorId || 'system',
    remarks: `Transferred ${newTransferQuantity} completed units from ${fromFloor} to ${article.currentFloor} (Total completed: ${totalCompleted}, Total transferred: ${fromFloorData.transferred})`
  });
};

/**
 * Transfer article to next floor
 * @param {string} floor
 * @param {ObjectId} orderId
 * @param {ObjectId} articleId
 * @param {Object} transferData
 * @returns {Promise<Object>}
 */
export const transferArticle = async (floor, orderId, articleId, transferData, user = null) => {
  const article = await Article.findOne({ _id: articleId, orderId })
    .populate('machineId', 'machineCode machineNumber model floor status capacityPerShift capacityPerDay assignedSupervisor');
  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found in this order');
  }

  // Map URL-friendly floor names to proper enum values
  const floorMapping = {
    'FinalChecking': 'Final Checking',
    'finalchecking': 'Final Checking',
    'final-checking': 'Final Checking',
    'final_checking': 'Final Checking'
  };

  // Convert floor name if needed
  const normalizedFloor = floorMapping[floor] || floor;

  // FIXED: Allow transfer from any floor, not just current floor
  // Check if the floor has completed work to transfer
  const floorKey = article.getFloorKey(normalizedFloor);
  const floorData = article.floorQuantities[floorKey];
  
  if (!floorData || floorData.completed <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, `No completed work on ${normalizedFloor} floor to transfer`);
  }

  const nextFloor = getNextFloor(normalizedFloor, article.linkingType);
  if (!nextFloor) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No next floor available');
  }

  // Transfer completed work from the specified floor to next floor
  const transferQuantity = floorData.completed;
  
  // Update source floor: mark as transferred
  floorData.transferred = transferQuantity;
  
  // For knitting floor overproduction, remaining should never go negative
  // For other floors, normal calculation
  if (normalizedFloor === 'Knitting') {
    floorData.remaining = Math.max(0, floorData.received - transferQuantity);
  } else {
    floorData.remaining = floorData.received - transferQuantity;
  }
  
  // Update destination floor: mark as received
  const nextFloorKey = article.getFloorKey(nextFloor);
  const nextFloorData = article.floorQuantities[nextFloorKey];
  
  // For knitting floor overproduction, transfer the full completed amount (including excess)
  // For other floors, transfer the normal amount
  if (normalizedFloor === 'Knitting') {
    nextFloorData.received = transferQuantity; // Transfer full completed amount (including overproduction)
  } else {
    nextFloorData.received = transferQuantity; // Normal transfer
  }
  
  nextFloorData.remaining = nextFloorData.received;
  
  // Update article machineId if provided
  if (transferData.machineId !== undefined) {
    article.machineId = transferData.machineId;
  }
  
  // Update article current floor to next floor (only if transferring from current floor)
  if (article.currentFloor === normalizedFloor) {
    article.currentFloor = nextFloor;
    article.status = 'Pending';
    article.progress = 0;
    article.startedAt = null;
    article.completedAt = null;
    
    // Reset floor-specific fields for new floor
    if (nextFloor !== 'Final Checking') {
      article.m1Quantity = 0;
      article.m2Quantity = 0;
      article.m3Quantity = 0;
      article.m4Quantity = 0;
      article.repairStatus = 'Not Required';
      article.repairRemarks = '';
      article.finalQualityConfirmed = false;
    }
  }
  
  article.quantityFromPreviousFloor = transferQuantity;

  await article.save();

  // Update order current floor
  const order = await ProductionOrder.findById(orderId);
  if (order) {
    order.currentFloor = nextFloor;
    await order.save();
  }

  // Create transfer log
  await createTransferLog({
    articleId: article._id.toString(),
    orderId: article.orderId.toString(),
    fromFloor: normalizedFloor,
    toFloor: nextFloor,
    quantity: article.quantityFromPreviousFloor,
    userId: user?.id || transferData.userId || 'system',
    floorSupervisorId: user?.id || transferData.floorSupervisorId || 'system',
    remarks: transferData.remarks || `Transferred from ${normalizedFloor} to ${nextFloor}`,
    batchNumber: transferData.batchNumber,
    machineId: transferData.machineId
  });

  return {
    article,
    transferDetails: {
      fromFloor: normalizedFloor,
      toFloor: nextFloor,
      quantity: article.quantityFromPreviousFloor,
      timestamp: new Date().toISOString()
    }
  };
};

/**
 * Transfer completed work to next floor immediately (continuous flow)
 * @param {Article} article
 * @param {Object} updateData
 * @param {Object} user
 * @param {string} fromFloor - Floor to transfer from (optional, defaults to current floor)
 */
const transferCompletedWorkToNextFloor = async (article, updateData, user = null, fromFloor = null) => {
  const sourceFloor = fromFloor || article.currentFloor;
  const nextFloor = getNextFloor(sourceFloor, article.linkingType);
  if (!nextFloor) return;

  // Get source and next floor keys
  const sourceFloorKey = article.getFloorKey(sourceFloor);
  const nextFloorKey = article.getFloorKey(nextFloor);
  const sourceFloorData = article.floorQuantities[sourceFloorKey];
  const nextFloorData = article.floorQuantities[nextFloorKey];

  // Calculate how much work is already transferred vs completed
  const alreadyTransferred = sourceFloorData.transferred || 0;
  const totalCompleted = sourceFloorData.completed || 0;
  
  // Only transfer the newly completed work (not already transferred)
  const newTransferQuantity = totalCompleted - alreadyTransferred;
  
  if (newTransferQuantity <= 0) {
    console.log(`No new work to transfer from ${sourceFloor}: completed=${totalCompleted}, transferred=${alreadyTransferred}`);
    return; // Nothing new to transfer
  }
  
  console.log(`Transferring ${newTransferQuantity} from ${sourceFloor} to ${nextFloor}: completed=${totalCompleted}, transferred=${alreadyTransferred}`);
  
  // Update source floor: mark additional work as transferred
  sourceFloorData.transferred = totalCompleted; // Set transferred to total completed
  
  // For checking and finalChecking floors, ensure completed equals transferred
  if (sourceFloor === 'Checking' || sourceFloor === 'Final Checking') {
    if (sourceFloorData.completed < sourceFloorData.transferred) {
      sourceFloorData.completed = sourceFloorData.transferred;
    }
  }
  
  // Update remaining quantity on source floor
  // For knitting floor overproduction, remaining should never go negative
  // For other floors, normal calculation
  if (sourceFloor === 'Knitting') {
    sourceFloorData.remaining = Math.max(0, sourceFloorData.received - sourceFloorData.transferred);
  } else {
    sourceFloorData.remaining = Math.max(0, sourceFloorData.received - sourceFloorData.transferred);
  }
  
  // Update next floor: mark as received (FIXED: set to total transferred to prevent double-counting)
  // For knitting floor overproduction, transfer the full completed amount (including excess)
  // For other floors, transfer the normal amount
  if (sourceFloor === 'Knitting') {
    nextFloorData.received = sourceFloorData.completed; // Transfer full completed amount (including overproduction)
  } else {
    nextFloorData.received = sourceFloorData.transferred; // Normal transfer
  }
  
  nextFloorData.remaining = nextFloorData.received - (nextFloorData.completed || 0);

  // Update article current floor to next floor (only if transferring from current floor)
  if (article.currentFloor === sourceFloor) {
    article.currentFloor = nextFloor;
    article.quantityFromPreviousFloor = newTransferQuantity;

    // Reset floor-specific fields for new floor
    if (nextFloor !== 'Final Checking') {
      article.m1Quantity = 0;
      article.m2Quantity = 0;
      article.m3Quantity = 0;
      article.m4Quantity = 0;
      article.repairStatus = 'Not Required';
      article.repairRemarks = '';
      article.finalQualityConfirmed = false;
    }

    // Update order current floor
    const order = await ProductionOrder.findById(article.orderId);
    if (order) {
      order.currentFloor = nextFloor;
      await order.save();
    }
  }

  await article.save();

  // Create transfer log using proper enum value
  await createTransferLog({
    articleId: article._id.toString(),
    orderId: article.orderId.toString(),
    fromFloor: sourceFloor,
    toFloor: nextFloor,
    quantity: newTransferQuantity,
    userId: user?.id || updateData.userId || 'system',
    floorSupervisorId: user?.id || updateData.floorSupervisorId || 'system',
    remarks: `Auto-transferred ${newTransferQuantity} completed units from ${sourceFloor} to ${nextFloor} (Total completed: ${totalCompleted}, Total transferred: ${sourceFloorData.transferred}, Remaining: ${sourceFloorData.remaining})`
  });
};

/**
 * Auto-transfer article to next floor when completed (legacy - for full completion)
 * @param {Article} article
 * @param {Object} updateData
 */
const autoTransferToNextFloor = async (article, updateData, user = null) => {
  const nextFloor = getNextFloor(article.currentFloor, article.linkingType);
  if (!nextFloor) return;

  // Get current and next floor keys
  const currentFloorKey = article.getFloorKey(article.currentFloor);
  const nextFloorKey = article.getFloorKey(nextFloor);
  const currentFloorData = article.floorQuantities[currentFloorKey];
  const nextFloorData = article.floorQuantities[nextFloorKey];

  // Transfer completed quantity from current floor to next floor
  const transferQuantity = currentFloorData.completed;
  
  // Update current floor: mark as transferred
  currentFloorData.transferred += transferQuantity;
  currentFloorData.remaining = 0; // All remaining work is now transferred
  
  // For checking and finalChecking floors, ensure completed equals transferred
  // This fixes the issue where items are transferred without being marked as completed
  if (article.currentFloor === 'Checking' || article.currentFloor === 'Final Checking') {
    if (currentFloorData.completed < currentFloorData.transferred) {
      currentFloorData.completed = currentFloorData.transferred;
    }
  }
  
  // Update next floor: mark as received (FIXED: set to total transferred to prevent double-counting)
  // For knitting floor overproduction, transfer the full completed amount (including excess)
  // For other floors, transfer the normal amount
  if (article.currentFloor === 'Knitting') {
    nextFloorData.received = currentFloorData.completed; // Transfer full completed amount (including overproduction)
  } else {
    nextFloorData.received = currentFloorData.transferred; // Normal transfer
  }
  
  nextFloorData.remaining = nextFloorData.received - (nextFloorData.completed || 0);

  // Update article
  article.currentFloor = nextFloor;
  article.status = 'Pending';
  article.progress = 0;
  article.quantityFromPreviousFloor = transferQuantity;
  article.startedAt = null;
  article.completedAt = null;

  // Reset floor-specific fields for new floor
  if (nextFloor !== 'Final Checking') {
    article.m1Quantity = 0;
    article.m2Quantity = 0;
    article.m3Quantity = 0;
    article.m4Quantity = 0;
    article.repairStatus = 'Not Required';
    article.repairRemarks = '';
    article.finalQualityConfirmed = false;
  }

  await article.save();

  // Update order current floor
  const order = await ProductionOrder.findById(article.orderId);
  if (order) {
    order.currentFloor = nextFloor;
    await order.save();
  }

  // Create auto-transfer log using proper enum value
  await createTransferLog({
    articleId: article._id.toString(),
    orderId: article.orderId.toString(),
    fromFloor: article.currentFloor,
    toFloor: nextFloor,
    quantity: transferQuantity,
    userId: user?.id || updateData.userId || 'system',
    floorSupervisorId: user?.id || updateData.floorSupervisorId || 'system',
    remarks: `Auto-transferred ${transferQuantity} units from ${article.currentFloor} to ${nextFloor}`
  });
};

/**
 * Get next floor in production flow based on linking type
 * @param {string} currentFloor
 * @param {string} linkingType
 * @returns {string|null}
 */
const getNextFloor = (currentFloor, linkingType) => {
  const floorSequence = getFloorOrderByLinkingType(linkingType);
  const currentIndex = floorSequence.indexOf(currentFloor);
  return currentIndex < floorSequence.length - 1 ? floorSequence[currentIndex + 1] : null;
};

/**
 * Bulk update articles
 * @param {Array} updates - Array of update objects
 * @param {number} batchSize - Number of updates to process in each batch
 * @returns {Promise<Object>}
 */
export const bulkUpdateArticles = async (updates, batchSize = 50) => {
  const results = {
    total: updates.length,
    updated: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };

  const startTime = Date.now();

  try {
    // Process updates in batches
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (updateData, batchIndex) => {
        const globalIndex = i + batchIndex;
        
        try {
          const { floor, orderId, articleId, ...updateFields } = updateData;
          
          if (!floor || !orderId || !articleId) {
            throw new Error('Missing required fields: floor, orderId, articleId');
          }

          await updateArticleProgress(floor, orderId, articleId, updateFields);
          results.updated++;
          
        } catch (error) {
          results.failed++;
          results.errors.push({
            index: globalIndex,
            articleId: updateData.articleId || `Article ${globalIndex + 1}`,
            error: error.message,
          });
        }
      });

      await Promise.all(batchPromises);
      
      // Add delay between batches
      if (i + batchSize < updates.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    results.processingTime = Date.now() - startTime;
    console.log(`Bulk article update completed in ${results.processingTime}ms: ${results.updated} updated, ${results.failed} failed`);

  } catch (error) {
    results.processingTime = Date.now() - startTime;
    throw new ApiError(httpStatus.BAD_REQUEST, error.message);
  }

  return results;
};

/**
 * Get the proper transfer action enum value for a floor
 * @param {string} floor
 * @returns {string}
 */
const getTransferAction = (floor) => {
  const transferActions = {
    'Knitting': 'Transferred to Knitting',
    'Linking': 'Transferred to Linking',
    'Checking': 'Transferred to Checking',
    'Washing': 'Transferred to Washing',
    'Boarding': 'Transferred to Boarding',
    'Branding': 'Transferred to Branding',
    'Final Checking': 'Transferred to Final Checking',
    'Warehouse': 'Transferred to Warehouse'
  };
  
  return transferActions[floor] || 'Transferred to Next Floor';
};

/**
 * Perform quality inspection on an article
 * @param {ObjectId} articleId
 * @param {Object} inspectionData
 * @param {Object} user - Current user from request
 * @returns {Promise<Article>}
 */
/**
 * Fix completion status for articles that have transferred items but incomplete status
 * @param {ObjectId} orderId - Optional order ID to fix specific order
 * @returns {Promise<Object>}
 */
export const fixCompletionStatus = async (orderId = null) => {
  try {
    const query = orderId ? { orderId } : {};
    const articles = await Article.find(query);
    
    let fixedCount = 0;
    const fixedArticles = [];
    
    for (const article of articles) {
      const wasFixed = article.fixCompletionStatus();
      if (wasFixed) {
        await article.save();
        fixedCount++;
        fixedArticles.push({
          articleId: article._id,
          articleNumber: article.articleNumber,
          orderId: article.orderId
        });
      }
    }
    
    return {
      success: true,
      message: `Fixed completion status for ${fixedCount} articles`,
      fixedCount,
      fixedArticles
    };
  } catch (error) {
    console.error('Error fixing completion status:', error);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to fix completion status');
  }
};

export const fixDataCorruption = async (articleId) => {
  try {
    console.log(`🔧 Starting data corruption fix for article ${articleId}...`);
    
    const article = await Article.findById(articleId)
      .populate('machineId', 'machineCode machineNumber model floor status capacityPerShift capacityPerDay assignedSupervisor');
    if (!article) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
    }
    
    // Fix all data inconsistencies
    const fixResult = article.fixAllFloorDataConsistency();
    
    if (fixResult.fixed) {
      await article.save();
      console.log(`✅ Fixed data corruption for article ${article.articleNumber}:`, fixResult.fixes);
      
      return {
        success: true,
        articleId: article._id,
        articleNumber: article.articleNumber,
        fixed: true,
        fixes: fixResult.fixes,
        totalFixed: fixResult.totalFixed,
        updatedData: fixResult.updatedData
      };
    } else {
      return {
        success: true,
        articleId: article._id,
        articleNumber: article.articleNumber,
        fixed: false,
        message: fixResult.message
      };
    }
  } catch (error) {
    console.error('❌ Error fixing data corruption:', error);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to fix data corruption');
  }
};

export const qualityInspection = async (articleId, inspectionData, user = null) => {
  const article = await Article.findById(articleId)
    .populate('machineId', 'machineCode machineNumber model floor status capacityPerShift capacityPerDay assignedSupervisor');
  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
  }

  // Determine which floor to perform quality inspection on
  // Priority: Final Checking > Checking (if both have work)
  let targetFloor = null;
  const finalCheckingData = article.floorQuantities.finalChecking;
  const checkingData = article.floorQuantities.checking;
  
  // If Final Checking has received work, use Final Checking
  if (finalCheckingData && finalCheckingData.received > 0) {
    targetFloor = 'Final Checking';
  }
  // Otherwise, use Checking floor
  else if (checkingData && checkingData.received > 0) {
    targetFloor = 'Checking';
  }
  else {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No quality inspection work available on Checking or Final Checking floors');
  }

  const previousProgress = article.progress;
  
  // Get previous quantities from the target floor
  const targetFloorKey = article.getFloorKey(targetFloor);
  const targetFloorData = article.floorQuantities[targetFloorKey];
  const previousM1 = Number(targetFloorData?.m1Quantity) || 0;
  const previousM2 = Number(targetFloorData?.m2Quantity) || 0;
  const previousM3 = Number(targetFloorData?.m3Quantity) || 0;
  const previousM4 = Number(targetFloorData?.m4Quantity) || 0;

  // Quality quantities are now only stored in floor-specific fields
  // No article-level quality fields to update

  // Update remarks if provided
  if (inspectionData.remarks) {
    article.remarks = inspectionData.remarks;
  }

  // Update floor-specific quality data
  // Update the target floor (Checking or Final Checking)
  
  if (targetFloorData) {
    // FIXED: Set quantities instead of adding them
    // When user sends m1Quantity: 800, it means "set M1 to 800", not "add 800 to existing M1"
    if (inspectionData.m1Quantity !== undefined) {
      targetFloorData.m1Quantity = inspectionData.m1Quantity;
    }
    if (inspectionData.m2Quantity !== undefined) {
      targetFloorData.m2Quantity = inspectionData.m2Quantity;
    }
    if (inspectionData.m3Quantity !== undefined) {
      targetFloorData.m3Quantity = inspectionData.m3Quantity;
    }
    if (inspectionData.m4Quantity !== undefined) {
      targetFloorData.m4Quantity = inspectionData.m4Quantity;
    }
    
    // FIXED: Update completed quantity based on inspectedQuantity
    if (inspectionData.inspectedQuantity !== undefined) {
      targetFloorData.completed = inspectionData.inspectedQuantity;
      // Recalculate remaining quantity (ensure non-negative)
      targetFloorData.remaining = Math.max(0, targetFloorData.received - targetFloorData.completed);
    }
    
    if (inspectionData.repairStatus !== undefined) {
      targetFloorData.repairStatus = inspectionData.repairStatus;
    }
    if (inspectionData.repairRemarks !== undefined) {
      targetFloorData.repairRemarks = inspectionData.repairRemarks;
    }
  }

  // Update progress based on floor quantities
  article.progress = article.calculatedProgress;

  // Update timestamps
  if (article.status === 'Pending' && (Number(inspectionData.inspectedQuantity) > 0 || inspectionData.m1Quantity > 0)) {
    article.status = 'In Progress';
    article.startedAt = new Date().toISOString();
  }

  await article.save();

  // Create quality inspection log
  await createQualityInspectionLog({
    articleId: article._id.toString(),
    orderId: article.orderId.toString(),
    floor: article.currentFloor,
    inspectedQuantity: Number(inspectionData.inspectedQuantity) || 0,
    m1Quantity: inspectionData.m1Quantity || 0,
    m2Quantity: inspectionData.m2Quantity || 0,
    m3Quantity: inspectionData.m3Quantity || 0,
    m4Quantity: inspectionData.m4Quantity || 0,
    userId: inspectionData.userId || user?.id || 'system',
    floorSupervisorId: inspectionData.floorSupervisorId || user?.id || 'system',
    remarks: `Quality inspection completed on ${targetFloor}: Added M1=${inspectionData.m1Quantity || 0}, M2=${inspectionData.m2Quantity || 0}, M3=${inspectionData.m3Quantity || 0}, M4=${inspectionData.m4Quantity || 0}. Total M1 now: ${targetFloorData?.m1Quantity || 0}`,
    machineId: inspectionData.machineId,
    shiftId: inspectionData.shiftId
  });

  // Create individual quantity change logs if there are changes
  if (inspectionData.m1Quantity && inspectionData.m1Quantity > 0) {
    await createQualityCategoryLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      floor: targetFloor,
      category: 'M1',
      previousQuantity: previousM1,
      newQuantity: targetFloorData?.m1Quantity || 0,
      userId: inspectionData.userId || user?.id || 'system',
      floorSupervisorId: inspectionData.floorSupervisorId || user?.id || 'system',
      remarks: `Added ${inspectionData.m1Quantity} M1 quantity on ${targetFloor}. Previous: ${previousM1}, New total: ${targetFloorData?.m1Quantity || 0}`
    });
  }

  if (inspectionData.m2Quantity && inspectionData.m2Quantity > 0) {
    await createQualityCategoryLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      floor: article.currentFloor,
      category: 'M2',
      previousQuantity: previousM2,
      newQuantity: currentFloorData?.m2Quantity || 0,
      userId: inspectionData.userId || user?.id || 'system',
      floorSupervisorId: inspectionData.floorSupervisorId || user?.id || 'system',
      remarks: `Added ${inspectionData.m2Quantity} M2 quantity. Previous: ${previousM2}, New total: ${currentFloorData?.m2Quantity || 0}`
    });
  }

  if (inspectionData.m3Quantity && inspectionData.m3Quantity > 0) {
    await createQualityCategoryLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      floor: article.currentFloor,
      category: 'M3',
      previousQuantity: previousM3,
      newQuantity: currentFloorData?.m3Quantity || 0,
      userId: inspectionData.userId || user?.id || 'system',
      floorSupervisorId: inspectionData.floorSupervisorId || user?.id || 'system',
      remarks: `Added ${inspectionData.m3Quantity} M3 quantity. Previous: ${previousM3}, New total: ${currentFloorData?.m3Quantity || 0}`
    });
  }

  if (inspectionData.m4Quantity && inspectionData.m4Quantity > 0) {
    await createQualityCategoryLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      floor: article.currentFloor,
      category: 'M4',
      previousQuantity: previousM4,
      newQuantity: currentFloorData?.m4Quantity || 0,
      userId: inspectionData.userId || user?.id || 'system',
      floorSupervisorId: inspectionData.floorSupervisorId || user?.id || 'system',
      remarks: `Added ${inspectionData.m4Quantity} M4 quantity. Previous: ${previousM4}, New total: ${currentFloorData?.m4Quantity || 0}`
    });
  }

  if (article.progress !== previousProgress) {
    await createProgressUpdateLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      previousProgress,
      newProgress: article.progress,
      userId: inspectionData.userId || user?.id || 'system',
      floorSupervisorId: inspectionData.floorSupervisorId || user?.id || 'system',
      remarks: `Progress updated to ${article.progress}% after quality inspection`
    });
  }

  // Auto-transfer M1 quantity to next floor (when doing quality inspection on Checking or Final Checking floor)
  // FIXED: Calculate the NEW M1 quantity to transfer (current M1 - previously transferred M1)
  if ((targetFloor === 'Checking' || targetFloor === 'Final Checking') && inspectionData.m1Quantity > 0) {
    const currentM1Quantity = targetFloorData.m1Quantity || 0;
    const previouslyTransferredM1 = targetFloorData.m1Transferred || 0;
    const newM1ToTransfer = currentM1Quantity - previouslyTransferredM1;
    
    if (newM1ToTransfer > 0) {
      console.log(`Transferring new M1 quantity from ${targetFloor}: ${newM1ToTransfer} (Total M1: ${currentM1Quantity}, Previously transferred: ${previouslyTransferredM1})`);
      await transferM1ToNextFloor(article, newM1ToTransfer, user, inspectionData, targetFloor);
    }
  }
  
  // REMOVED: The second transfer was causing double-counting
  // The transferM1ToNextFloor function already handles tracking transferred quantities

  return article;
};

/**
 * Auto-transfer completed work to next floor when current floor is completed
 * @param {Article} article
 * @param {Object} updateData
 * @param {Object} user
 */
const autoTransferCompletedWorkToNextFloor = async (article, updateData, user = null) => {
  const nextFloor = getNextFloor(article.currentFloor, article.linkingType);
  if (!nextFloor) {
    console.log(`No next floor available for ${article.currentFloor}`);
    return;
  }

  // Get current and next floor keys
  const currentFloorKey = article.getFloorKey(article.currentFloor);
  const nextFloorKey = article.getFloorKey(nextFloor);
  const currentFloorData = article.floorQuantities[currentFloorKey];
  const nextFloorData = article.floorQuantities[nextFloorKey];

  if (!currentFloorData || !nextFloorData) {
    console.log('Floor data not found for auto-transfer');
    return;
  }

  // Calculate transfer quantity (completed work)
  const transferQuantity = currentFloorData.completed;
  
  if (transferQuantity <= 0) {
    console.log('No completed work to transfer');
    return;
  }

  // Update current floor: mark as transferred
  currentFloorData.transferred = transferQuantity;
  currentFloorData.remaining = 0; // All work is now transferred
  
  // For checking and finalChecking floors, ensure completed equals transferred
  // This fixes the issue where items are transferred without being marked as completed
  if (article.currentFloor === 'Checking' || article.currentFloor === 'Final Checking') {
    if (currentFloorData.completed < currentFloorData.transferred) {
      currentFloorData.completed = currentFloorData.transferred;
    }
  }

  // Update next floor: mark as received (FIXED: set to total transferred to prevent double-counting)
  // For knitting floor overproduction, transfer the full completed amount (including excess)
  // For other floors, transfer the normal amount
  if (article.currentFloor === 'Knitting') {
    nextFloorData.received = currentFloorData.completed; // Transfer full completed amount (including overproduction)
  } else {
    nextFloorData.received = currentFloorData.transferred; // Normal transfer
  }
  
  nextFloorData.remaining = nextFloorData.received - (nextFloorData.completed || 0);

  // Update article
  article.currentFloor = nextFloor;
  article.status = 'Pending'; // Reset status for new floor
  article.progress = 0; // Reset progress for new floor
  article.quantityFromPreviousFloor = transferQuantity;
  article.startedAt = null;
  article.completedAt = null;

  await article.save();

  // Update order current floor
  const order = await ProductionOrder.findById(article.orderId);
  if (order) {
    order.currentFloor = nextFloor;
    await order.save();
  }

  // Create auto-transfer log
  await createTransferLog({
    articleId: article._id.toString(),
    orderId: article.orderId.toString(),
    fromFloor: article.currentFloor === nextFloor ? currentFloorKey : article.currentFloor,
    toFloor: nextFloor,
    quantity: transferQuantity,
    userId: user?.id || updateData.userId || 'system',
    floorSupervisorId: user?.id || updateData.floorSupervisorId || 'system',
    remarks: `Auto-transferred ${transferQuantity} completed units from ${article.currentFloor === nextFloor ? currentFloorKey : article.currentFloor} to ${nextFloor} after floor completion`
  });

  console.log(`✅ Auto-transfer completed: ${transferQuantity} units from ${article.currentFloor === nextFloor ? currentFloorKey : article.currentFloor} to ${nextFloor}`);
};

/**
 * Transfer M1 quantity from Checking or Final Checking floor to next floor
 * @param {Article} article
 * @param {number} m1Quantity
 * @param {Object} user
 * @param {Object} inspectionData
 * @param {string} fromFloor - Floor to transfer from (optional, defaults to current floor)
 */
const transferM1ToNextFloor = async (article, m1Quantity, user = null, inspectionData = {}, fromFloor = null) => {
  const sourceFloor = fromFloor || article.currentFloor;
  
  // Get next floor based on source floor
  const nextFloor = getNextFloor(sourceFloor, article.linkingType);
  if (!nextFloor) {
    console.log('No next floor available for M1 transfer');
    return;
  }

  // Get source and next floor keys
  const sourceFloorKey = article.getFloorKey(sourceFloor);
  const nextFloorKey = article.getFloorKey(nextFloor);
  const sourceFloorData = article.floorQuantities[sourceFloorKey];
  const nextFloorData = article.floorQuantities[nextFloorKey];

  if (!sourceFloorData || !nextFloorData) {
    console.log('Floor data not found for M1 transfer');
    return;
  }

  // Update source floor: mark M1 as transferred
  const previousTransferred = sourceFloorData.m1Transferred || 0;
  const newM1Transferred = previousTransferred + m1Quantity;
  sourceFloorData.m1Transferred = newM1Transferred;
  
  // Also update the general transferred field for the floor
  sourceFloorData.transferred = (sourceFloorData.transferred || 0) + m1Quantity;
  
  // Update remaining quantity on source floor (received - transferred)
  sourceFloorData.remaining = Math.max(0, sourceFloorData.received - sourceFloorData.transferred);
  
  // Update M1 remaining (how much M1 is left on this floor)
  const currentM1Quantity = sourceFloorData.m1Quantity || 0;
  sourceFloorData.m1Remaining = Math.max(0, currentM1Quantity - newM1Transferred);

  // Update next floor: mark M1 as received (FIXED: set to total M1 transferred to prevent double-counting)
  const totalM1Transferred = newM1Transferred; // This is the total M1 transferred so far
  nextFloorData.received = totalM1Transferred;
  nextFloorData.remaining = totalM1Transferred - (nextFloorData.completed || 0);

  // Don't move article to next floor immediately for M1 transfer
  // Article should only move when ALL work on current floor is completed
  // This allows remaining M1 quantities to be transferred properly
  
  await article.save();

  // Don't update order current floor for M1 transfer
  // Order floor will be updated when article actually moves floors

  // Create M1 transfer log
  await createTransferLog({
    articleId: article._id.toString(),
    orderId: article.orderId.toString(),
    fromFloor: sourceFloor,
    toFloor: nextFloor,
    quantity: m1Quantity,
    userId: user?.id || inspectionData.userId || 'system',
    floorSupervisorId: user?.id || inspectionData.floorSupervisorId || 'system',
    remarks: `Auto-transferred ${m1Quantity} M1 (good quality) units from ${sourceFloor} to ${nextFloor}. Article remains on ${article.currentFloor} floor. Total M1 transferred: ${newM1Transferred}, M1 remaining: ${sourceFloorData.m1Remaining}`
  });

  console.log(`✅ M1 transfer completed: ${m1Quantity} units from ${sourceFloor} to ${nextFloor}. Article remains on ${article.currentFloor} floor. Total M1 transferred: ${newM1Transferred}, M1 remaining: ${sourceFloorData.m1Remaining}`);
};

// Note: createArticleLog function removed - now using loggingHelper.js functions
