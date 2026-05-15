import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnBox, YarnCone, YarnPurchaseOrder } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import { LT_SECTION_CODES } from '../../models/storageManagement/storageSlot.model.js';
import {
  activeYarnBoxListingMatch,
  activeYarnBoxMatch,
  activeYarnConeMatch,
} from './yarnStockActiveFilters.js';

const LT_STORAGE_PATTERN = new RegExp(`^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`, 'i');
// Hide only boxes that are explicitly consumed (fully converted to cones and emptied).
// Freshly created placeholders can still have 0/missing boxWeight and should remain visible.
const ACTIVE_BOX_FILTER = activeYarnBoxListingMatch;

/**
 * True when the box had an initial net weight snapshot and current net weight is zero or less
 * (material fully taken from the box — read-only on PO process).
 * @param {Object} box - YarnBox document or plain object
 * @returns {boolean}
 */
const isFullyUsedAfterInitialCapture = (box) => {
  const initialRaw = box?.initialBoxWeight;
  const initial = initialRaw != null && initialRaw !== '' ? Number(initialRaw) : NaN;
  const w = Number(box?.boxWeight ?? 0);
  return Number.isFinite(initial) && initial > 0 && Number.isFinite(w) && w <= 0;
};

/**
 * Whether a box may be edited on PO receive / process flows (`isActiveForProcessing` on API when `include_inactive`).
 * Excludes vendor returns and boxes that are fully used after an `initialBoxWeight` snapshot (net weight zero).
 * Default GET /yarn-boxes visibility still uses {@link ACTIVE_BOX_FILTER}.
 * @param {Object} box - YarnBox document or plain object
 * @returns {boolean}
 */
export const isYarnBoxActiveForProcessing = (box) => {
  if (box?.returnedToVendorAt) return false;
  if (isFullyUsedAfterInitialCapture(box)) return false;
  return true;
};

export const createYarnBox = async (yarnBoxBody) => {
  const body = { ...yarnBoxBody };
  delete body.initialBoxWeight;
  if (!body.boxId) {
    const autoBoxId = `BOX-${Date.now()}`;
    body.boxId = autoBoxId;
  } else {
    const existingBox = await YarnBox.findOne({ boxId: body.boxId, ...activeYarnBoxMatch });
    if (existingBox) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Box ID already exists');
    }
  }

  // Only check for existing barcode if provided (otherwise it will be auto-generated)
  if (body.barcode) {
    const existingBarcode = await YarnBox.findOne({ barcode: body.barcode, ...activeYarnBoxMatch });
    if (existingBarcode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Barcode already exists');
    }
  }

  const yarnBox = await YarnBox.create(body);
  return yarnBox;
};

export const getYarnBoxById = async (yarnBoxId) => {
  const yarnBox = await YarnBox.findOne({ _id: yarnBoxId, ...ACTIVE_BOX_FILTER });
  if (!yarnBox) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn box not found');
  }
  return yarnBox;
};

/**
 * Resolve a yarn box from a scanned or pasted value.
 * @param {string} barcode - Box barcode, legacy box Mongo id string, or yarn cone barcode
 * @param {{ includeInactive?: boolean|string }} [options] - When true, do not apply ACTIVE_BOX_FILTER on direct barcode/boxId matches
 */
export const getYarnBoxByBarcode = async (barcode, options = {}) => {
  const trimmed = String(barcode || '').trim();
  const includeInactive =
    options.includeInactive === true ||
    options.includeInactive === 'true' ||
    options.includeInactive === '1';

  const activePart = includeInactive ? {} : ACTIVE_BOX_FILTER;

  let yarnBox = await YarnBox.findOne({ barcode: trimmed, ...activePart }).lean();

  if (!yarnBox && includeInactive) {
    yarnBox = await YarnBox.findOne({ barcode: trimmed }).lean();
  }

  // Cone barcodes are ObjectId-shaped strings; resolve parent box by boxId (always, for ST/process flows)
  if (!yarnBox) {
    const coneQuery =
      includeInactive === true ? { barcode: trimmed } : { barcode: trimmed, ...activeYarnConeMatch };
    const cone = await YarnCone.findOne(coneQuery).select('boxId').lean();
    if (cone?.boxId) {
      yarnBox = await YarnBox.findOne({ boxId: cone.boxId, ...activePart }).lean();
    }
  }

  // Box may use Mongo _id string as barcode (pre-save hook)
  const isCanonicalObjectId =
    mongoose.Types.ObjectId.isValid(trimmed) &&
    String(new mongoose.Types.ObjectId(trimmed)) === trimmed;

  if (!yarnBox && isCanonicalObjectId) {
    const byId = await YarnBox.findById(new mongoose.Types.ObjectId(trimmed)).lean();
    if (byId && (includeInactive || isYarnBoxActiveForProcessing(byId))) {
      yarnBox = byId;
    }
  }

  if (!yarnBox) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn box not found with this barcode');
  }

  // Fetch purchase order and supplier by poNumber
  if (yarnBox.poNumber) {
    const purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber: yarnBox.poNumber })
      .populate({
        path: 'supplier',
        select: '_id brandName contactPersonName contactNumber email address city state pincode country gstNo status',
      })
      .select('poNumber supplier supplierName currentStatus')
      .lean();

    if (purchaseOrder) {
      yarnBox.purchaseOrder = {
        poNumber: purchaseOrder.poNumber,
        supplierName: purchaseOrder.supplierName,
        currentStatus: purchaseOrder.currentStatus,
      };
      yarnBox.supplier = purchaseOrder.supplier || null;
    } else {
      yarnBox.purchaseOrder = null;
      yarnBox.supplier = null;
    }
  } else {
    yarnBox.purchaseOrder = null;
    yarnBox.supplier = null;
  }

  return yarnBox;
};

