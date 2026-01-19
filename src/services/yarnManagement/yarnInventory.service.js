import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnInventory, YarnCatalog } from '../../models/index.js';
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

  // Transform each inventory item for frontend
  const transformedResults = {
    ...result,
    results: result.results.map((inv) => transformInventoryForResponse(inv)),
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

  return transformInventoryForResponse(inventory);
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

  return transformInventoryForResponse(inventory);
};

