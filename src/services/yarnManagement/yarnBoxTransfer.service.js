import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnBox, YarnCatalog, YarnTransaction, YarnInventory, YarnCone } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import * as yarnTransactionService from './yarnTransaction.service.js';

/**
 * Transfer boxes between storage locations
 * Handles: LT→ST, LT→LT, ST→ST transfers
 * Updates box storageLocation and creates appropriate transaction logs
 */

const findYarnCatalogByYarnName = async (yarnName) => {
  if (!yarnName) return null;
  
  let catalog = await YarnCatalog.findOne({ 
    yarnName: yarnName.trim(),
    status: { $ne: 'deleted' }
  });
  
  if (catalog) return catalog;
  
  catalog = await YarnCatalog.findOne({ 
    yarnName: { $regex: new RegExp(`^${yarnName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    status: { $ne: 'deleted' }
  });
  
  return catalog;
};

/**
 * Transfer boxes between storage locations
 * Supports: LT→ST (updates inventory), LT→LT (location change only), ST→ST (location change only)
 * @param {Object} transferData - Transfer data
 * @param {Array<string>} transferData.boxIds - Array of box IDs to transfer
 * @param {string} transferData.toStorageLocation - Target storage location (e.g., "ST-S001-F1" or "LT-S002-F1")
 * @param {Date} transferData.transferDate - Transfer date (optional, defaults to now)
 * @returns {Promise<Object>} Transfer result with updated boxes and transaction
 */
export const transferBoxes = async (transferData) => {
  const { boxIds, toStorageLocation, transferDate } = transferData;

  if (!boxIds || !Array.isArray(boxIds) || boxIds.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'boxIds array is required with at least one box ID');
  }

  if (!toStorageLocation || !/^(LT|ST)-/i.test(toStorageLocation)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'toStorageLocation must be a valid storage location (starts with LT- or ST-)');
  }

  // Find all boxes
  const boxes = await YarnBox.find({ boxId: { $in: boxIds } });

  if (boxes.length !== boxIds.length) {
    const foundIds = boxes.map(b => b.boxId);
    const missingIds = boxIds.filter(id => !foundIds.includes(id));
    throw new ApiError(httpStatus.NOT_FOUND, `Boxes not found: ${missingIds.join(', ')}`);
  }

  // Validate all boxes have storage locations
  const invalidBoxes = boxes.filter(box => !box.storageLocation || !/^(LT|ST)-/i.test(box.storageLocation));
  if (invalidBoxes.length > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Boxes must have valid storage locations: ${invalidBoxes.map(b => b.boxId).join(', ')}`
    );
  }

  // Determine transfer type
  const isFromLongTerm = boxes.every(box => /^LT-/i.test(box.storageLocation));
  const isToLongTerm = /^LT-/i.test(toStorageLocation);
  const isToShortTerm = /^ST-/i.test(toStorageLocation);
  
  const transferType = isFromLongTerm && isToShortTerm ? 'LT_TO_ST' : 
                       isFromLongTerm && isToLongTerm ? 'LT_TO_LT' :
                       'ST_TO_ST';

  // Validate all boxes are stored and QC approved
  const notReadyBoxes = boxes.filter(box => !box.storedStatus || box.qcData?.status !== 'qc_approved');
  if (notReadyBoxes.length > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Boxes must be stored and QC approved: ${notReadyBoxes.map(b => b.boxId).join(', ')}`
    );
  }

  // Group boxes by yarn (to create separate transactions per yarn)
  const boxesByYarn = {};
  for (const box of boxes) {
    const yarnName = box.yarnName;
    if (!boxesByYarn[yarnName]) {
      boxesByYarn[yarnName] = [];
    }
    boxesByYarn[yarnName].push(box);
  }

  const transferResults = [];
  const fromLocations = new Set();

  // Process each yarn group
  for (const [yarnName, yarnBoxes] of Object.entries(boxesByYarn)) {
    // Find yarn catalog
    const yarnCatalog = await findYarnCatalogByYarnName(yarnName);
    if (!yarnCatalog) {
      throw new ApiError(httpStatus.NOT_FOUND, `Yarn catalog not found for: ${yarnName}`);
    }

    // Calculate totals for this yarn
    let totalWeight = 0;
    let totalNetWeight = 0;
    let totalTearWeight = 0;
    let totalCones = 0;

    for (const box of yarnBoxes) {
      const netWeight = (box.boxWeight || 0) - (box.tearweight || 0);
      totalWeight += box.boxWeight || 0;
      totalNetWeight += netWeight;
      totalTearWeight += box.tearweight || 0;
      totalCones += box.numberOfCones || 0; // Cones are created when boxes are opened/transferred
      fromLocations.add(box.storageLocation);
    }

    const boxIdsForYarn = yarnBoxes.map(b => b.boxId);
    let transaction;

    if (transferType === 'LT_TO_ST') {
      // LT→ST: Boxes are transferred, cones are extracted and stored in ST
      // 1. Create transaction to update inventory (moves from LT to ST)
      // 2. Check if cones exist in ST for these boxes (cones are created separately)
      // 3. If cones exist in ST, remove boxes from LT storage (box is empty, no longer in LT)
      
      // Count actual cones in ST for these boxes
      const conesInST = await YarnCone.find({
        boxId: { $in: boxIdsForYarn },
        coneStorageId: { $regex: /^ST-/i },
      }).lean();
      
      const actualConeCount = conesInST.length;
      
      // LT→ST: Update inventory (moves from longTermInventory to shortTermInventory)
      transaction = await yarnTransactionService.createYarnTransaction({
        yarn: yarnCatalog._id.toString(),
        yarnName: yarnCatalog.yarnName,
        transactionType: 'internal_transfer',
        transactionDate: transferDate || new Date(),
        totalWeight,
        totalNetWeight,
        totalTearWeight,
        numberOfCones: actualConeCount, // Actual number of cones in ST for these boxes
        orderno: boxIdsForYarn.join(','),
        boxIds: boxIdsForYarn,
        fromStorageLocation: Array.from(fromLocations).join(','),
        toStorageLocation,
      });

      // After transaction: If cones exist in ST for these boxes, remove boxes from LT storage
      // Box is now empty (cones extracted), so it should not be counted in LT inventory
      for (const box of yarnBoxes) {
        const conesForThisBox = await YarnCone.countDocuments({
          boxId: box.boxId,
          coneStorageId: { $regex: /^ST-/i },
        });

        if (conesForThisBox > 0) {
          // Cones exist in ST for this box - box is empty, remove from LT storage
          box.storageLocation = null; // Box is no longer in storage
          box.storedStatus = false; // Box is not stored anymore (empty)
          box.coneData = {
            ...box.coneData,
            conesIssued: true,
            numberOfCones: conesForThisBox,
            coneIssueDate: transferDate || new Date(),
          };
          await box.save();
        } else {
          // No cones in ST yet - box is still in LT (waiting for cones to be created)
          // Keep box in LT until cones are created
          box.storageLocation = box.storageLocation; // Keep original LT location
          await box.save();
        }
      }
    } else {
      // LT→LT or ST→ST: Location change only, no inventory update
      // Create transaction record directly without updating inventory
      transaction = await YarnTransaction.create({
        yarn: yarnCatalog._id,
        yarnName: yarnCatalog.yarnName,
        transactionType: 'internal_transfer', // Use same type but won't affect inventory
        transactionDate: transferDate || new Date(),
        transactionTotalWeight: totalWeight,
        transactionNetWeight: totalNetWeight,
        transactionTearWeight: totalTearWeight,
        transactionConeCount: totalCones,
        orderno: boxIdsForYarn.join(','),
        boxIds: boxIdsForYarn,
        fromStorageLocation: Array.from(fromLocations).join(','),
        toStorageLocation,
      });
    }

    transferResults.push({
      yarnName,
      yarnId: yarnCatalog._id,
      boxIds: boxIdsForYarn,
      boxesTransferred: yarnBoxes.length,
      totalWeight,
      totalNetWeight,
      totalCones,
      fromLocations: Array.from(fromLocations),
      toStorageLocation,
      transactionId: transaction._id,
    });
  }

  const transferTypeMessages = {
    'LT_TO_ST': `from long-term to short-term`,
    'LT_TO_LT': `from long-term to long-term`,
    'ST_TO_ST': `from short-term to short-term`,
  };

  return {
    message: `Successfully transferred ${boxes.length} box(es) ${transferTypeMessages[transferType]} (${toStorageLocation})`,
    transferType,
    boxesTransferred: boxes.length,
    results: transferResults,
  };
};

/**
 * Transfer boxes from long-term to short-term storage (legacy function for backward compatibility)
 * @deprecated Use transferBoxes instead
 */
export const transferBoxesToShortTerm = async (transferData) => {
  // Validate it's actually LT→ST
  if (!transferData.toStorageLocation || !/^ST-/i.test(transferData.toStorageLocation)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'toStorageLocation must be a short-term storage location (starts with ST-)');
  }
  return transferBoxes(transferData);
};

/**
 * Get storage location history (what's remaining on each rack)
 * @param {string} storageLocation - Storage location barcode (e.g., "LT-S001-F1")
 * @returns {Promise<Object>} Storage location details with remaining inventory
 */
export const getStorageLocationHistory = async (storageLocation) => {
  if (!storageLocation) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'storageLocation is required');
  }

  // Get all boxes currently in this location
  const boxes = await YarnBox.find({
    storageLocation,
    storedStatus: true,
  }).lean();

  // Group by yarn
  const yarnSummary = {};
  let totalWeight = 0;
  let totalBoxes = 0;

  for (const box of boxes) {
    const yarnName = box.yarnName;
    if (!yarnSummary[yarnName]) {
      yarnSummary[yarnName] = {
        yarnName,
        boxes: [],
        totalWeight: 0,
        totalNetWeight: 0,
        boxCount: 0,
      };
    }

    const netWeight = (box.boxWeight || 0) - (box.tearweight || 0);
    yarnSummary[yarnName].boxes.push({
      boxId: box.boxId,
      boxWeight: box.boxWeight,
      netWeight,
      numberOfCones: box.numberOfCones,
      receivedDate: box.receivedDate,
    });
    yarnSummary[yarnName].totalWeight += box.boxWeight || 0;
    yarnSummary[yarnName].totalNetWeight += netWeight;
    yarnSummary[yarnName].boxCount += 1;

    totalWeight += box.boxWeight || 0;
    totalBoxes += 1;
  }

  // Get transfer history for this location (all transfers involving this location)
  // Check if location appears in fromStorageLocation (exact match or in comma-separated list)
  // or in toStorageLocation (exact match)
  const transferHistory = await YarnTransaction.find({
    $or: [
      { fromStorageLocation: storageLocation }, // Exact match
      { toStorageLocation: storageLocation }, // Exact match
      { fromStorageLocation: { $regex: new RegExp(`(^|,)\\s*${storageLocation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(,|$)`, 'i') } }, // In comma-separated list
    ],
    transactionType: { $in: ['internal_transfer', 'yarn_stocked'] },
    $or: [
      { boxIds: { $exists: true, $ne: [] } }, // Has box IDs
      { fromStorageLocation: { $exists: true } }, // Has from location
      { toStorageLocation: { $exists: true } }, // Has to location
    ],
  })
    .sort({ transactionDate: -1 })
    .limit(50)
    .lean();

  return {
    storageLocation,
    currentInventory: {
      totalBoxes,
      totalWeight,
      yarns: Object.values(yarnSummary),
    },
    transferHistory: transferHistory.map(tx => ({
      transactionType: tx.transactionType,
      transactionDate: tx.transactionDate,
      yarnName: tx.yarnName,
      weight: tx.transactionNetWeight,
      boxIds: tx.boxIds || [],
      fromLocation: tx.fromStorageLocation,
      toLocation: tx.toStorageLocation,
    })),
  };
};