export const updateYarnBoxById = async (yarnBoxId, updateBody) => {
  const yarnBox = await YarnBox.findById(yarnBoxId);
  if (!yarnBox) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn box not found');
  }

  const before = {
    boxId: yarnBox.boxId,
    yarnName: yarnBox.yarnName,
    yarnCatalogId: yarnBox.yarnCatalogId?.toString?.() ?? yarnBox.yarnCatalogId,
    shadeCode: yarnBox.shadeCode,
  };

  if (!isYarnBoxActiveForProcessing(yarnBox)) {
    const reason = yarnBox.returnedToVendorAt
      ? 'returned to vendor'
      : 'fully used (initial weight recorded, current net weight is zero)';
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `This yarn box is read-only (${reason}) and cannot be updated.`
    );
  }

  // Guardrail: prevent inconsistent states when cones are already in short-term storage for this box.
  // Partial transfer is allowed (box still in LT with weight + LT storageLocation).
  // But unsetting storageLocation while keeping boxWeight > 0 causes "orphan" boxes (no location but nonzero weight).
  const hasShortTermCones = await YarnCone.exists({
    boxId: yarnBox.boxId,
    coneStorageId: { $exists: true, $nin: [null, ''] },
    ...activeYarnConeMatch,
  });
  if (hasShortTermCones) {
    const willSetStorageLocation =
      Object.prototype.hasOwnProperty.call(updateBody, 'storageLocation') &&
      updateBody.storageLocation != null &&
      String(updateBody.storageLocation).trim() !== '';
    const willUnsetStorageLocation =
      Object.prototype.hasOwnProperty.call(updateBody, 'storageLocation') &&
      (updateBody.storageLocation == null || String(updateBody.storageLocation).trim() === '');
    const nextBoxWeight = Object.prototype.hasOwnProperty.call(updateBody, 'boxWeight')
      ? Number(updateBody.boxWeight)
      : Number(yarnBox.boxWeight ?? 0);

    if (Number.isNaN(nextBoxWeight) || nextBoxWeight < 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'boxWeight must be a valid non-negative number');
    }

    if (willUnsetStorageLocation && nextBoxWeight > 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cannot remove storageLocation while boxWeight > 0 for a box that has cones in short-term storage. Set boxWeight=0 if the box is fully transferred.'
      );
    }

    // If user tries to set a storage location while keeping boxWeight=0, it's probably wrong too:
    // a fully transferred box should stay empty; force user to set a non-zero weight if they want to "bring back" the box.
    if (willSetStorageLocation && nextBoxWeight === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cannot set storageLocation for an empty box (boxWeight=0) when cones are already in short-term storage.'
      );
    }
  }

  if (updateBody.boxId && updateBody.boxId !== yarnBox.boxId) {
    const existingBox = await YarnBox.findOne({
      boxId: updateBody.boxId,
      _id: { $ne: yarnBoxId },
      ...activeYarnBoxMatch,
    });
    if (existingBox) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Box ID already exists');
    }
  }

  if (updateBody.barcode && updateBody.barcode !== yarnBox.barcode) {
    const existingBarcode = await YarnBox.findOne({
      barcode: updateBody.barcode,
      _id: { $ne: yarnBoxId },
      ...activeYarnBoxMatch,
    });
    if (existingBarcode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Barcode already exists');
    }
  }

  const update = { ...updateBody };
  delete update.initialBoxWeight;

  Object.assign(yarnBox, update);
  await yarnBox.save();

  /**
   * Keep YarnCones consistent with their parent YarnBox.
   * Cones do NOT automatically inherit yarnName from the box unless they are individually saved.
   * @param {Object} params
   * @param {string} params.boxId - YarnBox.boxId (join key on YarnCone)
   * @param {string|undefined|null} params.yarnName
   * @param {string|undefined|null} params.yarnCatalogId
   * @param {string|undefined|null} params.shadeCode
   * @returns {Promise<void>}
   */
  const syncConesFromBox = async ({ boxId, yarnName, yarnCatalogId, shadeCode }) => {
    if (!boxId) return;
    const set = {};
    if (yarnName != null) set.yarnName = yarnName;
    if (yarnCatalogId != null) set.yarnCatalogId = yarnCatalogId;
    if (shadeCode != null) set.shadeCode = shadeCode;
    if (Object.keys(set).length === 0) return;
    await YarnCone.updateMany({ boxId, ...activeYarnConeMatch }, { $set: set });
  };

  const after = {
    boxId: yarnBox.boxId,
    yarnName: yarnBox.yarnName,
    yarnCatalogId: yarnBox.yarnCatalogId?.toString?.() ?? yarnBox.yarnCatalogId,
    shadeCode: yarnBox.shadeCode,
  };
  const yarnChanged =
    before.boxId === after.boxId &&
    (before.yarnName !== after.yarnName ||
      String(before.yarnCatalogId ?? '') !== String(after.yarnCatalogId ?? '') ||
      before.shadeCode !== after.shadeCode);
  if (yarnChanged) {
    try {
      await syncConesFromBox({
        boxId: after.boxId,
        yarnName: after.yarnName,
        yarnCatalogId: yarnBox.yarnCatalogId ?? null,
        shadeCode: after.shadeCode,
      });
    } catch (e) {
      console.error('[YarnBox] failed syncing cones from box:', e?.message || e);
    }
  }
  return yarnBox;
};

