import httpStatus from 'http-status';
import { Article, ArticleLog, ProductionOrder } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';

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
  const article = await Article.findOne({ _id: articleId, orderId });
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
  
  const currentFloorIndex = floorOrder.indexOf(article.currentFloor);
  const requestedFloorIndex = floorOrder.indexOf(normalizedFloor);
  
  if (requestedFloorIndex === -1) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Invalid floor: ${floor}`);
  }
  
  if (requestedFloorIndex > currentFloorIndex) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Cannot update work on ${normalizedFloor} floor - article is currently on ${article.currentFloor} floor`);
  }

  const previousProgress = article.progress;
  
  // Get previous floor completed quantity for logging
  const floorKey = article.getFloorKey(normalizedFloor);
  const floorData = article.floorQuantities[floorKey];
  const previousQuantity = floorData?.completed || 0;

  // Update article data
  if (updateData.completedQuantity !== undefined) {
    // Get floor key for the requested floor (not necessarily current floor)
    const floorKey = article.getFloorKey(normalizedFloor);
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
    if (newCompletedQuantity < 0 || newCompletedQuantity > floorData.received) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Invalid completed quantity: must be between 0 and received quantity (${floorData.received}). Calculated total: ${newCompletedQuantity}`);
    }
    
    // Update floor-specific quantities
    const previousFloorCompleted = floorData.completed;
    floorData.completed = newCompletedQuantity;
    floorData.remaining = floorData.received - newCompletedQuantity;
    
    // Update progress based on floor quantities
    article.progress = article.calculatedProgress;
  }

  // Update floor-specific fields
  if (normalizedFloor === 'Final Checking') {
    if (updateData.m1Quantity !== undefined) article.m1Quantity = updateData.m1Quantity;
    if (updateData.m2Quantity !== undefined) article.m2Quantity = updateData.m2Quantity;
    if (updateData.m3Quantity !== undefined) article.m3Quantity = updateData.m3Quantity;
    if (updateData.m4Quantity !== undefined) article.m4Quantity = updateData.m4Quantity;
    if (updateData.repairStatus !== undefined) article.repairStatus = updateData.repairStatus;
    if (updateData.repairRemarks !== undefined) article.repairRemarks = updateData.repairRemarks;
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
  if (currentFloorData && currentFloorData.completed === currentFloorData.received && currentFloorData.remaining === 0) {
    article.status = 'Completed';
    article.completedAt = new Date().toISOString();
  }

  await article.save();

  // Create logs
  if (updateData.completedQuantity !== undefined) {
    const actualNewQuantity = floorData.completed; // This is the final calculated quantity
    const isIncremental = updateData.completedQuantity < previousQuantity;
    
    if (actualNewQuantity !== previousQuantity) {
      await createArticleLog({
        articleId: article._id.toString(),
        orderId: article.orderId.toString(),
        action: 'Quantity Updated',
        quantity: actualNewQuantity - previousQuantity,
        remarks: isIncremental 
          ? `Added ${updateData.completedQuantity} units to ${normalizedFloor} floor (${previousQuantity} + ${updateData.completedQuantity} = ${actualNewQuantity})`
          : `Quantity updated from ${previousQuantity} to ${updateData.completedQuantity} on ${normalizedFloor} floor`,
        previousValue: previousQuantity,
        newValue: actualNewQuantity,
        changeReason: 'Production progress update',
        userId: user?.id || updateData.userId || 'system',
        floorSupervisorId: user?.id || updateData.floorSupervisorId || 'system',
        machineId: updateData.machineId,
        shiftId: updateData.shiftId
      });
    }
  }

  if (article.progress !== previousProgress) {
    await createArticleLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      action: 'Progress Updated',
      quantity: 0,
      remarks: `Progress updated to ${article.progress}%`,
      previousValue: previousProgress,
      newValue: article.progress,
      changeReason: 'Progress calculation',
      userId: user?.id || updateData.userId || 'system',
      floorSupervisorId: user?.id || updateData.floorSupervisorId || 'system'
    });
  }

  if (updateData.remarks) {
    await createArticleLog({
      articleId: article._id.toString(),
      orderId: article.orderId.toString(),
      action: 'Remarks Updated',
      quantity: 0,
      remarks: updateData.remarks,
      userId: user?.id || updateData.userId || 'system',
      floorSupervisorId: user?.id || updateData.floorSupervisorId || 'system'
    });
  }

  // Handle transfers based on which floor was updated
  if (normalizedFloor === article.currentFloor) {
    // If updating current floor, transfer completed work to next floor
    const floorKey = article.getFloorKey(article.currentFloor);
    const floorData = article.floorQuantities[floorKey];
    
    if (floorData && floorData.completed > 0) {
      await transferCompletedWorkToNextFloor(article, updateData, user);
    }
  } else {
    // If updating a previous floor, transfer completed work to current floor
    const updatedFloorKey = article.getFloorKey(normalizedFloor);
    const updatedFloorData = article.floorQuantities[updatedFloorKey];
    
    if (updatedFloorData && updatedFloorData.completed > 0) {
      await transferFromPreviousFloor(article, normalizedFloor, updatedFloorData.completed, updateData, user);
    }
  }
  
  // Check if there's remaining work on other previous floors that needs to be transferred
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
  
  // Check all previous floors for completed work
  for (let i = 0; i < currentIndex; i++) {
    const previousFloor = floorOrder[i];
    
    // Skip the floor that was just updated
    if (previousFloor === excludeFloor) continue;
    
    const previousFloorKey = article.getFloorKey(previousFloor);
    const previousFloorData = article.floorQuantities[previousFloorKey];
    
    if (previousFloorData && previousFloorData.completed > 0) {
      // There's completed work on a previous floor, transfer it
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
    // No new work to transfer
    return;
  }
  
  // Update previous floor: mark additional work as transferred
  fromFloorData.transferred = totalCompleted; // Set transferred to total completed
  fromFloorData.remaining = fromFloorData.received - totalCompleted; // Remaining = received - completed
  
  // Update current floor: mark as received
  const currentFloorKey = article.getFloorKey(article.currentFloor);
  const currentFloorData = article.floorQuantities[currentFloorKey];
  currentFloorData.received += newTransferQuantity;
  currentFloorData.remaining += newTransferQuantity;
  
  await article.save();
  
  // Create transfer log using proper enum value
  const transferAction = getTransferAction(article.currentFloor);
  await createArticleLog({
    articleId: article._id.toString(),
    orderId: article.orderId.toString(),
    action: transferAction,
    quantity: newTransferQuantity,
    fromFloor: fromFloor,
    toFloor: article.currentFloor,
    remarks: `Transferred ${newTransferQuantity} completed units from ${fromFloor} to ${article.currentFloor} (Total completed: ${totalCompleted}, Total transferred: ${fromFloorData.transferred})`,
    previousValue: fromFloor,
    newValue: article.currentFloor,
    changeReason: 'Previous floor work transfer',
    userId: user?.id || updateData.userId || 'system',
    floorSupervisorId: user?.id || updateData.floorSupervisorId || 'system'
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
  const article = await Article.findOne({ _id: articleId, orderId });
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

  if (article.currentFloor !== normalizedFloor) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Article is not on ${normalizedFloor} floor`);
  }

  if (article.status !== 'Completed') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Article must be completed before transfer');
  }

  const nextFloor = getNextFloor(normalizedFloor);
  if (!nextFloor) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No next floor available');
  }

  // Update article
  article.currentFloor = nextFloor;
  article.status = 'Pending';
  article.progress = 0;
  
  // Get completed quantity from current floor for transfer
  const currentFloorKey = article.getFloorKey(normalizedFloor);
  const currentFloorData = article.floorQuantities[currentFloorKey];
  article.quantityFromPreviousFloor = currentFloorData?.completed || 0;
  
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
  const order = await ProductionOrder.findById(orderId);
  if (order) {
    order.currentFloor = nextFloor;
    await order.save();
  }

  // Create transfer log
  await createArticleLog({
    articleId: article._id.toString(),
    orderId: article.orderId.toString(),
    action: `Transferred to ${nextFloor}`,
    quantity: article.quantityFromPreviousFloor,
    fromFloor: normalizedFloor,
    toFloor: nextFloor,
    remarks: transferData.remarks || `Transferred from ${normalizedFloor} to ${nextFloor}`,
    previousValue: normalizedFloor,
    newValue: nextFloor,
    changeReason: 'Floor transfer',
    userId: user?.id || transferData.userId || 'system',
    floorSupervisorId: user?.id || transferData.floorSupervisorId || 'system',
    batchNumber: transferData.batchNumber
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
 */
const transferCompletedWorkToNextFloor = async (article, updateData, user = null) => {
  const nextFloor = getNextFloor(article.currentFloor);
  if (!nextFloor) return;

  // Get current and next floor keys
  const currentFloorKey = article.getFloorKey(article.currentFloor);
  const nextFloorKey = article.getFloorKey(nextFloor);
  const currentFloorData = article.floorQuantities[currentFloorKey];
  const nextFloorData = article.floorQuantities[nextFloorKey];

  // Calculate how much work is already transferred vs completed
  const alreadyTransferred = currentFloorData.transferred || 0;
  const totalCompleted = currentFloorData.completed || 0;
  
  // Only transfer the newly completed work (not already transferred)
  const newTransferQuantity = totalCompleted - alreadyTransferred;
  
  if (newTransferQuantity <= 0) return; // Nothing new to transfer
  
  // Update current floor: mark additional work as transferred
  currentFloorData.transferred = totalCompleted; // Set transferred to total completed
  currentFloorData.remaining = currentFloorData.received - totalCompleted; // Remaining = received - completed
  
  // Update next floor: mark as received
  nextFloorData.received += newTransferQuantity;
  nextFloorData.remaining += newTransferQuantity;

  // Update article current floor to next floor
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

  await article.save();

  // Update order current floor
  const order = await ProductionOrder.findById(article.orderId);
  if (order) {
    order.currentFloor = nextFloor;
    await order.save();
  }

  // Create transfer log using proper enum value
  const transferAction = getTransferAction(nextFloor);
  await createArticleLog({
    articleId: article._id.toString(),
    orderId: article.orderId.toString(),
    action: transferAction,
    quantity: newTransferQuantity,
    fromFloor: article.currentFloor,
    toFloor: nextFloor,
    remarks: `Transferred ${newTransferQuantity} completed units from ${article.currentFloor} to ${nextFloor} (Total completed: ${totalCompleted}, Total transferred: ${currentFloorData.transferred}, Remaining: ${currentFloorData.remaining})`,
    previousValue: article.currentFloor,
    newValue: nextFloor,
    changeReason: 'Continuous flow transfer',
    userId: user?.id || updateData.userId || 'system',
    floorSupervisorId: user?.id || updateData.floorSupervisorId || 'system'
  });
};

/**
 * Auto-transfer article to next floor when completed (legacy - for full completion)
 * @param {Article} article
 * @param {Object} updateData
 */
const autoTransferToNextFloor = async (article, updateData, user = null) => {
  const nextFloor = getNextFloor(article.currentFloor);
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
  
  // Update next floor: mark as received
  nextFloorData.received += transferQuantity;
  nextFloorData.remaining += transferQuantity;

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
  const transferAction = getTransferAction(nextFloor);
  await createArticleLog({
    articleId: article._id.toString(),
    orderId: article.orderId.toString(),
    action: transferAction,
    quantity: transferQuantity,
    fromFloor: article.currentFloor,
    toFloor: nextFloor,
    remarks: `Auto-transferred ${transferQuantity} units from ${article.currentFloor} to ${nextFloor}`,
    previousValue: article.currentFloor,
    newValue: nextFloor,
    changeReason: 'Automatic transfer after floor completion',
    userId: user?.id || updateData.userId || 'system',
    floorSupervisorId: user?.id || updateData.floorSupervisorId || 'system'
  });
};

/**
 * Get next floor in production flow
 * @param {string} currentFloor
 * @returns {string|null}
 */
const getNextFloor = (currentFloor) => {
  const floorSequence = [
    'Knitting',
    'Linking', 
    'Checking',
    'Washing',
    'Boarding',
    'Final Checking',
    'Branding',
    'Warehouse'
  ];

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
 * Create article log helper function
 * @param {Object} logData
 * @returns {Promise<ArticleLog>}
 */
const createArticleLog = async (logData) => {
  const log = new ArticleLog({
    id: `LOG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ...logData,
    date: new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString()
  });
  
  return log.save();
};
