import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnInventory, YarnCatalog, YarnBox, YarnCone } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import pick from '../../utils/pick.js';
import { ST_SECTION_CODE, LT_SECTION_CODES } from '../../models/storageManagement/storageSlot.model.js';

/** LT: legacy LT-* OR slot barcodes B7-02-, B7-03-, B7-04-, B7-05- (from StorageSlot) */
const LT_STORAGE_REGEX = { $regex: new RegExp(`^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`, 'i') };
/** ST: legacy ST-* OR slot barcode B7-01- (from StorageSlot) */
const ST_STORAGE_REGEX = { $regex: new RegExp(`^(ST-|${ST_SECTION_CODE}-)`, 'i') };

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

/** Build yarnName matcher for YarnBox (no yarn field, match by yarnName only) */
const buildBoxYarnMatcher = (inventory) => {
  const name = (inventory.yarnName || '').trim();
  if (!name) return {};
  return { yarnName: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } };
};

/**
 * Recalculate inventory from actual storage data
 * LT = boxes only (weight from boxes in LT storage)
 * ST = cones only (weight/count from cones in ST - avoid double-count with boxes)
 */
const recalculateInventoryFromStorage = async (inventory) => {
  const toNumber = (value) => Math.max(0, Number(value ?? 0));
  const boxYarnMatcher = buildBoxYarnMatcher(inventory);

  // Long-term: boxes only (YarnBox has yarnName, no yarn field)
  const ltBoxQuery = {
    ...boxYarnMatcher,
    storageLocation: LT_STORAGE_REGEX,
    storedStatus: true,
    'qcData.status': 'qc_approved',
  };
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

  // Short-term: cones only (cones data is source of truth; boxes in ST are transition state)
  // Avoid double-count: when cones exist from a box, box weight is zeroed on full transfer
  const yarnId = inventory.yarn?._id || inventory.yarn;
  const stConeQuery = {
    coneStorageId: { $exists: true, $nin: [null, ''] },
    issueStatus: { $ne: 'issued' },
  };
  if (yarnId) {
    stConeQuery.$or = [{ yarn: yarnId }, { yarnName: inventory.yarnName }];
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

  // Unopened boxes in ST (no cones from them yet) - add their weight
  const boxIdsWithCones = new Set(stCones.map((c) => c.boxId).filter(Boolean));
  const stBoxQuery = {
    ...boxYarnMatcher,
    storageLocation: ST_STORAGE_REGEX,
    storedStatus: true,
    'qcData.status': 'qc_approved',
    boxId: { $nin: Array.from(boxIdsWithCones) },
  };
  const stBoxes = await YarnBox.find(stBoxQuery).lean();
  for (const box of stBoxes) {
    const netWeight = (box.boxWeight || 0) - (box.tearweight || 0);
    stTotalWeight += box.boxWeight || 0;
    stTotalTearWeight += box.tearweight || 0;
    stTotalNetWeight += netWeight;
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
 * Compute total net weight and blocked weight from storage (boxes + cones) for a yarn.
 * Used by requisition service to get accurate availableQty without relying on stale YarnInventory.
 * @param {ObjectId} yarnId - Yarn catalog ID
 * @returns {Promise<{ totalNetWeight: number, blockedNetWeight: number }>}
 */
export const computeInventoryFromStorage = async (yarnId) => {
  const yarnCatalog = await YarnCatalog.findById(yarnId).lean();
  if (!yarnCatalog) return { totalNetWeight: 0, blockedNetWeight: 0 };

  const yarnName = yarnCatalog.yarnName || '';
  const boxYarnMatcher = yarnName.trim()
    ? { yarnName: { $regex: new RegExp(`^${yarnName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
    : {};

  // LT: boxes only
  const ltBoxes = await YarnBox.find({
    ...boxYarnMatcher,
    storageLocation: LT_STORAGE_REGEX,
    storedStatus: true,
    'qcData.status': 'qc_approved',
  }).lean();
  let ltNet = 0;
  for (const b of ltBoxes) {
    ltNet += Math.max(0, (b.boxWeight || 0) - (b.tearweight || 0));
  }

  // ST: cones only
  const stCones = await YarnCone.find({
    $or: [{ yarn: yarnId }, { yarnName }],
    coneStorageId: { $exists: true, $nin: [null, ''] },
    issueStatus: { $ne: 'issued' },
  }).lean();
  let stNet = 0;
  for (const c of stCones) {
    stNet += Math.max(0, (c.coneWeight || 0) - (c.tearWeight || 0));
  }

  // Unopened boxes in ST
  const boxIdsWithCones = new Set(stCones.map((c) => c.boxId).filter(Boolean));
  const stBoxes = await YarnBox.find({
    ...boxYarnMatcher,
    storageLocation: ST_STORAGE_REGEX,
    storedStatus: true,
    'qcData.status': 'qc_approved',
    boxId: { $nin: Array.from(boxIdsWithCones) },
  }).lean();
  for (const b of stBoxes) {
    stNet += Math.max(0, (b.boxWeight || 0) - (b.tearweight || 0));
  }

  const totalNetWeight = ltNet + stNet;
  const inventory = await YarnInventory.findOne({ yarn: yarnId }).lean();
  const blockedNetWeight = Math.max(0, Number(inventory?.blockedNetWeight ?? 0));

  return { totalNetWeight, blockedNetWeight };
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

  // No limit = return entire data (use high limit when limit not specified)
  const paginateOptions = { ...options };
  if (!paginateOptions.limit || paginateOptions.limit <= 0) {
    paginateOptions.limit = 100000;
  }
  const result = await YarnInventory.paginate(mongooseFilter, paginateOptions);

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