export const queryYarnBoxes = async (filters = {}) => {
  const includeInactive = filters.include_inactive === true || filters.include_inactive === 'true';
  const mongooseFilter = includeInactive ? {} : { ...ACTIVE_BOX_FILTER };

  if (filters.po_number) {
    mongooseFilter.poNumber = filters.po_number;
  }

  if (filters.yarn_name) {
    mongooseFilter.yarnName = { $regex: filters.yarn_name, $options: 'i' };
  }

  if (filters.shade_code) {
    mongooseFilter.shadeCode = { $regex: filters.shade_code, $options: 'i' };
  }

  if (filters.storage_location) {
    mongooseFilter.storageLocation = { $regex: filters.storage_location, $options: 'i' };
  }

  if (typeof filters.cones_issued === 'boolean') {
    mongooseFilter['coneData.conesIssued'] = filters.cones_issued;
  }

  const storedStatus = filters.stored_status;
  if (storedStatus === true || storedStatus === 'true') {
    mongooseFilter.storedStatus = true;
  } else if (storedStatus === false || storedStatus === 'false') {
    mongooseFilter.storedStatus = false;
  }

  let query = YarnBox.find(mongooseFilter).sort({ createdAt: -1 });
  const limitNum = typeof filters.limit === 'number' ? filters.limit : parseInt(filters.limit, 10);
  if (!Number.isNaN(limitNum) && limitNum > 0) {
    query = query.limit(limitNum);
  }
  let yarnBoxes = await query.lean();
  if (includeInactive) {
    yarnBoxes = yarnBoxes.map((b) => ({
      ...b,
      isActiveForProcessing: isYarnBoxActiveForProcessing(b),
    }));
  }
  return yarnBoxes;
};

/**
 * Resolve yarnName and shadeCode for a lot from PO when the lot has exactly one poItem.
 * Uses PO's poItems (with populated yarn) and receivedLotDetails. Returns nulls when lot has multiple poItems.
 * @param {Object} po - Purchase order (lean) with poItems.yarnCatalogId populated and receivedLotDetails
 * @param {string} lotNumber - Lot number
 * @returns {{ yarnName: string | null, shadeCode: string | null }}
 */
const getYarnAndShadeForLotFromPo = (po, lotNumber) => {
  const receivedLots = po?.receivedLotDetails || [];
  const lot = receivedLots.find((l) => (l.lotNumber || '').trim() === (lotNumber || '').trim());
  const lotPoItems = lot?.poItems || [];
  if (lotPoItems.length !== 1) return { yarnName: null, shadeCode: null };
  const poItemId = typeof lotPoItems[0].poItem === 'string' ? lotPoItems[0].poItem : lotPoItems[0].poItem?.toString?.();
  if (!poItemId) return { yarnName: null, shadeCode: null };
  const poItems = po?.poItems || [];
  const item = poItems.find((i) => i._id && i._id.toString() === poItemId);
  const yarnName = (item?.yarnCatalogId?.yarnName || item?.yarnName || '').trim() || null;
  const shadeCode =
    (item?.shadeCode || item?.shade || item?.yarnCatalogId?.colorFamily?.colorCode || '')?.trim?.() || null;
  return { yarnName, shadeCode };
};

/**
 * Create yarn boxes per lot. For each lot, only inserts the gap: max(0, requested numberOfBoxes − existing active boxes).
 * Does not delete boxes when requested count is lower than existing.
 * @param {{ poNumber: string, lotDetails: Array<{ lotNumber: string, numberOfBoxes: number }> }} bulkData
 * @returns {Promise<Object>} createdCount, boxes, skippedLots, etc.
 */
