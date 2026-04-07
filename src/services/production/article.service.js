import httpStatus from 'http-status';
import { Article, ArticleLog, ProductionOrder } from '../../models/production/index.js';
import Product from '../../models/product.model.js';
import ApiError from '../../utils/ApiError.js';
import { getFloorOrderByLinkingType, getFloorKey, compareFloors, usesContainerReceive } from '../../utils/productionHelper.js';
import { 
  createQuantityUpdateLog, 
  createTransferLog, 
  createProgressUpdateLog, 
  createRemarksUpdateLog,
  createQualityInspectionLog,
  createQualityCategoryLog,
  createFinalQualityLog
} from '../../utils/loggingHelper.js';
import { createInwardReceivesForWarehouseAccept } from '../whms/inwardReceiveFromWarehouse.helper.js';

/** Floors that support brand/style breakdown via transferItems / transferredData (same shape as Branding → Final Checking). */
const FLOORS_WITH_STYLE_TRANSFER_ITEMS = ['Branding', 'Final Checking', 'Dispatch'];

/**
 * Enrich transferItems that have empty styleCode/brand using receivedData entries,
 * deducting amounts already consumed by prior transfers (transferredData).
 * Prevents the bug where every item gets the same style code from a naive fallback.
 */
const enrichTransferItemsFromReceived = (transferItems, receivedData, transferredData) => {
  const withBreakdown = (receivedData || []).filter(
    (r) => (r.transferred || 0) > 0 && ((r.styleCode || '').trim() || (r.brand || '').trim())
  );
  if (withBreakdown.length === 0) return transferItems;

  // Build per-style budget from receivedData, then subtract already-transferred amounts
  const budget = withBreakdown.map((r) => ({
    remaining: r.transferred || 0,
    styleCode: (r.styleCode || '').trim(),
    brand: (r.brand || '').trim(),
  }));
  for (const td of transferredData || []) {
    const tdStyle = (td.styleCode || '').trim();
    const tdBrand = (td.brand || '').trim();
    let left = td.transferred || 0;
    if (left <= 0 || (!tdStyle && !tdBrand)) continue;
    for (const b of budget) {
      if (left <= 0) break;
      if (b.styleCode === tdStyle && b.brand === tdBrand && b.remaining > 0) {
        const take = Math.min(b.remaining, left);
        b.remaining -= take;
        left -= take;
      }
    }
  }

  return transferItems.map((item) => {
    if ((item.styleCode || '').trim() || (item.brand || '').trim()) return item;
    let qty = item.transferred || 0;
    const pieces = [];
    for (const b of budget) {
      if (qty <= 0) break;
      if (b.remaining <= 0) continue;
      const take = Math.min(b.remaining, qty);
      b.remaining -= take;
      qty -= take;
      pieces.push({ transferred: take, styleCode: b.styleCode, brand: b.brand });
    }
    if (pieces.length === 1) return { transferred: pieces[0].transferred, styleCode: pieces[0].styleCode, brand: pieces[0].brand };
    if (pieces.length > 1) return pieces;
    return item;
  }).flat();
};

/**
 * Get article by id.
 * @param {string} articleId - Article _id
 * @returns {Promise<Article|null>}
 */
export const getArticleById = async (articleId) => {
  const article = await Article.findById(articleId)
    .populate('machineId', 'machineCode machineNumber model floor status')
    .populate('orderId', 'orderNumber priority status');
  return article;
};

/**
 * Get processes for an article. Article links to Product via articleNumber = factoryCode.
 * Product has processes array (processId refs). Returns populated process details.
 * @param {string} articleId - Article _id
 * @returns {Promise<{articleNumber: string, processes: Array}>}
 */
