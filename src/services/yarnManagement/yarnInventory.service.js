import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnInventory, YarnCatalog, YarnBox, YarnCone } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import pick from '../../utils/pick.js';

/**
 * Transform inventory data to include LTS/STS breakdown with blocked weight
 * for frontend consumption.
 */
const transformInventoryForResponse = (inventory) => {
  const lt = inventory.longTermInventory || {};
  const st = inventory.shortTermInventory || {};
  const blocked = inventory.blockedNetWeight || 0;

  // Long-term storage: Only weight (boxes), NO cones
  // Short-term storage: Weight and cones
  // Blocked weight applies to short-term (where yarn is issued from)
  
  return {
    yarn: inventory.yarn,
    yarnId: inventory.yarn?._id || inventory.yarn,
    yarnName: inventory.yarnName,
    longTermStorage: {
      totalWeight: Math.max(0, lt.totalWeight || 0), // Ensure non-negative
      netWeight: Math.max(0, lt.totalNetWeight || 0), // Long-term: weight only, no blocked weight
      numberOfCones: 0, // Long-term storage has boxes, not individual cones
    },
    shortTermStorage: {
      totalWeight: Math.max(0, st.totalWeight || 0), // Ensure non-negative
      netWeight: Math.max(0, (st.totalNetWeight || 0) - blocked), // Short-term: net weight minus blocked
      numberOfCones: Math.max(0, st.numberOfCones || 0), // Ensure non-negative
    },
    inventoryStatus: inventory.inventoryStatus,
    overbooked: inventory.overbooked,
  };
};

/**
 * Recalculate inventory from actual storage data
 * This ensures inventory always matches actual storage
 */
const recalculateInventoryFromStorage = async (inventory) => {
  const toNumber = (value) => Math.max(0, Number(value ?? 0));

  // Recalculate long-term inventory from boxes
  // Use yarn ID if available, otherwise fall back to yarnName
  const ltBoxQuery = {
    storageLocation: { $regex: /^LT-/i },
    storedStatus: true,
    'qcData.status': 'qc_approved',
  };
  
  if (inventory.yarn) {
    // Try to match by yarn reference if boxes have yarn field
    ltBoxQuery.$or = [
      { yarn: inventory.yarn },
      { yarnName: inventory.yarnName },
    ];
  } else {
    ltBoxQuery.yarnName = inventory.yarnName;
  }

  const ltBoxes = await YarnBox.find(ltBoxQuery).lean();

  let ltTotalWeight = 0;
  let ltTotalTearWeight = 0;
  let ltTotalNetWeight = 0;

  for (const box of ltBoxes) {
    const netWeight = (box.boxWeight || 0) - (box.tearweight || 0);
    ltTotalWeight += box.boxWeight || 0;
    ltTotalTearWeight += box.tearweight || 0;
    ltTotalNetWeight += netWeight;
  }

  // Recalculate short-term inventory from available cones
  const stConeQuery = {
    coneStorageId: { $regex: /^ST-/i },
    issueStatus: { $ne: 'issued' },
  };
  
  if (inventory.yarn) {
    stConeQuery.$or = [
      { yarn: inventory.yarn },
      { yarnName: inventory.yarnName },
    ];
  } else {
    stConeQuery.yarnName = inventory.yarnName;
  }

  const stCones = await YarnCone.find(stConeQuery).lean();

  let stTotalWeight = 0;
  let stTotalTearWeight = 0;
  let stTotalNetWeight = 0;
  let stConeCount = 0;

  for (const cone of stCones) {
    const netWeight = (cone.coneWeight || 0) - (cone.tearWeight || 0);
    stTotalWeight += cone.coneWeight || 0;
    stTotalTearWeight += cone.tearWeight || 0;
    stTotalNetWeight += netWeight;
    stConeCount += 1;
  }

  // Update inventory buckets
  if (!inventory.longTermInventory) {
    inventory.longTermInventory = { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 };
  }
  if (!inventory.shortTermInventory) {
    inventory.shortTermInventory = { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 };
  }
  if (!inventory.totalInventory) {
    inventory.totalInventory = { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 };
  }

  const lt = inventory.longTermInventory;
  lt.totalWeight = toNumber(ltTotalWeight);
  lt.totalTearWeight = toNumber(ltTotalTearWeight);
  lt.totalNetWeight = toNumber(ltTotalNetWeight);
  lt.numberOfCones = 0; // Always 0 for LT

  const st = inventory.shortTermInventory;
  st.totalWeight = toNumber(stTotalWeight);
  st.totalTearWeight = toNumber(stTotalTearWeight);
  st.totalNetWeight = toNumber(stTotalNetWeight);
  st.numberOfCones = toNumber(stConeCount);

  // Recalculate total
  const total = inventory.totalInventory;
  total.totalWeight = toNumber(lt.totalWeight) + toNumber(st.totalWeight);
  total.totalTearWeight = toNumber(lt.totalTearWeight) + toNumber(st.totalTearWeight);
  total.totalNetWeight = toNumber(lt.totalNetWeight) + toNumber(st.totalNetWeight);
  total.numberOfCones = toNumber(lt.numberOfCones) + toNumber(st.numberOfCones);

  // Update status if yarn catalog exists
  const yarnCatalog = await YarnCatalog.findById(inventory.yarn);
  if (yarnCatalog) {
    const totalNet = toNumber(total.totalNetWeight);
    const minQty = toNumber(yarnCatalog?.minQuantity);
    if (minQty > 0) {
      if (totalNet <= minQty) {
        inventory.inventoryStatus = 'low_stock';
      } else if (totalNet <= minQty * 1.2) {
        inventory.inventoryStatus = 'soon_to_be_low';
      } else {
        inventory.inventoryStatus = 'in_stock';
      }
    }
  }

  await inventory.save();
  return inventory;
};