export const bulkCreateYarnBoxes = async (bulkData) => {
  const { lotDetails, poNumber } = bulkData;

  if (!lotDetails || !Array.isArray(lotDetails) || lotDetails.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'lotDetails array is required with at least one lot');
  }

  // Fetch PO once to resolve yarnName/shadeCode per lot (backend as source of truth; avoids wrong frontend-derived names)
  let purchaseOrder = null;
  try {
    purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber })
      .populate({ path: 'poItems.yarnCatalogId', select: '_id yarnName colorFamily' })
      .select('poItems receivedLotDetails')
      .lean();
  } catch {
    // Non-fatal: we'll use placeholder yarnName if PO not found
  }

  // Per lot: create only missing boxes (requested total minus existing active boxes).
  const existingBoxesByLot = {};
  const skippedLots = [];
  const boxesToCreate = [];
  const baseTimestamp = Date.now();
  let boxCounter = 1;

  for (const lotDetail of lotDetails) {
    const { lotNumber, numberOfBoxes } = lotDetail;

    if (numberOfBoxes < 1) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Number of boxes must be at least 1 for lot ${lotNumber}`
      );
    }

    const existingCount = await YarnBox.countDocuments({ poNumber, lotNumber, ...activeYarnBoxMatch });
    const desiredCount = numberOfBoxes;
    const additionalNeeded = Math.max(0, desiredCount - existingCount);

    existingBoxesByLot[lotNumber] = existingCount;

    if (additionalNeeded === 0) {
      skippedLots.push({
        lotNumber,
        existingCount,
        requestedCount: desiredCount,
        reason:
          existingCount > desiredCount
            ? `Lot has ${existingCount} box(es); requested ${desiredCount} — no new boxes created (existing boxes retained)`
            : 'Requested box count already satisfied for this lot',
      });
      continue;
    }

    const { yarnName: resolvedYarnName, shadeCode: resolvedShadeCode } = purchaseOrder
      ? getYarnAndShadeForLotFromPo(purchaseOrder, lotNumber)
      : { yarnName: null, shadeCode: null };
    const yarnName = (resolvedYarnName && resolvedYarnName.trim()) || `Yarn-${poNumber}`;

    for (let i = 0; i < additionalNeeded; i++) {
      const boxId = `BOX-${poNumber}-${lotNumber}-${baseTimestamp}-${boxCounter}`;
      const uniqueBarcode = new mongoose.Types.ObjectId().toString();

      const boxPayload = {
        boxId,
        poNumber,
        lotNumber,
        barcode: uniqueBarcode,
        yarnName,
        receivedDate: new Date(),
      };
      if (resolvedShadeCode) boxPayload.shadeCode = resolvedShadeCode;
      boxesToCreate.push(boxPayload);
      boxCounter++;
    }
  }

  const allLotNumbers = [...new Set(lotDetails.map((l) => l.lotNumber))];

  if (boxesToCreate.length === 0) {
    const existingBoxes =
      allLotNumbers.length > 0
        ? await YarnBox.find({
            poNumber,
            lotNumber: { $in: allLotNumbers },
            ...activeYarnBoxMatch,
          }).sort({ createdAt: -1 })
        : [];

    return {
      message: `No new boxes needed for PO ${poNumber} (all lots at or above requested count)`,
      existingBoxesByLot,
      skippedLots,
      boxes: existingBoxes,
      created: false,
      createdCount: 0,
    };
  }

  const createdBoxes = await YarnBox.insertMany(boxesToCreate);
  const totalBoxes = createdBoxes.length;

  const additionalByLot = new Map();
  for (const row of boxesToCreate) {
    const ln = row.lotNumber;
    additionalByLot.set(ln, (additionalByLot.get(ln) || 0) + 1);
  }

  const createdLots = [...additionalByLot.entries()].map(([ln, n]) => ({
    lotNumber: ln,
    numberOfBoxes: n,
  }));

  const hasSkippedLots = skippedLots.length > 0;
  const message = hasSkippedLots
    ? `Created ${totalBoxes} new box(es) across ${createdLots.length} lot(s); ${skippedLots.length} lot(s) needed no new boxes`
    : `Successfully created ${totalBoxes} boxes for PO ${poNumber}`;
  
  return {
    message,
    createdCount: totalBoxes,
    boxesByLot: createdLots,
    skippedLots: hasSkippedLots ? skippedLots : undefined,
    existingBoxesByLot: hasSkippedLots ? existingBoxesByLot : undefined,
    boxes: createdBoxes,
    created: true,
  };
};

/**
 * Bulk match-update: for each item, find exactly one box where all of
 * (lotNumber, poNumber, yarnName, shadeCode, boxWeight, numberOfCones) match, then set barcode and boxId.
 * Returns updated and failed items.
 */
export const bulkMatchUpdateYarnBoxes = async (payload) => {
  const { items } = payload;
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'items array is required with at least one item');
  }

  const updated = [];
  const failed = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const matchFilter = {
      lotNumber: (item.lotNumber || '').trim(),
      poNumber: (item.poNumber || '').trim(),
      yarnName: (item.yarnName || '').trim(),
      shadeCode: (item.shadeCode || '').trim(),
      boxWeight: Number(item.boxWeight),
      numberOfCones: Number(item.numberOfCones),
      ...activeYarnBoxMatch,
    };
    const newBarcode = (item.barcode || '').trim();
    const newBoxId = (item.boxId || '').trim();

    const boxes = await YarnBox.find(matchFilter).limit(2);
    if (boxes.length === 0) {
      failed.push({ index: i, match: matchFilter, reason: 'no_matching_box' });
      continue;
    }
    if (boxes.length > 1) {
      failed.push({ index: i, match: matchFilter, reason: 'multiple_matching_boxes' });
      continue;
    }

    const box = boxes[0];
    if (newBarcode !== box.barcode) {
      const existingBarcode = await YarnBox.findOne({
        barcode: newBarcode,
        _id: { $ne: box._id },
        ...activeYarnBoxMatch,
      });
      if (existingBarcode) {
        failed.push({ index: i, match: matchFilter, reason: 'barcode_already_exists', barcode: newBarcode });
        continue;
      }
    }
    if (newBoxId !== box.boxId) {
      const existingBoxId = await YarnBox.findOne({
        boxId: newBoxId,
        _id: { $ne: box._id },
        ...activeYarnBoxMatch,
      });
      if (existingBoxId) {
        failed.push({ index: i, match: matchFilter, reason: 'box_id_already_exists', boxId: newBoxId });
        continue;
      }
    }

    box.barcode = newBarcode;
    box.boxId = newBoxId;
    await box.save();
    updated.push({
      index: i,
      _id: box._id.toString(),
      boxId: newBoxId,
      barcode: newBarcode,
    });
  }

  return {
    message: `Updated ${updated.length} box(es), ${failed.length} failed`,
    updatedCount: updated.length,
    failedCount: failed.length,
    updated,
    failed,
  };
};

/**
 * Get boxes by storage location. Returns all matching boxes (no limit).
 * @param {string} storageLocation - Storage location to filter by
 * @returns {Promise<Array>} Boxes with the given storage location
 */
export const getBoxesByStorageLocation = async (storageLocation) => {
  const escaped = String(storageLocation).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boxes = await YarnBox.find({
    storageLocation: { $regex: new RegExp(`^${escaped}$`, 'i') },
    ...ACTIVE_BOX_FILTER,
  })
    .sort({ createdAt: -1 })
    .lean();
  return boxes;
};

/** Matches “no slot”: trim(storageLocation) === '' — aligned with `unallocatedBoxPipeline` in yarnInventory.service.js */
const UNALLOCATED_STORAGE_LOCATION_MATCH = {
  $expr: {
    $eq: [{ $trim: { input: { $ifNull: ['$storageLocation', ''] } } }, ''],
  },
};

/** Unallocated listings roll up boxWeight only; require positive net box weight. */
const HAS_POSITIVE_BOX_WEIGHT = {
  $expr: { $gt: [{ $ifNull: ['$boxWeight', 0] }, 0] },
};

/**
 * Get boxes without storage location (null, undefined, empty, or whitespace-only),
 * excluding rows with no positive boxWeight (gross alone does not count).
 * Returns all matching boxes (no limit). Optionally filter by yarn name (case-insensitive exact match).
 * @param {Object} [filters]
 * @param {string} [filters.yarn_name] - Exact yarn name (case-insensitive) to scope the result.
 * @returns {Promise<Array>} Boxes without storage location
 */
export const getBoxesWithoutStorageLocation = async (filters = {}) => {
  const query = {
    $and: [ACTIVE_BOX_FILTER, UNALLOCATED_STORAGE_LOCATION_MATCH, HAS_POSITIVE_BOX_WEIGHT],
  };

  const yarnName = (filters.yarn_name || '').trim();
  if (yarnName) {
    const escaped = yarnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.yarnName = { $regex: new RegExp(`^${escaped}$`, 'i') };
  }

  const boxes = await YarnBox.find(query)
    .sort({ createdAt: -1 })
    .lean();

  const poNumbers = [...new Set(boxes.map((b) => b.poNumber).filter(Boolean))];
  if (poNumbers.length > 0) {
    const purchaseOrders = await YarnPurchaseOrder.find({ poNumber: { $in: poNumbers } })
      .populate({
        path: 'supplier',
        select: '_id brandName name',
      })
      .select('poNumber supplier supplierName currentStatus')
      .lean();

    const poByNumber = new Map(purchaseOrders.map((po) => [po.poNumber, po]));

    for (const box of boxes) {
      const po = poByNumber.get(box.poNumber);
      if (po) {
        box.purchaseOrder = {
          poNumber: po.poNumber,
          supplierName: po.supplierName,
          currentStatus: po.currentStatus,
        };
        box.supplier = po.supplier || null;
        if (!box.supplierName && po.supplierName) {
          box.supplierName = po.supplierName;
        }
      }
    }
  }

  return boxes;
};

/**
 * Bulk set storage location for boxes that don't have one.
 * Accepts boxIds (business boxId strings) or _ids (MongoDB ObjectIds).
 * @param {Object} payload - { boxIds: string[], storageLocation: string }
 * @returns {Promise<Object>} Updated boxes and count
 */
export const bulkSetBoxStorageLocation = async (payload) => {
  const { boxIds, storageLocation } = payload;
  if (!boxIds || !Array.isArray(boxIds) || boxIds.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'boxIds array is required with at least one box ID');
  }
  if (!storageLocation || String(storageLocation).trim() === '') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'storageLocation is required');
  }

  const isObjectId = (s) => /^[a-fA-F0-9]{24}$/.test(String(s));
  const byId = boxIds.filter((id) => isObjectId(id));
  const byBoxId = boxIds.filter((id) => !isObjectId(id));
  const idFilter = [
    ...(byId.length ? [{ _id: { $in: byId.map((id) => new mongoose.Types.ObjectId(id)) } }] : []),
    ...(byBoxId.length ? [{ boxId: { $in: byBoxId } }] : []),
  ].filter(Boolean);
  if (idFilter.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'boxIds must be valid MongoDB ObjectIds or boxId strings');
  }

  const filter = {
    $and: [
      { $or: idFilter },
      {
        $or: [
          { storageLocation: { $exists: false } },
          { storageLocation: null },
          { storageLocation: '' },
        ],
      },
      activeYarnBoxMatch,
    ],
  };

  const result = await YarnBox.updateMany(filter, { $set: { storageLocation: String(storageLocation).trim() } });

  const updatedBoxes = await YarnBox.find({ $or: idFilter }).lean();
  return {
    message: `Updated storage location for ${result.modifiedCount} box(es)`,
    modifiedCount: result.modifiedCount,
    boxes: updatedBoxes,
  };
};

export const updateQcStatusByPoNumber = async (poNumber, qcStatus, qcData = {}) => {
  const validStatuses = ['qc_approved', 'qc_rejected'];
  
  if (!validStatuses.includes(qcStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Status must be one of: ${validStatuses.join(', ')}`);
  }

  // Find all active (non–vendor-returned) boxes for this PO number
  const boxes = await YarnBox.find({ poNumber, ...activeYarnBoxMatch });
  
  if (boxes.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, `No boxes found for PO number: ${poNumber}`);
  }

  // Prepare update object
  const updateFields = {
    'qcData.status': qcStatus,
    'qcData.date': qcData.date ? new Date(qcData.date) : new Date(),
  };

  if (qcData.user) {
    updateFields['qcData.user'] = qcData.user;
  }
  if (qcData.username) {
    updateFields['qcData.username'] = qcData.username;
  }
  if (qcData.remarks !== undefined) {
    updateFields['qcData.remarks'] = qcData.remarks;
  }
  if (qcData.mediaUrl && typeof qcData.mediaUrl === 'object') {
    // Set the mediaUrl object (can contain multiple keys like video1, image1, image2, etc.)
    updateFields['qcData.mediaUrl'] = qcData.mediaUrl;
  }

  // Update QC data for active boxes only
  const updateResult = await YarnBox.updateMany({ poNumber, ...activeYarnBoxMatch }, { $set: updateFields });

  // Fetch updated boxes
  const updatedBoxes = await YarnBox.find({ poNumber, ...activeYarnBoxMatch });

  // If QC was approved, trigger inventory sync for boxes stored in long-term storage
  // Note: updateMany doesn't trigger post-save hooks, so we need to handle this manually
  if (qcStatus === 'qc_approved') {
    // Save each box individually to trigger post-save hooks for inventory sync
    // This ensures boxes stored in LT storage get synced to inventory
    for (const box of updatedBoxes) {
      if (box.storedStatus && box.storageLocation && LT_STORAGE_PATTERN.test(box.storageLocation) && box.boxWeight > 0) {
        // Trigger save to activate post-save hook
        try {
          await box.save();
        } catch (error) {
          // Log but don't fail the entire operation
          console.error(`[updateQcStatusByPoNumber] Error syncing box ${box.boxId} to inventory:`, error.message);
        }
      }
    }
  }

  return {
    message: `Successfully updated QC status to ${qcStatus} for ${updateResult.modifiedCount} boxes`,
    poNumber,
    status: qcStatus,
    updatedCount: updateResult.modifiedCount,
    totalBoxes: boxes.length,
    boxes: updatedBoxes,
  };
};