export const getArticleProcesses = async (articleId) => {
  const article = await Article.findById(articleId).select('articleNumber');
  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
  }
  const product = await Product.findOne({ factoryCode: article.articleNumber })
    .populate('processes.processId', 'name type description sortOrder status steps');
  if (!product) {
    throw new ApiError(httpStatus.NOT_FOUND, `Product not found for article ${article.articleNumber}`);
  }
  const processes = (product.processes || [])
    .filter((p) => p.processId)
    .map((p) => (typeof p.processId.toJSON === 'function' ? p.processId.toJSON() : p.processId));
  return { articleNumber: article.articleNumber, processes };
};

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

  // Normalize: frontend may send transferredData; backend uses transferItems
  if (!updateData.transferItems && Array.isArray(updateData.transferredData) && updateData.transferredData.length > 0) {
    updateData.transferItems = updateData.transferredData;
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

  // For Branding/Final Checking: if transferItems sent but no completedQuantity, infer from transferItems sum
  // Case 1: floor has no completed work yet → complete + transfer in one go
  // Case 2: transferable (completed-transferred) < transferItems sum but remaining >= sum → complete remaining + transfer
  const floorKeyForCheck = article.getFloorKey(normalizedFloor);
  const floorDataForCheck = article.floorQuantities?.[floorKeyForCheck];
  const currentCompleted = floorDataForCheck?.completed || 0;
  const currentTransferred = floorDataForCheck?.transferred || 0;
  const received = floorDataForCheck?.received || 0;
  const remaining = received - currentCompleted;
  const transferable = currentCompleted - currentTransferred;
  if (FLOORS_WITH_STYLE_TRANSFER_ITEMS.includes(normalizedFloor)
      && updateData.completedQuantity === undefined
      && Array.isArray(updateData.transferItems) && updateData.transferItems.length > 0) {
    const sum = updateData.transferItems.reduce((s, i) => s + (i.transferred || 0), 0);
    if (sum > 0 && (currentCompleted === 0 || (transferable < sum && remaining >= sum))) {
      updateData.completedQuantity = sum;
    }
  }

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
    // For knitting: remaining = received - completed - m4
    if (normalizedFloor === 'Knitting') {
      const m4ForRemaining = updateData.m4Quantity !== undefined ? updateData.m4Quantity : (floorData.m4Quantity || 0);
      floorData.remaining = Math.max(0, (floorData.received || 0) - newCompletedQuantity - m4ForRemaining);
    } else {
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
  
  // Update knitting floor m4Quantity (defect quantity) and weight - replace existing values
  if (normalizedFloor === 'Knitting') {
    const knittingFloorData = article.floorQuantities.knitting;
    if (knittingFloorData) {
      if (updateData.m4Quantity !== undefined) knittingFloorData.m4Quantity = updateData.m4Quantity;
      if (updateData.weight !== undefined) knittingFloorData.weight = updateData.weight;
      // remaining = received - completed - m4
      knittingFloorData.remaining = Math.max(0, (knittingFloorData.received || 0) - (knittingFloorData.completed || 0) - (knittingFloorData.m4Quantity || 0));
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
      // Floor complete when all work done; remaining (good qty) will be transferred by auto-transfer
      isFloorComplete = currentFloorData && currentFloorData.completed >= currentFloorData.received;
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
  // For Branding/Final Checking with transferItems: use transferItems sum as quantity (supports partial transfer)
  // Otherwise: auto-transfer all (completed - transferred)
  const alreadyTransferred = floorData?.transferred || 0;
  const totalCompleted = floorData?.completed || 0;
  const maxTransferable = totalCompleted - alreadyTransferred;

  const hasTransferItems = Array.isArray(updateData?.transferItems) && updateData.transferItems.length > 0;
  const isTransferFloor = FLOORS_WITH_STYLE_TRANSFER_ITEMS.includes(normalizedFloor);

  let transferQuantity = maxTransferable;
  if (hasTransferItems && isTransferFloor) {
    transferQuantity = updateData.transferItems.reduce((s, i) => s + (i.transferred || 0), 0);
    if (transferQuantity <= 0) {
      transferQuantity = maxTransferable;
    } else if (transferQuantity > maxTransferable) {
      const received = floorData?.received || 0;
      const hint = normalizedFloor === 'Final Checking' && received === 0
        ? ' Final Checking has no received work yet. Accept containers from Branding first (scan container barcode to receive).'
        : normalizedFloor === 'Dispatch' && received === 0
          ? ' Dispatch has no received work yet; transfer from Final Checking first.'
          : '';
      throw new ApiError(httpStatus.BAD_REQUEST, `transferItems total (${transferQuantity}) exceeds transferable (${maxTransferable}) on ${normalizedFloor}.${hint}`);
    }
  }

  if (floorData && transferQuantity > 0) {
    if (isTransferFloor) {
      console.log(`Transferring ${transferQuantity} units from ${normalizedFloor} to next floor${hasTransferItems ? ' (brand-wise)' : ''}`);
      await transferCompletedWorkToNextFloor(article, updateData, user, normalizedFloor, transferQuantity);
    } else if (totalCompleted > alreadyTransferred) {
      console.log(`Auto-transferring ${maxTransferable} units from ${normalizedFloor} to next floor`);
      await transferCompletedWorkToNextFloor(article, updateData, user, normalizedFloor);
    }
  }

  // M1 transfer for Checking floors (exclude Branding/Final Checking when we already did transfer above)
  if ((normalizedFloor === 'Checking' || normalizedFloor === 'Secondary Checking') && floorData?.m1Quantity > 0) {
    const totalM1Quantity = floorData.m1Quantity || 0;
    const transferredM1Quantity = floorData.m1Transferred || 0;
    const remainingM1Quantity = totalM1Quantity - transferredM1Quantity;
    if (remainingM1Quantity > 0) {
      console.log(`Auto-transferring remaining M1 quantity: ${remainingM1Quantity} from ${normalizedFloor}`);
      await transferM1ToNextFloor(article, remainingM1Quantity, user, updateData, normalizedFloor);
    }
  }
  
  // DISABLED: Check if there's remaining work on other previous floors that needs to be transferred
  // This function was causing conflicts and double-counting issues
  await checkAndTransferPreviousFloorWork(article, updateData, user, normalizedFloor);

  // Return fresh article from DB so transfer/transferredData changes are persisted and visible
  const updated = await Article.findById(article._id)
    .populate('machineId', 'machineCode machineNumber model floor status capacityPerShift capacityPerDay assignedSupervisor');
  return updated || article;
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
    'Dispatch',
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
  
  const alreadyTransferred = fromFloorData.transferred || 0;
  const totalCompleted = fromFloorData.completed || 0;
  const newTransferQuantity = totalCompleted - alreadyTransferred;

  if (newTransferQuantity <= 0) {
    console.log(`No new work to transfer from ${fromFloor}: completed=${totalCompleted}, transferred=${alreadyTransferred}`);
    return;
  }

  console.log(`Transferring ${newTransferQuantity} from ${fromFloor}: completed=${totalCompleted}, transferred=${alreadyTransferred}`);

  fromFloorData.transferred = totalCompleted;
  if (fromFloor === 'Knitting') {
    fromFloorData.remaining = Math.max(0, (fromFloorData.received || 0) - totalCompleted - (fromFloorData.m4Quantity || 0));
  } else {
    fromFloorData.remaining = fromFloorData.received - totalCompleted;
  }

  const nextFloor = await getNextFloor(article, fromFloor);
  if (!nextFloor) {
    console.log(`No next floor available after ${fromFloor}`);
    return;
  }

  const nextFloorKey = article.getFloorKey(nextFloor);
  const nextFloorData = article.floorQuantities[nextFloorKey];

  if (fromFloor === 'Knitting') {
    nextFloorData.received = (nextFloorData.received || 0) + newTransferQuantity;
  } else {
    nextFloorData.received = fromFloorData.transferred;
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

  // Normalize: frontend may send transferredData; backend uses transferItems
  if (!transferData.transferItems && Array.isArray(transferData.transferredData) && transferData.transferredData.length > 0) {
    transferData.transferItems = transferData.transferredData;
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
  let floorOrder = await article.getFloorOrder();
  const floorIndex = floorOrder.indexOf(normalizedFloor);
  
  if (floorIndex === -1) {
    throw new ApiError(
      httpStatus.BAD_REQUEST, 
      `Floor "${normalizedFloor}" is not in the product's process flow for article ${article.articleNumber}. ` +
      `Expected flow: ${floorOrder.join(' → ')}`
    );
  }
  
  let nextFloor = floorOrder[floorIndex + 1];
  // Fallback: product processes may omit tail floors — use linking-type order
  if (
    !nextFloor &&
    (normalizedFloor === 'Final Checking' ||
      normalizedFloor === 'Branding' ||
      normalizedFloor === 'Dispatch')
  ) {
    floorOrder = getFloorOrderByLinkingType(article.linkingType);
    const idx = floorOrder.indexOf(normalizedFloor);
    nextFloor = idx < floorOrder.length - 1 ? floorOrder[idx + 1] : null;
  }
  if (!nextFloor) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No next floor available');
  }

  const maxTransferable = floorData.completed - (floorData.transferred || 0);
  let transferQuantity;
  const transferItems = transferData.transferItems;

  if (Array.isArray(transferItems) && transferItems.length > 0) {
    if (!FLOORS_WITH_STYLE_TRANSFER_ITEMS.includes(normalizedFloor)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `transferItems is only supported for: ${FLOORS_WITH_STYLE_TRANSFER_ITEMS.join(', ')}`);
    }
    transferQuantity = transferItems.reduce((sum, item) => sum + (item.transferred || 0), 0);
    if (transferQuantity <= 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'transferItems must have at least one item with transferred > 0');
    }
    if (transferQuantity > maxTransferable) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Total transfer quantity (${transferQuantity}) cannot exceed transferable (${maxTransferable})`);
    }
  } else {
    transferQuantity = Math.min(transferData.quantity ?? maxTransferable, maxTransferable);
  }

  if (transferQuantity <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, `No completed work to transfer from ${normalizedFloor} floor`);
  }

  floorData.transferred = (floorData.transferred || 0) + transferQuantity;

  let transferItemsForStore = transferItems;
  if (normalizedFloor === 'Dispatch' && Array.isArray(transferItems) && transferItems.length > 0) {
    transferItemsForStore = enrichTransferItemsFromReceived(
      transferItems, floorData.receivedData, floorData.transferredData
    );
  }

  if (Array.isArray(transferItemsForStore) && transferItemsForStore.length > 0 && FLOORS_WITH_STYLE_TRANSFER_ITEMS.includes(normalizedFloor)) {
    if (!Array.isArray(floorData.transferredData)) {
      floorData.transferredData = [];
    }
    transferItemsForStore.forEach((item) => {
      floorData.transferredData.push({
        transferred: item.transferred,
        styleCode: item.styleCode || '',
        brand: item.brand || ''
      });
    });
  }

  if (normalizedFloor === 'Knitting') {
    floorData.remaining = Math.max(0, (floorData.received || 0) - (floorData.completed || 0) - (floorData.m4Quantity || 0));
  } else {
    floorData.remaining = floorData.received - floorData.transferred;
  }

  const nextFloorKey = article.getFloorKey(nextFloor);
  const nextFloorData = article.floorQuantities[nextFloorKey];
  if (usesContainerReceive(normalizedFloor)) {
    console.log(`🎯 CONTAINER FLOW: ${transferQuantity} units transferred from ${normalizedFloor} - received will update on container accept`);
  } else {
    nextFloorData.received = (nextFloorData.received || 0) + transferQuantity;
    nextFloorData.remaining = nextFloorData.received;
    const items = transferItemsForStore || transferItems;
    if (Array.isArray(items) && items.length > 0 && FLOORS_WITH_STYLE_TRANSFER_ITEMS.includes(normalizedFloor)) {
      const sum = items.reduce((s, i) => s + (i.transferred || 0), 0);
      if (sum === transferQuantity) {
        if (!Array.isArray(nextFloorData.receivedData)) nextFloorData.receivedData = [];
        items.forEach((item) => {
          nextFloorData.receivedData.push({
            receivedStatusFromPreviousFloor: '',
            receivedInContainerId: null,
            receivedTimestamp: new Date(),
            transferred: item.transferred,
            styleCode: item.styleCode || '',
            brand: item.brand || ''
          });
        });
        article.markModified(`floorQuantities.${nextFloorKey}`);
      }
    }
  }
  
  // Update article machineId if provided
  if (transferData.machineId !== undefined) {
    article.machineId = transferData.machineId;
  }

  // Update article current floor to next floor (only if transferring from current floor)
  // For container flow: don't move yet - article moves when container is accepted on receiving floor
  if (article.currentFloor === normalizedFloor && !usesContainerReceive(normalizedFloor)) {
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

  // Update order current floor (only for non-container flow)
  const order = await ProductionOrder.findById(orderId);
  if (order && !usesContainerReceive(normalizedFloor) && article.currentFloor === nextFloor) {
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
 * @param {number} [overrideQuantity] - Optional override for transfer quantity (for Branding/Final Checking/Dispatch partial transfer)
 */
const transferCompletedWorkToNextFloor = async (article, updateData, user = null, fromFloor = null, overrideQuantity = null) => {
  const sourceFloor = fromFloor || article.currentFloor;
  const nextFloor = await getNextFloor(article, sourceFloor);
  if (!nextFloor) return;

  // Get source and next floor keys
  const sourceFloorKey = article.getFloorKey(sourceFloor);
  const nextFloorKey = article.getFloorKey(nextFloor);
  const sourceFloorData = article.floorQuantities[sourceFloorKey];
  const nextFloorData = article.floorQuantities[nextFloorKey];

  const alreadyTransferred = sourceFloorData.transferred || 0;
  const totalCompleted = sourceFloorData.completed || 0;
  const newTransferQuantity = overrideQuantity != null ? overrideQuantity : (totalCompleted - alreadyTransferred);

  if (newTransferQuantity <= 0) {
    console.log(`No new work to transfer from ${sourceFloor}: completed=${totalCompleted}, transferred=${alreadyTransferred}`);
    return;
  }

  console.log(`Transferring ${newTransferQuantity} from ${sourceFloor} to ${nextFloor}: completed=${totalCompleted}, transferred=${alreadyTransferred}`);

  if (overrideQuantity != null && FLOORS_WITH_STYLE_TRANSFER_ITEMS.includes(sourceFloor)) {
    sourceFloorData.transferred = alreadyTransferred + newTransferQuantity;
  } else {
    sourceFloorData.transferred = totalCompleted;
  }

  // Store transferItems in transferredData for Branding/Final Checking (from PATCH updateArticleProgress)
  let transferItems = updateData?.transferItems;
  // Branding: enrich empty styleCode/brand from previous transferredData (same product, use last known)
  if (sourceFloor === 'Branding' && Array.isArray(transferItems) && transferItems.length > 0) {
    const prev = (sourceFloorData.transferredData || []).filter((t) => ((t.styleCode || '').trim() || (t.brand || '').trim()));
    const fallback = prev.length > 0 ? prev[prev.length - 1] : null;
    if (fallback) {
      transferItems = transferItems.map((item) => {
        if ((item.styleCode || '').trim() || (item.brand || '').trim()) return item;
        return { transferred: item.transferred, styleCode: fallback.styleCode || '', brand: fallback.brand || '' };
      });
    }
  }
  // Final Checking / Dispatch: enrich empty styleCode/brand from receivedData, deducting already-transferred amounts
  if ((sourceFloor === 'Final Checking' || sourceFloor === 'Dispatch') && Array.isArray(transferItems) && transferItems.length > 0) {
    transferItems = enrichTransferItemsFromReceived(
      transferItems, sourceFloorData.receivedData, sourceFloorData.transferredData
    );
  }
  if (Array.isArray(transferItems) && transferItems.length > 0 && FLOORS_WITH_STYLE_TRANSFER_ITEMS.includes(sourceFloor)) {
    const itemsSum = transferItems.reduce((s, i) => s + (i.transferred || 0), 0);
    if (itemsSum === newTransferQuantity) {
      const newEntries = transferItems.map((item) => ({
        transferred: item.transferred,
        styleCode: item.styleCode || '',
        brand: item.brand || ''
      }));
      const isPartial = overrideQuantity != null && FLOORS_WITH_STYLE_TRANSFER_ITEMS.includes(sourceFloor);
      if (isPartial && Array.isArray(sourceFloorData.transferredData) && sourceFloorData.transferredData.length > 0) {
        sourceFloorData.transferredData.push(...newEntries);
      } else {
        sourceFloorData.transferredData = newEntries;
      }
      article.markModified(`floorQuantities.${sourceFloorKey}`);
      article.markModified('floorQuantities');
    }
  }

  if (sourceFloor === 'Checking' || sourceFloor === 'Secondary Checking' || sourceFloor === 'Final Checking') {
    if (sourceFloorData.completed < sourceFloorData.transferred) {
      sourceFloorData.completed = sourceFloorData.transferred;
    }
    if (overrideQuantity != null && (sourceFloor === 'Branding' || sourceFloor === 'Final Checking')) {
      sourceFloorData.m1Transferred = (sourceFloorData.m1Transferred || 0) + newTransferQuantity;
      sourceFloorData.m1Remaining = Math.max(0, (sourceFloorData.m1Quantity || 0) - sourceFloorData.m1Transferred);
    }
  }

  if (sourceFloor === 'Knitting') {
    sourceFloorData.remaining = Math.max(0, (sourceFloorData.received || 0) - (sourceFloorData.completed || 0) - (sourceFloorData.m4Quantity || 0));
  } else {
    sourceFloorData.remaining = Math.max(0, sourceFloorData.received - sourceFloorData.transferred);
  }

  if (usesContainerReceive(sourceFloor)) {
    console.log(`🎯 CONTAINER FLOW: ${newTransferQuantity} units transferred from ${sourceFloor} - received will update on container accept`);
  } else {
    nextFloorData.received = sourceFloorData.transferred;
  }
  
  if (!usesContainerReceive(sourceFloor)) {
    nextFloorData.remaining = nextFloorData.received - (nextFloorData.completed || 0);
  }

  if (!usesContainerReceive(sourceFloor) && FLOORS_WITH_STYLE_TRANSFER_ITEMS.includes(sourceFloor)) {
    const items = transferItems;
    if (Array.isArray(items) && items.length > 0) {
      const sum = items.reduce((s, i) => s + (i.transferred || 0), 0);
      if (sum === newTransferQuantity) {
        if (!Array.isArray(nextFloorData.receivedData)) nextFloorData.receivedData = [];
        items.forEach((item) => {
          nextFloorData.receivedData.push({
            receivedStatusFromPreviousFloor: '',
            receivedInContainerId: null,
            receivedTimestamp: new Date(),
            transferred: item.transferred,
            styleCode: item.styleCode || '',
            brand: item.brand || ''
          });
        });
        article.markModified(`floorQuantities.${nextFloorKey}`);
      }
    }
  }

  // Update article current floor to next floor (only if transferring from current floor; container flow: move on accept)
  if (article.currentFloor === sourceFloor && !usesContainerReceive(sourceFloor)) {
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
  } else if (article.currentFloor === sourceFloor) {
    article.quantityFromPreviousFloor = newTransferQuantity;
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
  if (article.currentFloor === 'Knitting') {
    currentFloorData.remaining = Math.max(0, (currentFloorData.received || 0) - (currentFloorData.completed || 0) - (currentFloorData.m4Quantity || 0));
  } else {
    currentFloorData.remaining = 0;
  }
  
  // For checking and finalChecking floors, ensure completed equals transferred
  // This fixes the issue where items are transferred without being marked as completed
  if (article.currentFloor === 'Checking' || article.currentFloor === 'Final Checking') {
    if (currentFloorData.completed < currentFloorData.transferred) {
      currentFloorData.completed = currentFloorData.transferred;
    }
  }
  
  // Update next floor: all floors use container-based receive
  if (usesContainerReceive(article.currentFloor)) {
    console.log(`🎯 CONTAINER FLOW: Auto-transfer from ${article.currentFloor} - received will update on container accept`);
  } else {
    nextFloorData.received = currentFloorData.transferred;
    nextFloorData.remaining = nextFloorData.received - (nextFloorData.completed || 0);
  }

  // Update article (container flow: don't move - article moves when container accepted)
  if (!usesContainerReceive(article.currentFloor)) {
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

    // Update order current floor
    const order = await ProductionOrder.findById(article.orderId);
    if (order) {
      order.currentFloor = nextFloor;
      await order.save();
    }
  } else {
    article.quantityFromPreviousFloor = transferQuantity;
  }

  await article.save();

  // Create transfer log using proper enum value
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
    let next = currentIndex < floorOrder.length - 1 ? floorOrder[currentIndex + 1] : null;
    // Fallback: product may not list tail floors; use linking-type flow
    if (
      !next &&
      (currentFloor === 'Final Checking' || currentFloor === 'Branding' || currentFloor === 'Dispatch')
    ) {
      const fallback = getFloorOrderByLinkingType(article.linkingType);
      const idx = fallback.indexOf(currentFloor);
      next = idx < fallback.length - 1 ? fallback[idx + 1] : null;
    }
    return next;
  } catch (error) {
    console.warn(`Error getting floor order for article ${article.articleNumber}, using fallback: ${error.message}`);
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
    'Warehouse': 'Transferred to Warehouse',
    'Dispatch': 'Transferred to Dispatch'
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

/**
 * Update receivedData for a specific floor on an article.
 * When quantity is provided (container accept flow), also increments floor received by that amount.
 * @param {string} articleId - Article _id
 * @param {{ floor: string, receivedData: { receivedStatusFromPreviousFloor?: string, receivedInContainerId?: string, receivedTimestamp?: Date }, quantity?: number }} payload
 * @returns {Promise<Article>}
 */
export const updateArticleFloorReceivedData = async (articleId, payload) => {
  const article = await Article.findById(articleId);
  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
  }

  const floorMapping = {
    'FinalChecking': 'Final Checking',
    'finalchecking': 'Final Checking',
    'SecondaryChecking': 'Secondary Checking',
    'secondarychecking': 'Secondary Checking',
    'Silicon': 'Silicon',
    'silicon': 'Silicon',
    'Knitting': 'Knitting',
    'Linking': 'Linking',
    'Checking': 'Checking',
    'Washing': 'Washing',
    'Boarding': 'Boarding',
    'Branding': 'Branding',
    'Warehouse': 'Warehouse',
    'Dispatch': 'Dispatch',
  };
  const normalizedFloor = floorMapping[payload.floor] || payload.floor;
  const floorKey = article.getFloorKey(normalizedFloor);

  if (!floorKey || !article.floorQuantities[floorKey]) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Invalid floor: "${payload.floor}". Must be one of: Knitting, Linking, Checking, Washing, Boarding, Silicon, Secondary Checking, Branding, Final Checking, Warehouse, Dispatch.`);
  }

  const floorData = article.floorQuantities[floorKey];
  if (!Array.isArray(floorData.receivedData)) {
    floorData.receivedData = [];
  }

  const receivedDataLengthBefore = floorData.receivedData.length;

  let receivedTransferItems = payload.receivedTransferItems;
  let quantity =
    payload.quantity !== undefined && payload.quantity !== null
      ? Number(payload.quantity)
      : undefined;
  if (quantity !== undefined && Number.isNaN(quantity)) {
    quantity = undefined;
  }

  // Auto-populate receivedTransferItems from previous floor's transferredData (e.g. FC→Dispatch, Dispatch→Warehouse)
  // FIX: subtract quantities already received (from prior container accepts) so each entry is only used once.
  if ((!receivedTransferItems || receivedTransferItems.length === 0) && typeof quantity === 'number' && quantity > 0) {
    const prevFloorMap = {
      'Final Checking': 'branding',
      'Branding': 'secondaryChecking',
      'Dispatch': 'finalChecking',
      'Warehouse': 'dispatch'
    };
    const prevFloorKey = prevFloorMap[normalizedFloor];
    const prevFloorData = prevFloorKey && article.floorQuantities?.[prevFloorKey];
    const prevTransferredData = prevFloorData?.transferredData;
    if (Array.isArray(prevTransferredData) && prevTransferredData.length > 0) {
      const totalAvailable = prevTransferredData.reduce((s, i) => s + (i.transferred || 0), 0);
      if (totalAvailable >= quantity) {
        // Track how much of each transferredData entry has already been consumed by previous receives
        const consumedPerEntry = new Array(prevTransferredData.length).fill(0);
        const existingReceived = floorData.receivedData || [];
        for (const rd of existingReceived) {
          const rdStyle = (rd.styleCode || '').trim();
          const rdBrand = (rd.brand || '').trim();
          let rdRemaining = rd.transferred || 0;
          if (rdRemaining <= 0 || (!rdStyle && !rdBrand)) continue;
          for (let j = 0; j < prevTransferredData.length; j++) {
            if (rdRemaining <= 0) break;
            const td = prevTransferredData[j];
            if ((td.styleCode || '').trim() === rdStyle && (td.brand || '').trim() === rdBrand) {
              const available = (td.transferred || 0) - consumedPerEntry[j];
              const take = Math.min(available, rdRemaining);
              if (take > 0) {
                consumedPerEntry[j] += take;
                rdRemaining -= take;
              }
            }
          }
        }

        // Now allocate from remaining (unconsumed) transferred amounts
        let remaining = quantity;
        const items = [];
        for (let j = 0; j < prevTransferredData.length; j++) {
          if (remaining <= 0) break;
          const td = prevTransferredData[j];
          const available = (td.transferred || 0) - consumedPerEntry[j];
          if (available <= 0) continue;
          const take = Math.min(available, remaining);
          if (take > 0) {
            items.push({ transferred: take, styleCode: td.styleCode || '', brand: td.brand || '' });
            remaining -= take;
          }
        }
        if (items.length > 0 && items.reduce((s, x) => s + x.transferred, 0) === quantity) {
          receivedTransferItems = items;
        }
      }
    }
  }

  if (Array.isArray(receivedTransferItems) && receivedTransferItems.length > 0) {
    // Branding/Final Checking: push each item with styleCode, brand, transferred
    quantity = receivedTransferItems.reduce((sum, item) => sum + (item.transferred || 0), 0);
    const rd = payload.receivedData || {};
    receivedTransferItems.forEach((item) => {
      floorData.receivedData.push({
        receivedStatusFromPreviousFloor: rd.receivedStatusFromPreviousFloor != null ? rd.receivedStatusFromPreviousFloor : '',
        receivedInContainerId: rd.receivedInContainerId || null,
        receivedTimestamp: rd.receivedTimestamp ? new Date(rd.receivedTimestamp) : new Date(),
        transferred: item.transferred,
        styleCode: item.styleCode || '',
        brand: item.brand || ''
      });
    });
  } else {
    const rd = payload.receivedData || {};
    floorData.receivedData.push({
      receivedStatusFromPreviousFloor: rd.receivedStatusFromPreviousFloor != null ? rd.receivedStatusFromPreviousFloor : '',
      receivedInContainerId: rd.receivedInContainerId || null,
      receivedTimestamp: rd.receivedTimestamp ? new Date(rd.receivedTimestamp) : null,
      transferred: quantity || 0,
      styleCode: rd.styleCode || '',
      brand: rd.brand || ''
    });
  }

  // Container accept flow: increment received by container quantity so quantity becomes visible on this floor
  if (typeof quantity === 'number' && quantity > 0) {
    floorData.received = (floorData.received || 0) + quantity;
    floorData.remaining = floorData.received - (floorData.completed || 0);
    if (floorData.completed > floorData.received) {
      floorData.completed = floorData.received;
    }
    // Move article to receiving floor so it shows correctly
    article.currentFloor = normalizedFloor;
    article.markModified('currentFloor');
  }

  article.markModified(`floorQuantities.${floorKey}`);
  await article.save();

  // WHMS: one InwardReceive row per new warehouse receivedData line (container accept / receive API)
  if (normalizedFloor === 'Warehouse' && typeof quantity === 'number' && quantity > 0) {
    const newLines = floorData.receivedData.slice(receivedDataLengthBefore);
    const containerId = payload.receivedData?.receivedInContainerId ?? null;
    try {
      await createInwardReceivesForWarehouseAccept(article, newLines, containerId);
    } catch (err) {
      console.error('createInwardReceivesForWarehouseAccept failed:', err?.message || err);
    }
  }

  // Update order currentFloor when article moves to receiving floor
  if (typeof quantity === 'number' && quantity > 0) {
    const order = await ProductionOrder.findById(article.orderId);
    if (order) {
      order.currentFloor = normalizedFloor;
      await order.save();
    }
  }

  return article;
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
  if (article.currentFloor === 'Knitting') {
    currentFloorData.remaining = Math.max(0, (currentFloorData.received || 0) - (currentFloorData.completed || 0) - (currentFloorData.m4Quantity || 0));
  } else {
    currentFloorData.remaining = 0;
  }
  
  // For checking and finalChecking floors, ensure completed equals transferred
  // This fixes the issue where items are transferred without being marked as completed
  if (article.currentFloor === 'Checking' || article.currentFloor === 'Final Checking') {
    if (currentFloorData.completed < currentFloorData.transferred) {
      currentFloorData.completed = currentFloorData.transferred;
    }
  }

  // Update next floor: all floors use container-based receive
  if (usesContainerReceive(article.currentFloor)) {
    console.log(`🎯 CONTAINER FLOW: Auto-transfer from ${article.currentFloor} - received will update on container accept`);
  } else {
    nextFloorData.received = currentFloorData.transferred;
    nextFloorData.remaining = nextFloorData.received - (nextFloorData.completed || 0);
  }

  // Update article (container flow: don't move - article moves when container accepted)
  if (!usesContainerReceive(article.currentFloor)) {
    article.currentFloor = nextFloor;
    article.status = 'Pending'; // Reset status for new floor
    article.progress = 0; // Reset progress for new floor
    article.quantityFromPreviousFloor = transferQuantity;
    article.startedAt = null;
    article.completedAt = null;

    // Update order current floor
    const order = await ProductionOrder.findById(article.orderId);
    if (order) {
      order.currentFloor = nextFloor;
      await order.save();
    }
  } else {
    article.quantityFromPreviousFloor = transferQuantity;
  }

  await article.save();

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
  
  // Store transferItems in transferredData for Branding/Final Checking
  let transferItems = inspectionData?.transferItems;
  // Auto-populate from receivedData when Final Checking has received with breakdown but no transferItems
  if ((!transferItems || transferItems.length === 0) && sourceFloor === 'Final Checking') {
    const receivedData = sourceFloorData.receivedData || [];
    const entriesWithBreakdown = receivedData.filter((r) => (r.transferred || 0) > 0 && ((r.styleCode || '').trim() || (r.brand || '').trim()));
    if (entriesWithBreakdown.length > 0) {
      const rdSum = entriesWithBreakdown.reduce((s, r) => s + (r.transferred || 0), 0);
      if (rdSum === m1Quantity) {
        transferItems = entriesWithBreakdown.map((r) => ({
          transferred: r.transferred,
          styleCode: r.styleCode || '',
          brand: r.brand || ''
        }));
      }
    }
  }
  if (Array.isArray(transferItems) && transferItems.length > 0 && (sourceFloor === 'Branding' || sourceFloor === 'Final Checking')) {
    const itemsSum = transferItems.reduce((s, i) => s + (i.transferred || 0), 0);
    if (itemsSum === m1Quantity) {
      if (!Array.isArray(sourceFloorData.transferredData)) {
        sourceFloorData.transferredData = [];
      }
      transferItems.forEach((item) => {
        sourceFloorData.transferredData.push({
          transferred: item.transferred,
          styleCode: item.styleCode || '',
          brand: item.brand || ''
        });
      });
    }
  }

  // Update remaining quantity on source floor (received - transferred)
  sourceFloorData.remaining = Math.max(0, sourceFloorData.received - sourceFloorData.transferred);
  
  // Update M1 remaining (how much M1 is left on this floor)
  const currentM1Quantity = sourceFloorData.m1Quantity || 0;
  sourceFloorData.m1Remaining = Math.max(0, currentM1Quantity - newM1Transferred);

  // Checking floors use container-based receive - next floor received only on container accept
  console.log(`🎯 CONTAINER FLOW: ${m1Quantity} M1 units transferred from ${sourceFloor} - received will update on container accept`);

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