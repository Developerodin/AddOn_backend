import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnBox, YarnCatalog, YarnTransaction, YarnInventory, YarnCone } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import { activeYarnBoxMatch, activeYarnConeMatch } from './yarnStockActiveFilters.js';
import * as yarnTransactionService from './yarnTransaction.service.js';
import { syncBoxLtRemainingFromCones } from './yarnBoxLtRemaining.sync.js';
import {
  isLtLocation,
  isStLocation,
  isValidStorageLocationPattern,
  requireActiveStorageSlot,
  resolveZone,
} from './storageLocation.helper.js';

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
 * @param {string} transferData.toStorageLocation - Target storage location (legacy LT-/ST- or B7-* slot barcode)
 * @param {Date} transferData.transferDate - Transfer date (optional, defaults to now)
 * @returns {Promise<Object>} Transfer result with updated boxes and transaction
 */
export const transferBoxes = async (transferData) => {
  const { boxIds, transferDate } = transferData;
  const toStorageLocation = String(transferData.toStorageLocation ?? '').trim();

  if (!boxIds || !Array.isArray(boxIds) || boxIds.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'boxIds array is required with at least one box ID');
  }

  if (!toStorageLocation || !isValidStorageLocationPattern(toStorageLocation)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'toStorageLocation must be a valid LT or ST storage location (LT-*/ST-* or B7-* slot barcode)'
    );
  }

  const destinationSlot = await requireActiveStorageSlot(toStorageLocation);
  const destBarcode = String(destinationSlot.barcode || toStorageLocation).trim();
  const toZone = resolveZone(destBarcode) || destinationSlot.zoneCode;

  // Find all boxes
  const boxes = await YarnBox.find({ boxId: { $in: boxIds }, ...activeYarnBoxMatch });

  if (boxes.length !== boxIds.length) {
    const foundIds = boxes.map(b => b.boxId);
    const missingIds = boxIds.filter(id => !foundIds.includes(id));
    throw new ApiError(httpStatus.NOT_FOUND, `Boxes not found: ${missingIds.join(', ')}`);
  }

  // Validate all boxes have storage locations
  const invalidBoxes = boxes.filter(
    (box) => !box.storageLocation || !isValidStorageLocationPattern(box.storageLocation)
  );
  if (invalidBoxes.length > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Boxes must have valid storage locations: ${invalidBoxes.map(b => b.boxId).join(', ')}`
    );
  }

  const sameLocationBoxes = boxes.filter(
    (box) => String(box.storageLocation).trim() === destBarcode
  );
  if (sameLocationBoxes.length > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Box(es) already at destination ${destBarcode}: ${sameLocationBoxes.map((b) => b.boxId).join(', ')}`
    );
  }

  // Determine transfer type from B7-aware zone resolution
  const isFromLongTerm = boxes.every((box) => isLtLocation(box.storageLocation));
  const isFromShortTerm = boxes.every((box) => isStLocation(box.storageLocation));
  const isToLongTerm = toZone === 'LT' || isLtLocation(destBarcode);
  const isToShortTerm = toZone === 'ST' || isStLocation(destBarcode);

  if (!isFromLongTerm && !isFromShortTerm) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'All boxes in a transfer must be in the same storage zone (LT or ST)'
    );
  }

  let transferType;
  if (isFromLongTerm && isToShortTerm) {
    transferType = 'LT_TO_ST';
  } else if (isFromLongTerm && isToLongTerm) {
    transferType = 'LT_TO_LT';
  } else if (isFromShortTerm && isToShortTerm) {
    transferType = 'ST_TO_ST';
  } else {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Unsupported transfer direction. Use LT→ST, LT→LT, or ST→ST only.'
    );
  }

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
    const fromLocations = new Set();

    for (const box of yarnBoxes) {
      const netWeight = (box.boxWeight || 0) - (box.tearweight || 0);
      totalWeight += box.boxWeight || 0;
      totalNetWeight += netWeight;
      totalTearWeight += box.tearweight || 0;
      totalCones += box.numberOfCones || 0; // Cones are created when boxes are opened/transferred
      fromLocations.add(box.storageLocation);
    }

    const boxIdsForYarn = yarnBoxes.map(b => b.boxId);
    const fromStorageLocation = Array.from(fromLocations).join(',');
    let transaction;

    if (transferType === 'LT_TO_ST') {
      // LT→ST: Boxes are transferred, cones are extracted and stored in ST
      // 1. Create transaction to update inventory (moves from LT to ST)
      // 2. Check if cones exist in ST for these boxes (cones are created separately)
      // 3. If cones exist in ST, remove boxes from LT storage (box is empty, no longer in LT)
      
      // Count actual cones with storage assigned for these boxes (any non-empty coneStorageId)
      const conesInST = await YarnCone.find({
        boxId: { $in: boxIdsForYarn },
        coneStorageId: { $exists: true, $nin: [null, ''] },
        ...activeYarnConeMatch,
      }).lean();
      
      const actualConeCount = conesInST.length;

      // IMPORTANT: For LT→ST, inventory should move by the amount actually extracted into ST (cones),
      // not by the original LT box weight. Otherwise LT will keep showing full weight.
      const movedTotalWeight = conesInST.reduce((sum, c) => sum + (c.coneWeight || 0), 0);
      const movedTearWeight = conesInST.reduce((sum, c) => sum + (c.tearWeight || 0), 0);
      const movedNetWeight = conesInST.reduce((sum, c) => sum + ((c.coneWeight || 0) - (c.tearWeight || 0)), 0);
      
      // LT→ST: Update inventory (moves from longTermInventory to shortTermInventory)
      transaction = await yarnTransactionService.createYarnTransaction({
        yarnCatalogId: yarnCatalog._id.toString(),
        yarnName: yarnCatalog.yarnName,
        transactionType: 'internal_transfer',
        transactionDate: transferDate || new Date(),
        totalWeight: movedTotalWeight,
        totalNetWeight: movedNetWeight,
        totalTearWeight: movedTearWeight,
        numberOfCones: actualConeCount, // Actual number of cones in ST for these boxes
        orderno: boxIdsForYarn.join(','),
        boxIds: boxIdsForYarn,
        fromStorageLocation,
        toStorageLocation: destBarcode,
      });

      // After transaction: update remaining weight in LT and reset only when fully transferred.
      for (const box of yarnBoxes) {
        await syncBoxLtRemainingFromCones(box.boxId, { coneIssueDate: transferDate || new Date() });
      }
    } else {
      // LT→LT or ST→ST: Location change only, no inventory update
      transaction = await YarnTransaction.create({
        yarnCatalogId: yarnCatalog._id,
        yarnName: yarnCatalog.yarnName,
        transactionType: 'internal_transfer',
        transactionDate: transferDate || new Date(),
        transactionTotalWeight: totalWeight,
        transactionNetWeight: totalNetWeight,
        transactionTearWeight: totalTearWeight,
        transactionConeCount: totalCones,
        orderno: boxIdsForYarn.join(','),
        boxIds: boxIdsForYarn,
        fromStorageLocation,
        toStorageLocation: destBarcode,
      });

      for (const box of yarnBoxes) {
        box.storageLocation = destBarcode;
        box.storedStatus = true;
        await box.save();
      }
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
      toStorageLocation: destBarcode,
      transactionId: transaction._id,
    });
  }

  const transferTypeMessages = {
    'LT_TO_ST': `from long-term to short-term`,
    'LT_TO_LT': `from long-term to long-term`,
    'ST_TO_ST': `from short-term to short-term`,
  };

  return {
    message: `Successfully transferred ${boxes.length} box(es) ${transferTypeMessages[transferType]} (${destBarcode})`,
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
  const to = String(transferData.toStorageLocation ?? '').trim();
  if (!to || !isStLocation(to)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'toStorageLocation must be a short-term storage location (ST-* or B7-01-*)'
    );
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
    ...activeYarnBoxMatch,
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