/**
 * Reset boxes for a PO when cones are already present in short-term storage.
 * Safe rule: reset ONLY when ST cone count >= expected cone count for the box.
 * expected = numberOfCones || coneData.numberOfCones
 *
 * @param {Object} payload
 * @param {string} payload.poNumber
 * @param {boolean} [payload.dryRun=false]
 * @returns {Promise<{ message: string, poNumber: string, dryRun: boolean, fixed: number, skipped: number, updatedBoxIds: string[] }>}
 */
export const resetBoxesWeightToZeroIfStConesPresent = async ({ poNumber, dryRun = false }) => {
  const normalizedPo = String(poNumber || '').trim();
  if (!normalizedPo) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'poNumber is required');
  }

  const boxes = await YarnBox.find({
    poNumber: normalizedPo,
    boxWeight: { $gt: 0 },
    ...activeYarnBoxMatch,
  })
    .select('_id boxId boxWeight numberOfCones coneData storageLocation storedStatus')
    .lean();

  let fixed = 0;
  let skipped = 0;
  const updatedBoxIds = [];

  for (const box of boxes) {
    const boxId = String(box.boxId || '').trim();
    if (!boxId) {
      skipped += 1;
      continue;
    }

    const expectedCones = Number(box.numberOfCones ?? box?.coneData?.numberOfCones ?? 0);
    if (!Number.isFinite(expectedCones) || expectedCones <= 0) {
      skipped += 1;
      continue;
    }

    const stConeCount = await YarnCone.countDocuments({
      boxId,
      coneStorageId: { $exists: true, $nin: [null, ''] },
      ...activeYarnConeMatch,
    });

    if (stConeCount > 0 && stConeCount >= expectedCones) {
      fixed += 1;
      updatedBoxIds.push(boxId);

      if (!dryRun) {
        await YarnBox.updateOne(
          { _id: box._id },
          {
            $set: {
              boxWeight: 0,
              storedStatus: false,
              coneData: {
                ...(box.coneData && typeof box.coneData === 'object' ? box.coneData : {}),
                conesIssued: true,
                numberOfCones: expectedCones,
                coneIssueDate: new Date(),
              },
            },
            $unset: { storageLocation: '' },
          }
        );
      }
    } else {
      skipped += 1;
    }
  }

  return {
    message: dryRun
      ? `Dry-run: would reset ${fixed} box(es) for PO ${normalizedPo}`
      : `Reset ${fixed} box(es) for PO ${normalizedPo}`,
    poNumber: normalizedPo,
    dryRun: Boolean(dryRun),
    fixed,
    skipped,
    updatedBoxIds,
  };
};

