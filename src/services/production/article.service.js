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
    'final_checking': 'Final Checking',
    'SecondaryChecking': 'Secondary Checking',
    'secondarychecking': 'Secondary Checking',
    'secondary-checking': 'Secondary Checking',
    'secondary_checking': 'Secondary Checking',
    'Silicon': 'Silicon',
    'silicon': 'Silicon'
  };

  // Convert floor name if needed
  const normalizedFloor = floorMapping[floor] || floor;

  // Validate floor-specific operations - use article's product process flow
  let floorOrder;
  try {
    floorOrder = await article.getFloorOrder();
  } catch (error) {
    // Fallback to linking type if product not found
    console.warn(`Using fallback floor order for article ${article.articleNumber}: ${error.message}`);
    floorOrder = getFloorOrderByLinkingType(article.linkingType);
  }
  
  const requestedFloorIndex = floorOrder.indexOf(normalizedFloor);
  
  if (requestedFloorIndex === -1) {
    throw new ApiError(
      httpStatus.BAD_REQUEST, 
      `Invalid floor: "${normalizedFloor}" is not in the product's process flow for article ${article.articleNumber}. ` +
      `Expected flow: ${floorOrder.join(' → ')}`
    );
  }
  
  // Get current active floor from article
  let currentFloor;
  try {
    currentFloor = await article.getCurrentActiveFloor();
  } catch (error) {
    currentFloor = article.currentFloor || floorOrder[0];
  }
  
  const currentFloorIndex = floorOrder.indexOf(currentFloor);
  
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
    
    // Handle quantity updates as additive for all floors
    // This allows cumulative updates where each request adds to the existing completed quantity
    let newCompletedQuantity;
    const currentCompleted = floorData.completed;
    
    // ALL FLOORS: Treat as additive (add to existing completed)
    newCompletedQuantity = currentCompleted + updateData.completedQuantity;
    console.log(`📊 ADDITIVE UPDATE: Adding ${updateData.completedQuantity} to existing ${currentCompleted} = ${newCompletedQuantity}`);
    
    // Validate that the quantity is positive
    if (updateData.completedQuantity <= 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Quantity must be positive. You provided: ${updateData.completedQuantity}`);
    }
    
    // Validate final quantity against floor received quantity
    // For knitting floor, allow excess quantity (machines can generate more than received)
    // For other floors, completed quantity cannot exceed received quantity
    if (normalizedFloor !== 'Knitting' && newCompletedQuantity > floorData.received) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Invalid completed quantity: must be between 0 and received quantity (${floorData.received}). Calculated total: ${newCompletedQuantity}`);
    }
    
    // Log overproduction for knitting floor
    if (normalizedFloor === 'Knitting' && newCompletedQuantity > floorData.received) {
      const overproduction = newCompletedQuantity - floorData.received;
      console.log(`🎯 KNITTING OVERPRODUCTION: Received ${floorData.received}, Completed ${newCompletedQuantity}, Overproduction: ${overproduction}`);
    }
    
    // Update floor-specific quantities
    const previousFloorCompleted = floorData.completed;
    floorData.completed = newCompletedQuantity;
    
    // Calculate remaining quantity
    // For knitting floor, remaining can be negative (excess generation)
    // For other floors, remaining is received - completed
    if (normalizedFloor === 'Knitting') {
      // For knitting floor, remaining should never go negative due to overproduction
      // If completed > received, remaining should be 0 (all planned work is done)
      floorData.remaining = Math.max(0, floorData.received - newCompletedQuantity);
    } else {
      // For other floors, normal calculation
      floorData.remaining = floorData.received - newCompletedQuantity;
    }
    
    // Update progress based on floor quantities
    article.progress = article.calculatedProgress;
  }

  // Update floor-specific fields for quality inspection floors
  if (normalizedFloor === 'Checking' || normalizedFloor === 'Secondary Checking' || normalizedFloor === 'Final Checking') {
    // Update floor-level quality fields (additive)
    const floorData = article.floorQuantities[floorKey];
    if (floorData) {
      if (updateData.m1Quantity !== undefined) floorData.m1Quantity = (floorData.m1Quantity || 0) + updateData.m1Quantity;
      if (updateData.m2Quantity !== undefined) floorData.m2Quantity = (floorData.m2Quantity || 0) + updateData.m2Quantity;
      if (updateData.m3Quantity !== undefined) floorData.m3Quantity = (floorData.m3Quantity || 0) + updateData.m3Quantity;
      if (updateData.m4Quantity !== undefined) floorData.m4Quantity = (floorData.m4Quantity || 0) + updateData.m4Quantity;
      if (updateData.repairStatus !== undefined) floorData.repairStatus = updateData.repairStatus;
      if (updateData.repairRemarks !== undefined) floorData.repairRemarks = updateData.repairRemarks;
      
      // Update M1 remaining after adding M1 quantity
      if (updateData.m1Quantity !== undefined) {
        floorData.m1Remaining = Math.max(0, floorData.m1Quantity - (floorData.m1Transferred || 0));
      }
    }
  }
  
  // Update knitting floor m4Quantity (defect quantity) - replace existing value
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
  if (article.currentFloor === 'Checking' || article.currentFloor === 'Secondary Checking' || article.currentFloor === 'Final Checking') {
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
    
    if (actualNewQuantity !== previousQuantity) {
      await createQuantityUpdateLog({
        articleId: article._id.toString(),
        orderId: article.orderId.toString(),
        floor: normalizedFloor,
        previousQuantity,
        newQuantity: actualNewQuantity,
        userId: user?.id || updateData.userId || 'system',
        floorSupervisorId: user?.id || updateData.floorSupervisorId || 'system',
        remarks: normalizedFloor === 'Knitting'
          ? `Set completed quantity to ${updateData.completedQuantity} on ${normalizedFloor} floor (was ${previousQuantity})`
          : `Added ${updateData.completedQuantity} units to ${normalizedFloor} floor (${previousQuantity} + ${updateData.completedQuantity} = ${actualNewQuantity})`,
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
  if ((normalizedFloor === 'Checking' || normalizedFloor === 'Secondary Checking' || normalizedFloor === 'Final Checking') && floorData?.m1Quantity > 0) {
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
    'Silicon',
    'Secondary Checking',
    'Branding',
    'Final Checking',
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
  const nextFloor = await getNextFloor(article, fromFloor);
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
    'final_checking': 'Final Checking',
    'SecondaryChecking': 'Secondary Checking',
    'secondarychecking': 'Secondary Checking',
    'secondary-checking': 'Secondary Checking',
    'secondary_checking': 'Secondary Checking',
    'Silicon': 'Silicon',
    'silicon': 'Silicon'
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

  // Validate that the floor is in the article's product process flow
  const floorOrder = await article.getFloorOrder();
  const floorIndex = floorOrder.indexOf(normalizedFloor);
  
  if (floorIndex === -1) {
    throw new ApiError(
      httpStatus.BAD_REQUEST, 
      `Floor "${normalizedFloor}" is not in the product's process flow for article ${article.articleNumber}. ` +
      `Expected flow: ${floorOrder.join(' → ')}`
    );
  }
  
  const nextFloor = floorOrder[floorIndex + 1];
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
    // KNITTING OVERPRODUCTION: Transfer full completed amount (including overproduction)
    nextFloorData.received = transferQuantity;
    console.log(`🎯 KNITTING MANUAL TRANSFER: Transferring ${transferQuantity} units (including overproduction) to ${nextFloor}`);
  } else {
    // Other floors: normal transfer
    nextFloorData.received = transferQuantity;
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
 * Transfer M2 (repairable) quantity from checking floor back to previous floor for repair
 * @param {string} floor - Checking floor (Checking, Secondary Checking, or Final Checking)
 * @param {ObjectId} orderId
 * @param {ObjectId} articleId
 * @param {Object} repairData
 * @param {Object} user - Current user from request
 * @returns {Promise<Object>}
 */
export const transferM2ForRepair = async (floor, orderId, articleId, repairData, user = null) => {
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
    'final_checking': 'Final Checking',
    'SecondaryChecking': 'Secondary Checking',
    'secondarychecking': 'Secondary Checking',
    'secondary-checking': 'Secondary Checking',
    'secondary_checking': 'Secondary Checking',
    'Checking': 'Checking',
    'checking': 'Checking'
  };

  // Convert floor name if needed
  const normalizedFloor = floorMapping[floor] || floor;

  // Validate that the floor is a checking floor
  const checkingFloors = ['Checking', 'Secondary Checking', 'Final Checking'];
  if (!checkingFloors.includes(normalizedFloor)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `M2 repair transfer can only be done from checking floors. ${normalizedFloor} is not a checking floor.`
    );
  }

  // Get floor data
  const floorKey = article.getFloorKey(normalizedFloor);
  const floorData = article.floorQuantities[floorKey];

  if (!floorData) {
    throw new ApiError(httpStatus.BAD_REQUEST, `No data found for ${normalizedFloor} floor`);
  }

  // Get M2 quantity (this is the current remaining M2, not including items already sent for repair)
  const m2Quantity = floorData.m2Quantity || 0;
  const m2Transferred = floorData.m2Transferred || 0;
  const m2Remaining = m2Quantity; // m2Quantity is already reduced when items are sent for repair

  if (m2Quantity <= 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `No M2 quantity available for repair transfer on ${normalizedFloor} floor. M2 Quantity: ${m2Quantity}, M2 Transferred (total sent): ${m2Transferred}`
    );
  }

  // Get quantity from request (default to all remaining if not specified)
  const quantity = repairData.quantity || m2Quantity;

  if (quantity <= 0 || quantity > m2Quantity) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Repair transfer quantity (${quantity}) must be between 1 and ${m2Quantity}`
    );
  }

  // Get target floor from request (optional - defaults to immediate previous floor)
  let targetFloor = null;
  if (repairData.targetFloor) {
    // Map target floor name if needed
    const targetFloorNormalized = floorMapping[repairData.targetFloor] || repairData.targetFloor;
    targetFloor = targetFloorNormalized;
  }

  // Transfer M2 for repair using article model method
  const result = await article.transferM2ForRepair(
    normalizedFloor,
    quantity,
    user?.id || repairData.userId || 'system',
    user?.id || repairData.floorSupervisorId || 'system',
    repairData.remarks || '',
    targetFloor
  );

  await article.save();

  // Create transfer log
  await createTransferLog({
    articleId: article._id.toString(),
    orderId: article.orderId.toString(),
    fromFloor: normalizedFloor,
    toFloor: result.targetFloor,
    quantity: quantity,
    userId: user?.id || repairData.userId || 'system',
    floorSupervisorId: user?.id || repairData.floorSupervisorId || 'system',
    remarks: repairData.remarks || `M2 repair transfer: ${quantity} repairable items sent back to ${result.targetFloor} for repair`
  });

  return {
    article,
    repairTransferDetails: {
      fromFloor: normalizedFloor,
      toFloor: result.targetFloor,
      quantity: quantity,
      m2Quantity: result.m2Quantity,  // Updated M2 quantity (reduced)
      m2Transferred: result.m2Transferred,  // Total sent for repair (audit trail)
      m2Remaining: result.m2Remaining,
      targetFloorReceived: result.targetFloorReceived,
      targetFloorRepairReceived: result.targetFloorRepairReceived,
      message: result.message,
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
  const nextFloor = await getNextFloor(article, sourceFloor);
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
    if (sourceFloor === 'Checking' || sourceFloor === 'Secondary Checking' || sourceFloor === 'Final Checking') {
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
    // KNITTING OVERPRODUCTION: Transfer full completed amount (including overproduction)
    // Example: Received 1000, Completed 1200, Transfer 1200 to next floor
    nextFloorData.received = sourceFloorData.completed;
    console.log(`🎯 KNITTING TRANSFER: Transferring ${sourceFloorData.completed} units (including overproduction) to ${nextFloor}`);
  } else {
    // Other floors: normal transfer based on transferred quantity
    nextFloorData.received = sourceFloorData.transferred;
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
  const nextFloor = await getNextFloor(article, article.currentFloor);
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
 * Get next floor in production flow based on article's product process flow
 * @param {Article} article
 * @param {string} currentFloor
 * @returns {Promise<string|null>}
 */
const getNextFloor = async (article, currentFloor) => {
  try {
    // Use article's product process flow
    const floorOrder = await article.getFloorOrder();
    const currentIndex = floorOrder.indexOf(currentFloor);
    return currentIndex < floorOrder.length - 1 ? floorOrder[currentIndex + 1] : null;
  } catch (error) {
    console.warn(`Error getting floor order for article ${article.articleNumber}, using fallback: ${error.message}`);
    // Fallback to linking type if product not found
    const floorSequence = getFloorOrderByLinkingType(article.linkingType);
    const currentIndex = floorSequence.indexOf(currentFloor);
    return currentIndex < floorSequence.length - 1 ? floorSequence[currentIndex + 1] : null;
  }
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
    'Secondary Checking': 'Transferred to Secondary Checking',
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
  let targetFloor = null;
  const finalCheckingData = article.floorQuantities.finalChecking;
  const checkingData = article.floorQuantities.checking;
  const secondaryCheckingData = article.floorQuantities.secondaryChecking;
  
  // If floor is specified in request, use that floor
  if (inspectionData.floor) {
    // Normalize floor name using the same mapping as other endpoints
    const floorMapping = {
      'FinalChecking': 'Final Checking',
      'finalchecking': 'Final Checking',
      'final-checking': 'Final Checking',
      'final_checking': 'Final Checking',
      'SecondaryChecking': 'Secondary Checking',
      'secondarychecking': 'Secondary Checking',
      'secondary-checking': 'Secondary Checking',
      'secondary_checking': 'Secondary Checking',
      'Silicon': 'Silicon',
      'silicon': 'Silicon'
    };
    targetFloor = floorMapping[inspectionData.floor] || inspectionData.floor;
    console.log(`🎯 User specified floor: ${targetFloor} (normalized from: ${inspectionData.floor})`);
  }
  // Otherwise, choose the floor with MORE remaining work to inspect
  else {
    // Find all checking floors with remaining work
    const floorsWithWork = [];
    if (checkingData && checkingData.remaining > 0) {
      floorsWithWork.push({ floor: 'Checking', remaining: checkingData.remaining });
    }
    if (secondaryCheckingData && secondaryCheckingData.remaining > 0) {
      floorsWithWork.push({ floor: 'Secondary Checking', remaining: secondaryCheckingData.remaining });
    }
    if (finalCheckingData && finalCheckingData.remaining > 0) {
      floorsWithWork.push({ floor: 'Final Checking', remaining: finalCheckingData.remaining });
    }
    
    if (floorsWithWork.length > 0) {
      // Choose the floor with the most remaining work
      floorsWithWork.sort((a, b) => b.remaining - a.remaining);
      targetFloor = floorsWithWork[0].floor;
    }
    // If no remaining work, but there's received work, choose the floor with more received
    else if ((checkingData && checkingData.received > 0) || 
             (secondaryCheckingData && secondaryCheckingData.received > 0) ||
             (finalCheckingData && finalCheckingData.received > 0)) {
      const floorsWithReceived = [];
      if (checkingData && checkingData.received > 0) {
        floorsWithReceived.push({ floor: 'Checking', received: checkingData.received });
      }
      if (secondaryCheckingData && secondaryCheckingData.received > 0) {
        floorsWithReceived.push({ floor: 'Secondary Checking', received: secondaryCheckingData.received });
      }
      if (finalCheckingData && finalCheckingData.received > 0) {
        floorsWithReceived.push({ floor: 'Final Checking', received: finalCheckingData.received });
      }
      
      if (floorsWithReceived.length > 0) {
        floorsWithReceived.sort((a, b) => b.received - a.received);
        targetFloor = floorsWithReceived[0].floor;
      }
    }
    else {
      throw new ApiError(httpStatus.BAD_REQUEST, 'No quality inspection work available on Checking, Secondary Checking, or Final Checking floors');
    }
  }
  
  // Validate the target floor
  if (targetFloor !== 'Checking' && targetFloor !== 'Secondary Checking' && targetFloor !== 'Final Checking') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Target floor must be either "Checking", "Secondary Checking", or "Final Checking"');
  }

  const previousProgress = article.progress;
  
  // Debug: Log which floor was selected and why
  console.log(`🔍 Quality Inspection: Selected ${targetFloor} floor`);
  console.log(`   Checking: received=${checkingData?.received || 0}, completed=${checkingData?.completed || 0}, remaining=${checkingData?.remaining || 0}`);
  console.log(`   Secondary Checking: received=${secondaryCheckingData?.received || 0}, completed=${secondaryCheckingData?.completed || 0}, remaining=${secondaryCheckingData?.remaining || 0}`);
  console.log(`   Final Checking: received=${finalCheckingData?.received || 0}, completed=${finalCheckingData?.completed || 0}, remaining=${finalCheckingData?.remaining || 0}`);
  
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
    // Debug: Log current quantities before update
    console.log(`📊 Before update: completed=${targetFloorData.completed || 0}, m1=${targetFloorData.m1Quantity || 0}, m2=${targetFloorData.m2Quantity || 0}, m3=${targetFloorData.m3Quantity || 0}, m4=${targetFloorData.m4Quantity || 0}`);
    console.log(`📥 Processing: inspectedQuantity=${inspectionData.inspectedQuantity || 0}, m1=${inspectionData.m1Quantity || 0} (additive), m2=${inspectionData.m2Quantity || 0} (set), m3=${inspectionData.m3Quantity || 0} (set), m4=${inspectionData.m4Quantity || 0} (set)`);
    
    // M1 quantity is additive (represents new completed work)
    // M2, M3, M4 quantities are set directly (represents current inspection results)
    if (inspectionData.m1Quantity !== undefined) {
      targetFloorData.m1Quantity = (targetFloorData.m1Quantity || 0) + inspectionData.m1Quantity;
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
    
    // FIXED: Add to completed quantity based on M1 quantity only (not total inspected quantity)
    // Only M1 quantity should be counted as "completed" work that can be transferred
    if (inspectionData.m1Quantity !== undefined) {
      targetFloorData.completed = (targetFloorData.completed || 0) + inspectionData.m1Quantity;
      // Recalculate remaining quantity (ensure non-negative)
      targetFloorData.remaining = Math.max(0, targetFloorData.received - targetFloorData.completed);
      console.log(`🎯 QUALITY INSPECTION: Added M1 quantity (${inspectionData.m1Quantity}) to completed. Total completed: ${targetFloorData.completed}`);
    }
    
    if (inspectionData.repairStatus !== undefined) {
      targetFloorData.repairStatus = inspectionData.repairStatus;
    }
    if (inspectionData.repairRemarks !== undefined) {
      targetFloorData.repairRemarks = inspectionData.repairRemarks;
    }
    
    // Debug: Log final quantities after update
    console.log(`✅ After update: completed=${targetFloorData.completed || 0}, m1=${targetFloorData.m1Quantity || 0}, m2=${targetFloorData.m2Quantity || 0}, m3=${targetFloorData.m3Quantity || 0}, m4=${targetFloorData.m4Quantity || 0}`);
    console.log(`📊 Remaining: ${targetFloorData.remaining || 0}`);
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
      floor: targetFloor,
      category: 'M2',
      previousQuantity: previousM2,
      newQuantity: targetFloorData?.m2Quantity || 0,
      userId: inspectionData.userId || user?.id || 'system',
      floorSupervisorId: inspectionData.floorSupervisorId || user?.id || 'system',
      remarks: `Added ${inspectionData.m2Quantity} M2 quantity on ${targetFloor}. Previous: ${previousM2}, New total: ${targetFloorData?.m2Quantity || 0}`
    });
  }

  if (inspectionData.m3Quantity && inspectionData.m3Quantity > 0) {
    await createQualityCategoryLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      floor: targetFloor,
      category: 'M3',
      previousQuantity: previousM3,
      newQuantity: targetFloorData?.m3Quantity || 0,
      userId: inspectionData.userId || user?.id || 'system',
      floorSupervisorId: inspectionData.floorSupervisorId || user?.id || 'system',
      remarks: `Added ${inspectionData.m3Quantity} M3 quantity on ${targetFloor}. Previous: ${previousM3}, New total: ${targetFloorData?.m3Quantity || 0}`
    });
  }

  if (inspectionData.m4Quantity && inspectionData.m4Quantity > 0) {
    await createQualityCategoryLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      floor: targetFloor,
      category: 'M4',
      previousQuantity: previousM4,
      newQuantity: targetFloorData?.m4Quantity || 0,
      userId: inspectionData.userId || user?.id || 'system',
      floorSupervisorId: inspectionData.floorSupervisorId || user?.id || 'system',
      remarks: `Added ${inspectionData.m4Quantity} M4 quantity on ${targetFloor}. Previous: ${previousM4}, New total: ${targetFloorData?.m4Quantity || 0}`
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
  if ((targetFloor === 'Checking' || targetFloor === 'Secondary Checking' || targetFloor === 'Final Checking') && inspectionData.m1Quantity > 0) {
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
  const nextFloor = await getNextFloor(article, article.currentFloor);
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
  const nextFloor = await getNextFloor(article, sourceFloor);
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