/**
 * Query yarn inventories with optional filters
 * @param {Object} filters - Filter criteria
 * @param {Object} options - Query options (pagination, sorting)
 * @returns {Promise<Object>} - Paginated inventory results
 */
export const queryYarnInventories = async (filters = {}, options = {}) => {
  const mongooseFilter = {};

  if (filters.yarn_id) {
    mongooseFilter.yarn = filters.yarn_id;
  }

  if (filters.yarn_name) {
    mongooseFilter.yarnName = { $regex: filters.yarn_name, $options: 'i' };
  }

  if (filters.inventory_status) {
    mongooseFilter.inventoryStatus = filters.inventory_status;
  }

  if (typeof filters.overbooked === 'boolean') {
    mongooseFilter.overbooked = filters.overbooked;
  }

  const result = await YarnInventory.paginate(mongooseFilter, options);

  // Recalculate each inventory from actual storage to ensure accuracy
  const recalculatedResults = await Promise.all(
    result.results.map(async (inv) => {
      try {
        const recalculated = await recalculateInventoryFromStorage(inv);
        return recalculated;
      } catch (error) {
        console.error(`Error recalculating inventory for ${inv.yarnName}:`, error.message);
        return inv; // Return original if recalculation fails
      }
    })
  );

  // Transform each inventory item for frontend
  const transformedResults = {
    ...result,
    results: recalculatedResults.map((inv) => transformInventoryForResponse(inv)),
  };

  return transformedResults;
};

/**
 * Create or initialize a yarn inventory record
 * @param {Object} inventoryBody - Inventory data
 * @returns {Promise<YarnInventory>}
 */
export const createYarnInventory = async (inventoryBody) => {
  // Verify yarn catalog exists
  const yarnCatalog = await YarnCatalog.findById(inventoryBody.yarn);
  if (!yarnCatalog) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Referenced yarn catalog entry does not exist');
  }

  // Check if inventory already exists for this yarn
  const existingInventory = await YarnInventory.findOne({ yarn: inventoryBody.yarn });
  if (existingInventory) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Inventory already exists for this yarn. Use update instead.');
  }

  // Ensure yarnName matches catalog
  if (!inventoryBody.yarnName || inventoryBody.yarnName !== yarnCatalog.yarnName) {
    inventoryBody.yarnName = yarnCatalog.yarnName;
  }

  // Recalculate total inventory from long-term and short-term if not provided
  if (!inventoryBody.totalInventory) {
    const lt = inventoryBody.longTermInventory || {};
    const st = inventoryBody.shortTermInventory || {};
    inventoryBody.totalInventory = {
      totalWeight: (lt.totalWeight || 0) + (st.totalWeight || 0),
      totalTearWeight: (lt.totalTearWeight || 0) + (st.totalTearWeight || 0),
      totalNetWeight: (lt.totalNetWeight || 0) + (st.totalNetWeight || 0),
      numberOfCones: (lt.numberOfCones || 0) + (st.numberOfCones || 0),
    };
  }

  const inventory = await YarnInventory.create(inventoryBody);
  return transformInventoryForResponse(inventory);
};

/**
 * Get a single yarn inventory by ID
 * @param {ObjectId} inventoryId
 * @returns {Promise<YarnInventory>}
 */
export const getYarnInventoryById = async (inventoryId) => {
  const inventory = await YarnInventory.findById(inventoryId).populate({
    path: 'yarn',
    select: '_id yarnName yarnType status',
  });

  if (!inventory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn inventory not found');
  }

  // Recalculate from actual storage before returning
  const recalculated = await recalculateInventoryFromStorage(inventory);
  return transformInventoryForResponse(recalculated);
};

/**
 * Get yarn inventory by yarn catalog ID
 * @param {ObjectId} yarnId
 * @returns {Promise<YarnInventory>}
 */
export const getYarnInventoryByYarnId = async (yarnId) => {
  const inventory = await YarnInventory.findOne({ yarn: yarnId }).populate({
    path: 'yarn',
    select: '_id yarnName yarnType status',
  });

  if (!inventory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn inventory not found for this yarn');
  }

  // Recalculate from actual storage before returning
  const recalculated = await recalculateInventoryFromStorage(inventory);
  return transformInventoryForResponse(recalculated);
};