/**
 * Backfill LT YarnBox.boxWeight (remaining) from cones already stored in ST.
 *
 * Rules:
 * - Only boxes currently in LT storage (storageLocation matches LT pattern).
 * - Skip boxWeight <= 0.
 * - Skip boxes with no ST cones.
 *
 * @param {Object} payload
 * @param {boolean} [payload.dryRun=false]
 * @param {number} [payload.limit]
 * @param {string} [payload.onlyBoxId]
 */
export const backfillLtBoxWeightFromStCones = async ({ dryRun = false, limit, onlyBoxId } = {}) => {
  const normalizedOnly = String(onlyBoxId || '').trim();
  const max = Number(limit ?? 0);

  // 1) Aggregate ST cone totals by boxId.
  const coneMatch = {
    coneStorageId: { $exists: true, $nin: [null, ''] },
    coneWeight: { $gt: 0 },
    ...activeYarnConeMatch,
    ...(normalizedOnly ? { boxId: normalizedOnly } : {}),
  };

  const coneAgg = await YarnCone.aggregate([
    { $match: coneMatch },
    {
      $group: {
        _id: '$boxId',
        totalConeWeight: { $sum: { $ifNull: ['$coneWeight', 0] } },
        coneCount: { $sum: 1 },
      },
    },
  ]).allowDiskUse(true);

  const byBoxId = new Map();
  for (const row of coneAgg) {
    const boxId = String(row._id || '').trim();
    if (!boxId) continue;
    const totalConeWeight = Number(row.totalConeWeight ?? 0);
    const coneCount = Number(row.coneCount ?? 0);
    if (!Number.isFinite(totalConeWeight) || totalConeWeight <= 0 || coneCount <= 0) continue;
    byBoxId.set(boxId, { totalConeWeight, coneCount });
  }

  const boxIds = Array.from(byBoxId.keys());
  if (boxIds.length === 0) {
    return {
      message: 'No short-term cones found; nothing to backfill.',
      dryRun: Boolean(dryRun),
      updated: 0,
      skipped: 0,
      touchedBoxIds: [],
    };
  }

  // 2) Load candidate LT boxes (weight > 0, storageLocation set).
  let q = YarnBox.find({
    boxId: { $in: boxIds },
    boxWeight: { $gt: 0 },
    storageLocation: { $exists: true, $ne: '' },
    ...activeYarnBoxMatch,
  }).select('_id boxId boxWeight initialBoxWeight storageLocation storedStatus coneData');

  if (max > 0) q = q.limit(max);
  const boxes = await q.lean();

  const LT_STORAGE_PATTERN_LOCAL = /^(LT-|B7-0[2-5]-)/i;
  const touchedBoxIds = [];
  let updated = 0;
  let skipped = 0;

  const resolveBaseWeight = ({ initialBoxWeight, boxWeightNow, moved }) => {
    const initial = initialBoxWeight != null ? Number(initialBoxWeight) : 0;
    if (Number.isFinite(initial) && initial > 0) return initial;
    const bw = Number(boxWeightNow ?? 0);
    const m = Number(moved ?? 0);
    if (!Number.isFinite(bw) || bw <= 0) return 0;
    if (!Number.isFinite(m) || m <= 0) return bw;
    return bw >= m ? bw : bw + m;
  };

  for (const box of boxes) {
    const boxId = String(box.boxId || '').trim();
    const storageLocation = String(box.storageLocation || '').trim();
    const boxWeightNow = Number(box.boxWeight ?? 0);
    const st = byBoxId.get(boxId);

    if (!boxId || !st) {
      skipped += 1;
      continue;
    }
    if (!storageLocation || !LT_STORAGE_PATTERN_LOCAL.test(storageLocation)) {
      skipped += 1;
      continue;
    }
    if (!Number.isFinite(boxWeightNow) || boxWeightNow <= 0.001) {
      skipped += 1;
      continue;
    }

    const baseWeight = resolveBaseWeight({
      initialBoxWeight: box.initialBoxWeight,
      boxWeightNow,
      moved: st.totalConeWeight,
    });

    if (!Number.isFinite(baseWeight) || baseWeight <= 0) {
      skipped += 1;
      continue;
    }

    const remaining = Math.max(0, baseWeight - st.totalConeWeight);
    const fullyTransferred = st.coneCount > 0 && remaining <= 0.001;

    if (Math.abs(remaining - boxWeightNow) <= 0.0005) {
      skipped += 1;
      continue;
    }

    touchedBoxIds.push(boxId);
    updated += 1;

    if (dryRun) continue;

    const update = fullyTransferred
      ? {
          $set: {
            boxWeight: 0,
            storedStatus: false,
            coneData: {
              ...(box.coneData && typeof box.coneData === 'object' ? box.coneData : {}),
              conesIssued: true,
              numberOfCones: st.coneCount,
              coneIssueDate: new Date(),
            },
          },
          $unset: { storageLocation: '' },
        }
      : {
          $set: {
            boxWeight: remaining,
          },
        };

    await YarnBox.updateOne({ _id: box._id }, update);
  }

  return {
    message: dryRun
      ? `Dry-run: would update ${updated} LT box(es) from ST cones`
      : `Updated ${updated} LT box(es) from ST cones`,
    dryRun: Boolean(dryRun),
    updated,
    skipped,
    touchedBoxIds,
  };
};

