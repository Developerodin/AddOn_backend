import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnInventory, YarnCatalog, YarnBox, YarnCone, StorageSlot } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import pick from '../../utils/pick.js';
import { pickYarnCatalogId } from '../../utils/yarnCatalogRef.js';
import { STORAGE_ZONES, ST_SECTION_CODE, LT_SECTION_CODES } from '../../models/storageManagement/storageSlot.model.js';
import { yarnConeUnavailableIssueStatuses } from '../../models/yarnReq/yarnCone.model.js';

/** LT: legacy LT-* OR slot barcodes B7-02-, B7-03-, B7-04-, B7-05- (from StorageSlot) */
const LT_STORAGE_REGEX = { $regex: new RegExp(`^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`, 'i') };
/** ST: legacy ST-* OR slot barcode B7-01- (from StorageSlot) */
const ST_STORAGE_REGEX = { $regex: new RegExp(`^(ST-|${ST_SECTION_CODE}-)`, 'i') };

/** Cached slot barcodes — refreshed every 5 minutes since slots rarely change */
let _slotBarcodeCache = { lt: null, st: null, expiresAt: 0 };
const SLOT_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * @returns {Promise<{ ltBarcodes: string[], stBarcodes: string[] }>}
 */
const getSlotBarcodes = async () => {
  if (_slotBarcodeCache.lt && Date.now() < _slotBarcodeCache.expiresAt) {
    return { ltBarcodes: _slotBarcodeCache.lt, stBarcodes: _slotBarcodeCache.st };
  }
  const [ltSlots, stSlots] = await Promise.all([
    StorageSlot.find({ zoneCode: STORAGE_ZONES.LONG_TERM, isActive: true }).select('barcode label').lean(),
    StorageSlot.find({ zoneCode: STORAGE_ZONES.SHORT_TERM, isActive: true }).select('barcode label').lean(),
  ]);
  const ltBarcodes = ltSlots.map((s) => s.barcode || s.label).filter(Boolean);
  const stBarcodes = stSlots.map((s) => s.barcode || s.label).filter(Boolean);
  _slotBarcodeCache = { lt: ltBarcodes, st: stBarcodes, expiresAt: Date.now() + SLOT_CACHE_TTL_MS };
  return { ltBarcodes, stBarcodes };
};


/**
 * Transform inventory data to include LTS/STS/Unallocated breakdown with blocked weight
 * for frontend consumption.
 * 
 * Storage Logic:
 * - LT (Long-Term): Boxes in LT storage locations
 * - ST (Short-Term): Cones in ST storage locations only
 * - Unallocated: Boxes without storage location
 * - Blocked: Cones issued for production
 */
