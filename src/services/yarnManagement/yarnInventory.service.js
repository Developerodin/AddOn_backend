import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnInventory, YarnCatalog, YarnBox, YarnCone, StorageSlot } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import pick from '../../utils/pick.js';
import { pickYarnCatalogId } from '../../utils/yarnCatalogRef.js';
import { STORAGE_ZONES, ST_SECTION_CODE, LT_SECTION_CODES } from '../../models/storageManagement/storageSlot.model.js';

/** LT: legacy LT-* OR slot barcodes B7-02-, B7-03-, B7-04-, B7-05- (from StorageSlot) */
const LT_STORAGE_REGEX = { $regex: new RegExp(`^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`, 'i') };
/** ST: legacy ST-* OR slot barcode B7-01- (from StorageSlot) */
const ST_STORAGE_REGEX = { $regex: new RegExp(`^(ST-|${ST_SECTION_CODE}-)`, 'i') };

/** storageLocation/coneStorageId must exist and not be empty - do not count items without location */
const HAS_STORAGE_LOCATION = { $exists: true, $nin: [null, ''] };

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
  
  const catalogRef = inventory.yarnCatalogId ?? inventory.yarn;
  const yarnId = catalogRef?._id || catalogRef || inventory.yarnId;
  return {
    yarnCatalogId: catalogRef,
    /** @deprecated API alias — same as yarnCatalogId */
    yarn: catalogRef,
    yarnId,
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
  const yarnId = inventory.yarnCatalogId?._id || inventory.yarnCatalogId;
  const stConeQuery = {
    coneStorageId: { $exists: true, $nin: [null, ''] },
    issueStatus: { $ne: 'issued' },
  };
  if (yarnId) {
    stConeQuery.$or = [{ yarnCatalogId: yarnId }, { yarnName: inventory.yarnName }];
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
  const yarnCatalog = await YarnCatalog.findById(inventory.yarnCatalogId);
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
    $or: [{ yarnCatalogId: yarnId }, { yarnName }],
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
  const inventory = await YarnInventory.findOne({ yarnCatalogId: yarnId }).lean();
  const blockedNetWeight = Math.max(0, Number(inventory?.blockedNetWeight ?? 0));

  return { totalNetWeight, blockedNetWeight };
};

/**
 * Aggregate inventory directly from storage (LT/ST zones).
 * Only counts boxes/cones with non-empty storageLocation/coneStorageId.
 * Uses actual slot barcodes from StorageSlot to be aligned with storage API.
 * @param {Object} filters - Optional yarn_name filter
 * @returns {Promise<Map<string, Object>>} - Map of yarnName -> { lt, st, yarnId?, inventoryStatus }
 */
const aggregateInventoryFromStorage = async (filters = {}) => {
  const toNum = (v) => Math.max(0, Number(v ?? 0));

  // Get slot barcodes for LT and ST zones (same as storage API)
  const [ltSlots, stSlots] = await Promise.all([
    StorageSlot.find({ zoneCode: STORAGE_ZONES.LONG_TERM, isActive: true }).select('barcode label').lean(),
    StorageSlot.find({ zoneCode: STORAGE_ZONES.SHORT_TERM, isActive: true }).select('barcode label').lean(),
  ]);
  const ltBarcodes = ltSlots.map((s) => s.barcode || s.label).filter(Boolean);
  const stBarcodes = stSlots.map((s) => s.barcode || s.label).filter(Boolean);

  // LT: boxes with storageLocation in LT slots AND non-empty
  const ltBoxQuery = {
    storageLocation: { $in: ltBarcodes },
    storedStatus: true,
  };
  if (filters.yarn_name) {
    ltBoxQuery.yarnName = { $regex: filters.yarn_name, $options: 'i' };
  }

  // Exclude boxes fully transferred to cones (same logic as storage slots service)
  const ltBoxes = await YarnBox.find(ltBoxQuery).lean();
  const boxIds = ltBoxes.map((b) => b.boxId);
  const conesInSTByBox = await YarnCone.aggregate([
    {
      $match: {
        boxId: { $in: boxIds },
        coneStorageId: HAS_STORAGE_LOCATION,
      },
    },
    { $group: { _id: '$boxId', totalConeWeight: { $sum: '$coneWeight' } } },
  ]);
  const coneWeightByBox = new Map(conesInSTByBox.map((x) => [x._id, x.totalConeWeight || 0]));

  const ltByYarn = new Map();
  for (const box of ltBoxes) {
    const boxWeight = box.boxWeight || 0;
    const coneWeightInST = coneWeightByBox.get(box.boxId) || 0;
    const fullyTransferred = boxWeight > 0 && coneWeightInST >= boxWeight - 0.001;
    if (fullyTransferred) continue;

    const yarnName = (box.yarnName || 'Unknown').trim();
    if (!ltByYarn.has(yarnName)) {
      ltByYarn.set(yarnName, { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0 });
    }
    const r = ltByYarn.get(yarnName);
    const tear = toNum(box.tearweight);
    const net = Math.max(0, toNum(box.boxWeight) - tear);
    r.totalWeight += toNum(box.boxWeight);
    r.totalTearWeight += tear;
    r.totalNetWeight += net;
  }

  // ST: cones with coneStorageId in ST slots AND non-empty
  const stConeQuery = {
    coneStorageId: { $in: stBarcodes },
    $or: [{ issueStatus: 'not_issued' }, { returnStatus: 'returned' }],
  };
  if (filters.yarn_name) {
    stConeQuery.yarnName = { $regex: filters.yarn_name, $options: 'i' };
  }

  const stCones = await YarnCone.find(stConeQuery).lean();
  const boxIdsWithCones = new Set(stCones.map((c) => c.boxId).filter(Boolean));

  // ST: unopened boxes (no cones from them yet) with storageLocation in ST slots
  const stBoxQuery = {
    storageLocation: { $in: stBarcodes },
    storedStatus: true,
    boxId: { $nin: Array.from(boxIdsWithCones) },
  };
  if (filters.yarn_name) {
    stBoxQuery.yarnName = { $regex: filters.yarn_name, $options: 'i' };
  }

  const stBoxes = await YarnBox.find(stBoxQuery).lean();

  const stByYarn = new Map();
  for (const cone of stCones) {
    const yarnName = (cone.yarnName || 'Unknown').trim();
    if (!stByYarn.has(yarnName)) {
      stByYarn.set(yarnName, { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 });
    }
    const r = stByYarn.get(yarnName);
    const tear = toNum(cone.tearWeight);
    const net = Math.max(0, toNum(cone.coneWeight) - tear);
    r.totalWeight += toNum(cone.coneWeight);
    r.totalTearWeight += tear;
    r.totalNetWeight += net;
    r.numberOfCones += 1;
  }
  for (const box of stBoxes) {
    const yarnName = (box.yarnName || 'Unknown').trim();
    if (!stByYarn.has(yarnName)) {
      stByYarn.set(yarnName, { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 });
    }
    const r = stByYarn.get(yarnName);
    const tear = toNum(box.tearweight);
    const net = Math.max(0, toNum(box.boxWeight) - tear);
    r.totalWeight += toNum(box.boxWeight);
    r.totalTearWeight += tear;
    r.totalNetWeight += net;
  }

  // Merge and resolve yarnId, inventoryStatus from YarnCatalog
  const allYarnNames = new Set([...ltByYarn.keys(), ...stByYarn.keys()]);
  const catalogs = await YarnCatalog.find({ yarnName: { $in: Array.from(allYarnNames) } }).lean();
  const catalogByName = new Map(catalogs.map((c) => [c.yarnName, c]));

  const catalogIds = catalogs.map((c) => c._id).filter(Boolean);
  const inventoryRows =
    catalogIds.length > 0
      ? await YarnInventory.find({ yarnCatalogId: { $in: catalogIds } }).lean()
      : [];
  /** One lookup per catalog — avoids N sequential findOne calls (major latency on large yarn sets). */
  const inventoryByCatalogId = new Map(inventoryRows.map((inv) => [String(inv.yarnCatalogId), inv]));

  const inventoryMap = new Map();
  for (const yarnName of allYarnNames) {
    const lt = ltByYarn.get(yarnName) || { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0 };
    const st = stByYarn.get(yarnName) || { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 };
    const catalog = catalogByName.get(yarnName);
    const totalNet = lt.totalNetWeight + st.totalNetWeight;
    let inventoryStatus = 'in_stock';
    if (catalog?.minQuantity) {
      const minQty = toNum(catalog.minQuantity);
      if (totalNet <= minQty) inventoryStatus = 'low_stock';
      else if (totalNet <= minQty * 1.2) inventoryStatus = 'soon_to_be_low';
    }
    const inventory = catalog?._id ? inventoryByCatalogId.get(String(catalog._id)) : undefined;
    const blocked = toNum(inventory?.blockedNetWeight ?? 0);

    inventoryMap.set(yarnName, {
      yarnId: catalog?._id,
      yarnName,
      longTermInventory: { totalWeight: lt.totalWeight, totalTearWeight: lt.totalTearWeight, totalNetWeight: lt.totalNetWeight, numberOfCones: 0 },
      shortTermInventory: { totalWeight: st.totalWeight, totalTearWeight: st.totalTearWeight, totalNetWeight: st.totalNetWeight, numberOfCones: st.numberOfCones || 0 },
      blockedNetWeight: blocked,
      inventoryStatus,
      overbooked: inventory?.overbooked ?? false,
    });
  }

  return inventoryMap;
};

/**
 * Query yarn inventories - computed from storage only (LT/ST zones).
 * Only counts boxes/cones with non-empty storageLocation/coneStorageId.
 * @param {Object} filters - Filter criteria
 * @param {Object} options - Query options (pagination, sorting)
 * @returns {Promise<Object>} - Paginated inventory results
 */
export const queryYarnInventories = async (filters = {}, options = {}) => {
  const limit = Math.min(Math.max(1, Number(options.limit) || 100000), 100000);
  const page = Math.max(1, Number(options.page) || 1);
  const skip = (page - 1) * limit;

  const inventoryMap = await aggregateInventoryFromStorage(filters);

  // Convert to array and apply filters
  let results = Array.from(inventoryMap.values());

  if (filters.yarn_id) {
    results = results.filter((r) => r.yarnId && r.yarnId.toString() === filters.yarn_id.toString());
  }
  if (filters.inventory_status) {
    results = results.filter((r) => r.inventoryStatus === filters.inventory_status);
  }
  if (typeof filters.overbooked === 'boolean') {
    results = results.filter((r) => r.overbooked === filters.overbooked);
  }

  const totalResults = results.length;

  // Sort by yarnName
  results.sort((a, b) => (a.yarnName || '').localeCompare(b.yarnName || ''));
  const paginatedResults = results.slice(skip, skip + limit);

  const transformed = paginatedResults.map((inv) => transformInventoryForResponse(inv));

  // Summary: totals from FULL dataset; yarnWise from paginated page
  let totalLongTermKg = 0;
  let totalShortTermKg = 0;
  for (const inv of results) {
    const lt = inv.longTermInventory || {};
    const st = inv.shortTermInventory || {};
    const blocked = inv.blockedNetWeight || 0;
    totalLongTermKg += Math.max(0, (lt.totalNetWeight || 0));
    totalShortTermKg += Math.max(0, (st.totalNetWeight || 0) - blocked);
  }
  const yarnWiseSummary = transformed.map((inv) => {
    const ltKg = Math.max(0, inv.longTermStorage?.netWeight ?? 0);
    const stKg = Math.max(0, inv.shortTermStorage?.netWeight ?? 0);
    return {
      yarnName: inv.yarnName,
      yarnId: inv.yarnId,
      longTermKg: Math.round(ltKg * 1000) / 1000,
      shortTermKg: Math.round(stKg * 1000) / 1000,
      totalKg: Math.round((ltKg + stKg) * 1000) / 1000,
      longTermCones: 0,
      shortTermCones: inv.shortTermStorage?.numberOfCones ?? 0,
      inventoryStatus: inv.inventoryStatus,
    };
  });

  return {
    results: transformed,
    page,
    limit,
    totalPages: Math.ceil(totalResults / limit) || 1,
    totalResults,
    summary: {
      totalLongTermKg: Math.round(totalLongTermKg * 1000) / 1000,
      totalShortTermKg: Math.round(totalShortTermKg * 1000) / 1000,
      totalKg: Math.round((totalLongTermKg + totalShortTermKg) * 1000) / 1000,
      yarnWise: yarnWiseSummary,
    },
  };
};

/**
 * Create or initialize a yarn inventory record
 * @param {Object} inventoryBody - Inventory data
 * @returns {Promise<YarnInventory>}
 */
export const createYarnInventory = async (inventoryBody) => {
  const catalogId = pickYarnCatalogId(inventoryBody);
  if (!catalogId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'yarnCatalogId (or legacy yarn) is required');
  }
  const body = { ...inventoryBody, yarnCatalogId: catalogId };
  const yarnCatalog = await YarnCatalog.findById(body.yarnCatalogId);
  if (!yarnCatalog) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Referenced yarn catalog entry does not exist');
  }

  const existingInventory = await YarnInventory.findOne({ yarnCatalogId: body.yarnCatalogId });
  if (existingInventory) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Inventory already exists for this yarn. Use update instead.');
  }

  // Ensure yarnName matches catalog
  if (!body.yarnName || body.yarnName !== yarnCatalog.yarnName) {
    body.yarnName = yarnCatalog.yarnName;
  }

  if (!body.totalInventory) {
    const lt = body.longTermInventory || {};
    const st = body.shortTermInventory || {};
    body.totalInventory = {
      totalWeight: (lt.totalWeight || 0) + (st.totalWeight || 0),
      totalTearWeight: (lt.totalTearWeight || 0) + (st.totalTearWeight || 0),
      totalNetWeight: (lt.totalNetWeight || 0) + (st.totalNetWeight || 0),
      numberOfCones: (lt.numberOfCones || 0) + (st.numberOfCones || 0),
    };
  }

  const inventory = await YarnInventory.create(body);
  return transformInventoryForResponse(inventory);
};

/**
 * Get a single yarn inventory by ID
 * @param {ObjectId} inventoryId
 * @returns {Promise<YarnInventory>}
 */
export const getYarnInventoryById = async (inventoryId) => {
  const inventory = await YarnInventory.findById(inventoryId).populate({
    path: 'yarnCatalogId',
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
  const inventory = await YarnInventory.findOne({ yarnCatalogId: yarnId }).populate({
    path: 'yarnCatalogId',
    select: '_id yarnName yarnType status',
  });

  if (!inventory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn inventory not found for this yarn');
  }

  // Recalculate from actual storage before returning
  const recalculated = await recalculateInventoryFromStorage(inventory);
  return transformInventoryForResponse(recalculated);
};