/**
 * Whether a yarn box may be archived as an unused PO-receive placeholder.
 * Mirrors process-page rules: no gross/box weights, no cones, not stored; vendor-returned excluded above.
 * @param {object} box - YarnBox document or lean object
 * @returns {string|null} Reason string if not eligible, otherwise null
 */
export const getUnusedPlaceholderArchiveBlockReason = (box) => {
  if (!box) return 'Box not found';
  if (box.returnedToVendorAt) return 'Already removed';
  if (!isYarnBoxActiveForProcessing(box)) return 'Fully used (read-only)';
  if (box.storedStatus === true) return 'Box is stored';
  if (box.storageLocation && String(box.storageLocation).trim() !== '') return 'Has storage location';
  if (box.coneData?.conesIssued === true) return 'Cones already issued for this box';
  if (Number(box.boxWeight ?? 0) > 0) return 'Box weight already recorded';
  if (Number(box.grossWeight ?? 0) > 0) return 'Gross weight already recorded';
  return null;
};

/**
 * Permanently delete unused placeholder boxes (must pass same guards as before) and decrement PO lot box counts.
 * @param {string[]} yarnBoxMongoIds - YarnBox document _id values (hex strings)
 * @returns {Promise<{ archived: string[], failed: Array<{ id: string, reason: string }> }>} - `archived` holds ids successfully deleted (name kept for API compatibility)
 */