const transformInventoryForResponse = (inventory) => {
  const lt = inventory.longTermInventory || {};
  const st = inventory.shortTermInventory || {};
  const unallocated = inventory.unallocatedInventory || {};
  const blockedQty = Math.max(0, inventory.blockedNetWeight || 0);

  const catalogRef = inventory.yarnCatalogId ?? inventory.yarn;
  const yarnId = catalogRef?._id || catalogRef || inventory.yarnId;
  return {
    yarnCatalogId: catalogRef,
    /** @deprecated API alias — same as yarnCatalogId */
    yarn: catalogRef,
    yarnId,
    yarnName: inventory.yarnName,
    longTermStorage: {
      totalWeight: Math.max(0, lt.totalWeight || 0),
      netWeight: Math.max(0, lt.totalNetWeight || 0),
      numberOfCones: 0,
    },
    shortTermStorage: {
      totalWeight: Math.max(0, st.totalWeight || 0),
      netWeight: Math.max(0, st.totalNetWeight || 0),
      numberOfCones: Math.max(0, st.numberOfCones || 0),
    },
    unallocatedStorage: {
      totalWeight: Math.max(0, unallocated.totalWeight || 0),
      netWeight: Math.max(0, unallocated.totalNetWeight || 0),
    },
    blockedQty,
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
    issueStatus: { $nin: yarnConeUnavailableIssueStatuses },
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
 * Uses aggregation pipelines — 3 parallel queries instead of fetching every doc.
 * @param {ObjectId} yarnId - Yarn catalog ID
 * @returns {Promise<{ totalNetWeight: number, blockedNetWeight: number }>}
 */
export const computeInventoryFromStorage = async (yarnId) => {
  const yarnCatalog = await YarnCatalog.findById(yarnId).select('yarnName').lean();
  if (!yarnCatalog) return { totalNetWeight: 0, blockedNetWeight: 0 };

  const yarnName = yarnCatalog.yarnName || '';
  const escapedName = yarnName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRegex = new RegExp(`^${escapedName}$`, 'i');

  const [ltBoxAgg, stConeAgg, inventory] = await Promise.all([
    YarnBox.aggregate([
      { $match: { yarnName: nameRegex, storageLocation: LT_STORAGE_REGEX.$regex, storedStatus: true, 'qcData.status': 'qc_approved' } },
      { $group: { _id: null, netWeight: { $sum: { $subtract: [{ $ifNull: ['$boxWeight', 0] }, { $ifNull: ['$tearweight', 0] }] } } } },
    ]),
    YarnCone.aggregate([
      {
        $match: {
          $or: [{ yarnCatalogId: mongoose.Types.ObjectId.createFromHexString(String(yarnId)) }, { yarnName: nameRegex }],
          coneStorageId: { $exists: true, $nin: [null, ''] },
          issueStatus: { $nin: yarnConeUnavailableIssueStatuses },
        },
      },
      {
        $group: {
          _id: null,
          netWeight: { $sum: { $subtract: [{ $ifNull: ['$coneWeight', 0] }, { $ifNull: ['$tearWeight', 0] }] } },
          boxIds: { $addToSet: '$boxId' },
        },
      },
    ]),
    YarnInventory.findOne({ yarnCatalogId: yarnId }).select('blockedNetWeight').lean(),
  ]);

  const ltNet = Math.max(0, ltBoxAgg[0]?.netWeight || 0);
  let stNet = Math.max(0, stConeAgg[0]?.netWeight || 0);

  // Unopened boxes in ST (no cones from them yet)
  const boxIdsWithCones = stConeAgg[0]?.boxIds?.filter(Boolean) || [];
  if (boxIdsWithCones.length > 0 || stConeAgg.length === 0) {
    const stBoxAgg = await YarnBox.aggregate([
      {
        $match: {
          yarnName: nameRegex,
          storageLocation: ST_STORAGE_REGEX.$regex,
          storedStatus: true,
          'qcData.status': 'qc_approved',
          boxId: { $nin: boxIdsWithCones },
        },
      },
      { $group: { _id: null, netWeight: { $sum: { $subtract: [{ $ifNull: ['$boxWeight', 0] }, { $ifNull: ['$tearweight', 0] }] } } } },
    ]);
    stNet += Math.max(0, stBoxAgg[0]?.netWeight || 0);
  }

  return {
    totalNetWeight: ltNet + stNet,
    blockedNetWeight: Math.max(0, Number(inventory?.blockedNetWeight ?? 0)),
  };
};

/**
 * Aggregate inventory from storage using MongoDB aggregation pipelines.
 * Runs grouping server-side instead of fetching all docs into JS.
 * @param {Object} filters - Optional yarn_name filter
 * @returns {Promise<Map<string, Object>>} - Map of yarnName -> { lt, st, unallocated, blocked, yarnId?, inventoryStatus }
 * 
 * Storage Logic:
 * - LT (Long-Term): Boxes in LT storage locations only
 * - ST (Short-Term): Cones in ST storage locations only (NO boxes)
 * - Unallocated: Boxes without any storage location
 * - Blocked: Cones with issueStatus = 'issued'
 */
const aggregateInventoryFromStorage = async (filters = {}) => {
  const toNum = (v) => Math.max(0, Number(v ?? 0));
  const { ltBarcodes, stBarcodes } = await getSlotBarcodes();

  const yarnNameMatch = filters.yarn_name
    ? { yarnName: { $regex: filters.yarn_name, $options: 'i' } }
    : {};

  // Pre-aggregate cone weights per boxId (used to detect fully-transferred LT boxes)
  const coneWeightByBoxPipeline = [
    { $match: { coneStorageId: { $exists: true, $nin: [null, ''] } } },
    { $group: { _id: '$boxId', totalConeWeight: { $sum: { $ifNull: ['$coneWeight', 0] } } } },
  ];

  // ST: Only cones in ST storage (NOT boxes). Exclude issued/used cones explicitly.
  const stConePipeline = [
    {
      $match: {
        coneStorageId: { $in: stBarcodes },
        issueStatus: { $nin: yarnConeUnavailableIssueStatuses },
        ...yarnNameMatch,
      },
    },
    {
      $group: {
        _id: { $trim: { input: { $ifNull: ['$yarnName', 'Unknown'] } } },
        totalWeight: { $sum: { $ifNull: ['$coneWeight', 0] } },
        totalTearWeight: { $sum: { $ifNull: ['$tearWeight', 0] } },
        totalNetWeight: { $sum: { $subtract: [{ $ifNull: ['$coneWeight', 0] }, { $ifNull: ['$tearWeight', 0] }] } },
        numberOfCones: { $sum: 1 },
      },
    },
  ];

  // Blocked cones: issueStatus = 'issued' (sent out for production, not yet returned)
  const blockedConePipeline = [
    {
      $match: {
        issueStatus: 'issued',
        ...yarnNameMatch,
      },
    },
    {
      $group: {
        _id: { $trim: { input: { $ifNull: ['$yarnName', 'Unknown'] } } },
        blockedWeight: { $sum: { $subtract: [{ $ifNull: ['$coneWeight', 0] }, { $ifNull: ['$tearWeight', 0] }] } },
        blockedCones: { $sum: 1 },
      },
    },
  ];

  // Unallocated boxes: boxes without a storage location.
  // IMPORTANT: these are typically `storedStatus=false` until allocated, so do NOT require storedStatus=true here.
  // Note: boxWeight is treated as net for inventory bucketing in this service.
  const unallocatedBoxPipeline = [
    {
      $match: {
        $or: [
          { storageLocation: { $exists: false } },
          { storageLocation: null },
          { storageLocation: { $in: ['', ' '] } },
          { storageLocation: { $regex: /^\s*$/ } },
        ],
        // Avoid counting placeholder rows without weights.
        boxWeight: { $gt: 0 },
        ...yarnNameMatch,
      },
    },
    {
      $group: {
        _id: { $trim: { input: { $ifNull: ['$yarnName', 'Unknown'] } } },
        totalWeight: { $sum: { $ifNull: ['$boxWeight', 0] } },
        totalNetWeight: { $sum: { $ifNull: ['$boxWeight', 0] } },
      },
    },
  ];

  const ltBoxQuery = { storageLocation: { $in: ltBarcodes }, storedStatus: true, ...yarnNameMatch };

  const [coneWeightAgg, ltBoxes, stConeAgg, blockedConeAgg, unallocatedBoxAgg] = await Promise.all([
    YarnCone.aggregate(coneWeightByBoxPipeline).allowDiskUse(true),
    YarnBox.find(ltBoxQuery).select('boxId yarnName boxWeight tearweight').lean(),
    YarnCone.aggregate(stConePipeline).allowDiskUse(true),
    YarnCone.aggregate(blockedConePipeline).allowDiskUse(true),
    YarnBox.aggregate(unallocatedBoxPipeline).allowDiskUse(true),
  ]);

  const coneWeightByBox = new Map(coneWeightAgg.map((x) => [x._id, x.totalConeWeight || 0]));

  // Map blocked weight by yarnName
  const blockedByYarn = new Map(blockedConeAgg.map((x) => [x._id, { blockedWeight: x.blockedWeight || 0, blockedCones: x.blockedCones || 0 }]));

  // Map unallocated weight by yarnName (boxWeight is already net)
  const unallocatedByYarn = new Map(unallocatedBoxAgg.map((x) => [x._id, { totalWeight: x.totalWeight || 0, totalNetWeight: x.totalNetWeight || 0 }]));

  // LT: group in JS after filtering out fully-transferred boxes (avoids expensive per-row $lookup)
  // Note: boxWeight is already NET weight (tare subtracted at entry), so no subtraction needed
  const ltByYarn = new Map();
  for (const box of ltBoxes) {
    const bw = box.boxWeight || 0;
    const coneW = coneWeightByBox.get(box.boxId) || 0;
    if (bw > 0 && coneW >= bw - 0.001) continue;
    const yarnName = (box.yarnName || 'Unknown').trim();
    if (!ltByYarn.has(yarnName)) ltByYarn.set(yarnName, { totalWeight: 0, totalNetWeight: 0 });
    const r = ltByYarn.get(yarnName);
    r.totalWeight += Math.max(0, bw);
    r.totalNetWeight += Math.max(0, bw);  // boxWeight IS net weight
  }

  // ST: Only cones (no boxes merged)
  const stByYarn = new Map();
  for (const r of stConeAgg) {
    stByYarn.set(r._id, {
      totalWeight: r.totalWeight,
      totalTearWeight: r.totalTearWeight,
      totalNetWeight: r.totalNetWeight,
      numberOfCones: r.numberOfCones,
    });
  }

  // Resolve yarnId, inventoryStatus from YarnCatalog (batch lookup)
  // Include all yarn names from LT, ST, blocked, and unallocated
  const allYarnNames = new Set([...ltByYarn.keys(), ...stByYarn.keys(), ...blockedByYarn.keys(), ...unallocatedByYarn.keys()]);
  const [catalogs, inventoryRows] = await Promise.all([
    YarnCatalog.find({ yarnName: { $in: Array.from(allYarnNames) } }).select('_id yarnName minQuantity').lean(),
    YarnInventory.find({}).select('yarnCatalogId blockedNetWeight overbooked').lean(),
  ]);
  const catalogByName = new Map(catalogs.map((c) => [c.yarnName, c]));
  const inventoryByCatalogId = new Map(inventoryRows.map((inv) => [String(inv.yarnCatalogId), inv]));

  const inventoryMap = new Map();
  for (const yarnName of allYarnNames) {
    // Boxes (LT, Unallocated): boxWeight IS net weight (no tare subtraction)
    // Cones (ST): coneWeight is gross, tearWeight subtracted to get net
    const lt = ltByYarn.get(yarnName) || { totalWeight: 0, totalNetWeight: 0 };
    const st = stByYarn.get(yarnName) || { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 };
    const blocked = blockedByYarn.get(yarnName) || { blockedWeight: 0, blockedCones: 0 };
    const unallocated = unallocatedByYarn.get(yarnName) || { totalWeight: 0, totalNetWeight: 0 };
    const catalog = catalogByName.get(yarnName);
    
    // Total Net = LT + ST (unallocated is separate, not counted in available)
    const totalNet = toNum(lt.totalNetWeight) + toNum(st.totalNetWeight);
    let inventoryStatus = 'in_stock';
    if (catalog?.minQuantity) {
      const minQty = toNum(catalog.minQuantity);
      if (totalNet <= minQty) inventoryStatus = 'low_stock';
      else if (totalNet <= minQty * 1.2) inventoryStatus = 'soon_to_be_low';
    }
    const inventory = catalog?._id ? inventoryByCatalogId.get(String(catalog._id)) : undefined;

    inventoryMap.set(yarnName, {
      yarnId: catalog?._id,
      yarnName,
      // LT: boxWeight is already net, so totalWeight = totalNetWeight
      longTermInventory: { totalWeight: toNum(lt.totalWeight), totalNetWeight: toNum(lt.totalNetWeight), numberOfCones: 0 },
      // ST: coneWeight is gross, netWeight = coneWeight - tearWeight
      shortTermInventory: { totalWeight: toNum(st.totalNetWeight), totalNetWeight: toNum(st.totalNetWeight), numberOfCones: st.numberOfCones || 0 },
      // Unallocated: boxWeight is already net
      unallocatedInventory: { totalWeight: toNum(unallocated.totalWeight), totalNetWeight: toNum(unallocated.totalNetWeight) },
      blockedNetWeight: toNum(blocked.blockedWeight),
      blockedCones: toNum(blocked.blockedCones),
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
  const limit = Math.min(Math.max(1, Number(options.limit) || 100), 100000);
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
  // Note: totalShortTermKg should NOT subtract blocked - that's for Available Qty only
  let totalLongTermKg = 0;
  let totalShortTermKg = 0;
  for (const inv of results) {
    const lt = inv.longTermInventory || {};
    const st = inv.shortTermInventory || {};
    totalLongTermKg += Math.max(0, (lt.totalNetWeight || 0));
    totalShortTermKg += Math.max(0, (st.totalNetWeight || 0));
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

/**
 * Available short-term (ST rack) cone stock aggregated by yarn catalog id and by yarn name.
 * Uses the same ST slot barcodes as live inventory (StorageSlot SHORT_TERM); excludes issued/used cones.
 * @returns {Promise<{
 *   byCatalogId: Record<string, { totalNetWeightKg: number; numberOfCones: number }>,
 *   byYarnName: Record<string, { totalNetWeightKg: number; numberOfCones: number }>
 * }>}
 */
export const getShortTermConeStockByYarnKeys = async () => {
  const { stBarcodes } = await getSlotBarcodes();
  if (!stBarcodes.length) {
    return { byCatalogId: {}, byYarnName: {} };
  }

  const match = {
    coneStorageId: { $in: stBarcodes },
    issueStatus: { $nin: yarnConeUnavailableIssueStatuses },
  };

  const byCatAgg = await YarnCone.aggregate([
    { $match: { ...match, yarnCatalogId: { $exists: true, $ne: null } } },
    {
      $group: {
        _id: '$yarnCatalogId',
        totalNetWeightKg: {
          $sum: { $subtract: [{ $ifNull: ['$coneWeight', 0] }, { $ifNull: ['$tearWeight', 0] }] },
        },
        numberOfCones: { $sum: 1 },
      },
    },
  ]).allowDiskUse(true);

  const byNameAgg = await YarnCone.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          $toLower: {
            $trim: {
              input: { $ifNull: ['$yarnName', ''] },
            },
          },
        },
        totalNetWeightKg: {
          $sum: { $subtract: [{ $ifNull: ['$coneWeight', 0] }, { $ifNull: ['$tearWeight', 0] }] },
        },
        numberOfCones: { $sum: 1 },
      },
    },
  ]).allowDiskUse(true);

  /** @type {Record<string, { totalNetWeightKg: number; numberOfCones: number }>} */
  const byCatalogId = {};
  const toNumKg = (v) => Math.max(0, Number(v ?? 0));

  for (const r of byCatAgg) {
    if (r._id) {
      byCatalogId[String(r._id)] = {
        totalNetWeightKg: toNumKg(r.totalNetWeightKg),
        numberOfCones: Math.max(0, Math.floor(Number(r.numberOfCones ?? 0))),
      };
    }
  }

  /** @type {Record<string, { totalNetWeightKg: number; numberOfCones: number }>} */
  const byYarnName = {};
  for (const r of byNameAgg) {
    const key = typeof r._id === 'string' ? r._id : String(r._id ?? '');
    if (!key) continue;
    byYarnName[key] = {
      totalNetWeightKg: toNumKg(r.totalNetWeightKg),
      numberOfCones: Math.max(0, Math.floor(Number(r.numberOfCones ?? 0))),
    };
  }

  return { byCatalogId, byYarnName };
};