export const archiveUnusedPlaceholderYarnBoxesByIds = async (yarnBoxMongoIds) => {
  const ids = Array.isArray(yarnBoxMongoIds) ? yarnBoxMongoIds : [];
  const archived = [];
  const failed = [];

  for (const rawId of ids) {
    const idStr = String(rawId || '').trim();
    if (!idStr || !mongoose.Types.ObjectId.isValid(idStr)) {
      failed.push({ id: idStr || '(empty)', reason: 'Invalid box id' });
      continue;
    }

    const oid = new mongoose.Types.ObjectId(idStr);
    const box = await YarnBox.findById(oid).lean();
    const block = getUnusedPlaceholderArchiveBlockReason(box);
    if (block) {
      failed.push({ id: idStr, reason: block });
      continue;
    }

    const hasActiveCones = await YarnCone.exists({
      boxId: box.boxId,
      ...activeYarnConeMatch,
    });
    if (hasActiveCones) {
      failed.push({ id: idStr, reason: 'Box has yarn cones recorded' });
      continue;
    }

    const del = await YarnBox.deleteOne({ _id: oid });
    if (!del.deletedCount) {
      failed.push({ id: idStr, reason: 'Box could not be deleted' });
      continue;
    }

    const lotTrim = box.lotNumber != null ? String(box.lotNumber).trim() : '';
    if (lotTrim && box.poNumber) {
      await YarnPurchaseOrder.updateOne(
        { poNumber: box.poNumber },
        {
          $inc: { 'receivedLotDetails.$[lot].numberOfBoxes': -1 },
        },
        {
          arrayFilters: [{ 'lot.lotNumber': lotTrim }],
        }
      );
    }

    archived.push(idStr);
  }

  return { archived, failed };
};


