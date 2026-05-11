import { StorageSlot, YarnBox, YarnCone } from '../../models/index.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import httpStatus from 'http-status';
import {
  STORAGE_ZONES,
  LT_SECTION_CODES,
  ST_SECTION_CODE,
} from '../../models/storageManagement/storageSlot.model.js';
import { yarnConeUnavailableIssueStatuses } from '../../models/yarnReq/yarnCone.model.js';
import { activeYarnBoxMatch, activeYarnConeMatch } from '../yarnManagement/yarnStockActiveFilters.js';

const FLOORS_PER_SECTION = 4;
const MAX_RACKS_PER_ADD = 50;

const filterableFields = ['zoneCode', 'shelfNumber', 'floorNumber', 'isActive'];
const paginationOptions = ['limit', 'page', 'sortBy'];

export const queryStorageSlots = async (query) => {
  const filter = pick(query, filterableFields);
  const options = pick(query, paginationOptions);

  if (query.zone) {
    filter.zoneCode = query.zone;
  }
  if (query.shelf) {
    filter.shelfNumber = Number(query.shelf);
  }
  if (query.floor) {
    filter.floorNumber = Number(query.floor);
  }

  const page = Number(options.page ?? 1);
  const limit = Number(options.limit ?? 200);
  const skip = (page - 1) * limit;

  // LT: return sections in order B7-G-02 → B7-G-03 → B7-2F-01 → B7-2F-02
  const isLT = filter.zoneCode === STORAGE_ZONES.LONG_TERM;
  const [results, total] = isLT
    ? await Promise.all([
        StorageSlot.aggregate([
          { $match: filter },
          {
            $addFields: {
              _sectionOrder: { $indexOfArray: [LT_SECTION_CODES, '$sectionCode'] },
            },
          },
          { $sort: { _sectionOrder: 1, shelfNumber: 1, floorNumber: 1 } },
          { $skip: skip },
          { $limit: limit },
          { $project: { _sectionOrder: 0 } },
        ]),
        StorageSlot.countDocuments(filter),
      ])
    : await Promise.all([
        StorageSlot.find(filter)
          .sort({ zoneCode: 1, shelfNumber: 1, floorNumber: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        StorageSlot.countDocuments(filter),
      ]);

  return {
    results,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
    totalResults: total,
  };
};

export const getStorageSlotsByZone = async (zoneCode, query = {}) => {
  const filter = { zoneCode };
  const options = pick(query, paginationOptions);

  // Allow additional filters
  if (query.shelf) {
    filter.shelfNumber = Number(query.shelf);
  }
  if (query.floor) {
    filter.floorNumber = Number(query.floor);
  }
  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === 'true' || query.isActive === true;
  }

  const page = Number(options.page ?? 1);
  const limit = Number(options.limit ?? 200);
  const skip = (page - 1) * limit;

  // LT: sections in order B7-G-02 → B7-G-03 → B7-2F-01 → B7-2F-02
  const isLT = zoneCode === STORAGE_ZONES.LONG_TERM;
  const [results, total] = isLT
    ? await Promise.all([
        StorageSlot.aggregate([
          { $match: filter },
          {
            $addFields: {
              _sectionOrder: { $indexOfArray: [LT_SECTION_CODES, '$sectionCode'] },
            },
          },
          { $sort: { _sectionOrder: 1, shelfNumber: 1, floorNumber: 1 } },
          { $skip: skip },
          { $limit: limit },
          { $project: { _sectionOrder: 0 } },
        ]),
        StorageSlot.countDocuments(filter),
      ])
    : await Promise.all([
        StorageSlot.find(filter)
          .sort({ shelfNumber: 1, floorNumber: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        StorageSlot.countDocuments(filter),
      ]);

  return {
    results,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
    totalResults: total,
    zoneCode,
  };
};

/**
 * Get all storage slots with their box/cone contents in a single call.
 * No pagination limit - returns entire data.
 * @param {string} [zone] - Zone filter (LT, ST). If omitted, returns all zones.
 * @param {Object} [query] - Optional shelf, floor, isActive filters
 * @returns {Promise<Object>} { results: [{ slot, boxes, cones, ... }], zoneCode?, totalResults }
 */
export const getStorageSlotsWithContents = async (zone, query = {}) => {
  const filter = {};
  if (zone) filter.zoneCode = zone;
  if (query.shelf != null) filter.shelfNumber = Number(query.shelf);
  if (query.floor != null) filter.floorNumber = Number(query.floor);
  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === 'true' || query.isActive === true;
  }

  const isLTZone = zone === STORAGE_ZONES.LONG_TERM;
  const slots = isLTZone
    ? await StorageSlot.aggregate([
        { $match: filter },
        {
          $addFields: {
            _sectionOrder: { $indexOfArray: [LT_SECTION_CODES, '$sectionCode'] },
          },
        },
        { $sort: { _sectionOrder: 1, shelfNumber: 1, floorNumber: 1 } },
        { $project: { _sectionOrder: 0 } },
      ])
    : await StorageSlot.find(filter)
        .sort({ zoneCode: 1, sectionCode: 1, shelfNumber: 1, floorNumber: 1 })
        .lean();

  if (slots.length === 0) {
    return { results: [], totalResults: 0, zoneCode: zone || null };
  }

  const barcodes = slots.map((s) => s.barcode || s.label).filter(Boolean);

  // Fetch all boxes for LT slots (storageLocation in barcodes)
  const boxesByLocation = {};
  const boxes = await YarnBox.find({
    storageLocation: { $in: barcodes },
    storedStatus: true,
    ...activeYarnBoxMatch,
  }).lean();

  // Filter out boxes whose cones are FULLY transferred to ST (box effectively empty).
  // With partial transfers, `box.boxWeight` represents remaining LT weight, so we rely on:
  // - explicit marker coneData.conesIssued OR
  // - remaining weight == 0 OR
  // - initialBoxWeight fully consumed by cone weight in ST (fallback).
  const boxIds = boxes.map((b) => b.boxId);
  const conesInSTByBox = await YarnCone.aggregate([
    {
      $match: {
        boxId: { $in: boxIds },
        coneStorageId: { $exists: true, $nin: [null, ''] },
        ...activeYarnConeMatch,
      },
    },
    { $group: { _id: '$boxId', totalConeWeight: { $sum: '$coneWeight' } } },
  ]);
  const coneWeightByBox = new Map(conesInSTByBox.map((x) => [x._id, x.totalConeWeight || 0]));

  for (const box of boxes) {
    const boxWeight = box.boxWeight || 0;
    const coneWeightInST = coneWeightByBox.get(box.boxId) || 0;
    const initial = box.initialBoxWeight != null ? Number(box.initialBoxWeight) : null;
    const fullyTransferred =
      box?.coneData?.conesIssued === true ||
      boxWeight <= 0.001 ||
      (initial != null && initial > 0 && coneWeightInST >= initial - 0.001);
    if (fullyTransferred) continue; // Box fully transferred to cones, skip
    const loc = box.storageLocation;
    if (!boxesByLocation[loc]) boxesByLocation[loc] = [];
    boxesByLocation[loc].push(box);
  }

  // Fetch all cones for ST slots (coneStorageId in barcodes)
  const conesByLocation = {};
  const cones = await YarnCone.find({
    coneStorageId: { $in: barcodes },
    issueStatus: { $nin: yarnConeUnavailableIssueStatuses },
    ...activeYarnConeMatch,
  }).lean();
  for (const cone of cones) {
    const loc = cone.coneStorageId;
    if (!conesByLocation[loc]) conesByLocation[loc] = [];
    conesByLocation[loc].push(cone);
  }

  const results = slots.map((slot) => {
    const barcode = slot.barcode || slot.label;
    const slotBoxes = boxesByLocation[barcode] || [];
    const slotCones = conesByLocation[barcode] || [];
    const isLTZone = slot.zoneCode === STORAGE_ZONES.LONG_TERM;

    let remainingWeight = { totalWeight: 0, totalNetWeight: 0, yarns: [] };
    if (isLTZone) {
      const yarnSummary = {};
      for (const box of slotBoxes) {
        const netWeight = (box.boxWeight || 0) - (box.tearweight || 0);
        remainingWeight.totalWeight += box.boxWeight || 0;
        remainingWeight.totalNetWeight += netWeight;
        const yn = box.yarnName || 'Unknown';
        if (!yarnSummary[yn]) yarnSummary[yn] = { yarnName: yn, totalWeight: 0, totalNetWeight: 0, boxCount: 0 };
        yarnSummary[yn].totalWeight += box.boxWeight || 0;
        yarnSummary[yn].totalNetWeight += netWeight;
        yarnSummary[yn].boxCount += 1;
      }
      remainingWeight.yarns = Object.values(yarnSummary);
    } else {
      const yarnSummary = {};
      for (const cone of slotCones) {
        remainingWeight.totalWeight += cone.coneWeight || 0;
        const yn = cone.yarnName || 'Unknown';
        if (!yarnSummary[yn]) yarnSummary[yn] = { yarnName: yn, totalWeight: 0, coneCount: 0 };
        yarnSummary[yn].totalWeight += cone.coneWeight || 0;
        yarnSummary[yn].coneCount += 1;
      }
      remainingWeight.yarns = Object.values(yarnSummary);
    }

    return {
      ...slot,
      boxes: slotBoxes,
      cones: slotCones,
      boxCount: slotBoxes.length,
      coneCount: slotCones.length,
      zoneType: isLTZone ? 'LONG_TERM' : 'SHORT_TERM',
      remainingWeight,
    };
  });

  // Calculate zone summary
  let totalBoxes = 0;
  let totalCones = 0;
  let totalWeight = 0;
  const yarnNamesSet = new Set();

  for (const slot of results) {
    totalBoxes += slot.boxCount || 0;
    totalCones += slot.coneCount || 0;
    
    // LT: boxWeight (already net)
    // ST: coneWeight - tearWeight (net)
    if (zone === STORAGE_ZONES.LONG_TERM) {
      for (const box of slot.boxes || []) {
        totalWeight += box.boxWeight || 0;
        if (box.yarnName) yarnNamesSet.add(box.yarnName);
      }
    } else {
      for (const cone of slot.cones || []) {
        totalWeight += (cone.coneWeight || 0) - (cone.tearWeight || 0);
        if (cone.yarnName) yarnNamesSet.add(cone.yarnName);
      }
    }
  }

  return {
    results,
    totalResults: results.length,
    zoneCode: zone || null,
    summary: {
      totalBoxes,
      totalCones,
      totalWeight: Math.round(totalWeight * 100) / 100,
      yarnTypes: yarnNamesSet.size,
    },
  };
};

export const getStorageContentsByBarcode = async (barcode) => {
  const storageSlot = await StorageSlot.findOne({ barcode }).lean();

  if (!storageSlot) {
    throw new ApiError(httpStatus.NOT_FOUND, `Storage slot with barcode ${barcode} not found`);
  }

  const { zoneCode } = storageSlot;

  if (zoneCode === STORAGE_ZONES.LONG_TERM) {
    // For long-term storage, return yarn boxes
    // Exclude boxes that have cones in ST storage (boxes are empty, removed from LT)
    const allBoxes = await YarnBox.find({
      storageLocation: barcode,
      storedStatus: true,
      ...activeYarnBoxMatch,
    })
      .sort({ createdAt: -1 })
      .lean();

    // Filter out boxes that have cones in ST storage (these boxes should not be in LT)
    const { YarnCone } = await import('../../models/index.js');
    const yarnBoxes = [];
    
    for (const box of allBoxes) {
      const conesInST = await YarnCone.countDocuments({
        boxId: box.boxId,
        coneStorageId: { $exists: true, $nin: [null, ''] },
        ...activeYarnConeMatch,
      });
      
      // Only include box if it has no cones in ST (box still has yarn in it)
      if (conesInST === 0) {
        yarnBoxes.push(box);
      } else {
        // Box has cones in ST - it should be removed from LT
        // Auto-remove it now
        await YarnBox.findByIdAndUpdate(box._id, {
          storageLocation: null,
          storedStatus: false,
          $set: {
            'coneData.conesIssued': true,
            'coneData.numberOfCones': conesInST,
            'coneData.coneIssueDate': new Date(),
          },
        });
      }
    }

    // Calculate remaining weight on this rack
    let totalWeight = 0;
    let totalNetWeight = 0;
    const yarnSummary = {};

    for (const box of yarnBoxes) {
      const netWeight = (box.boxWeight || 0) - (box.tearweight || 0);
      totalWeight += box.boxWeight || 0;
      totalNetWeight += netWeight;

      const yarnName = box.yarnName || 'Unknown';
      if (!yarnSummary[yarnName]) {
        yarnSummary[yarnName] = {
          yarnName,
          totalWeight: 0,
          totalNetWeight: 0,
          boxCount: 0,
        };
      }
      yarnSummary[yarnName].totalWeight += box.boxWeight || 0;
      yarnSummary[yarnName].totalNetWeight += netWeight;
      yarnSummary[yarnName].boxCount += 1;
    }

    return {
      storageSlot,
      zoneType: 'LONG_TERM',
      type: 'boxes',
      count: yarnBoxes.length,
      remainingWeight: {
        totalWeight,
        totalNetWeight,
        yarns: Object.values(yarnSummary),
      },
      data: yarnBoxes,
    };
  }

  if (zoneCode === STORAGE_ZONES.SHORT_TERM) {
    // For short-term storage, return yarn cones that are still available in the slot
    // (i.e. neither issued nor used).
    const yarnCones = await YarnCone.find({
      coneStorageId: barcode,
      issueStatus: { $nin: yarnConeUnavailableIssueStatuses },
      ...activeYarnConeMatch,
    })
      .sort({ createdAt: -1 })
      .lean();

    // Calculate remaining weight on this rack
    let totalWeight = 0;
    const yarnSummary = {};

    for (const cone of yarnCones) {
      totalWeight += cone.coneWeight || 0;
      const yarnName = cone.yarnName || 'Unknown';
      if (!yarnSummary[yarnName]) {
        yarnSummary[yarnName] = {
          yarnName,
          totalWeight: 0,
          coneCount: 0,
        };
      }
      yarnSummary[yarnName].totalWeight += cone.coneWeight || 0;
      yarnSummary[yarnName].coneCount += 1;
    }

    return {
      storageSlot,
      zoneType: 'SHORT_TERM',
      type: 'cones',
      count: yarnCones.length,
      remainingWeight: {
        totalWeight,
        yarns: Object.values(yarnSummary),
      },
      data: yarnCones,
    };
  }

  throw new ApiError(httpStatus.BAD_REQUEST, `Unknown zone code: ${zoneCode}`);
};

/**
 * Resolve zone and validate section for add-racks. Throws ApiError if invalid.
 */
function getZoneAndValidateSection(storageType, sectionCode) {
  const type = String(storageType).toLowerCase();
  if (type === 'longterm' || type === 'lt') {
    if (!LT_SECTION_CODES.includes(sectionCode)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Invalid long-term section. Use one of: ${LT_SECTION_CODES.join(', ')}`
      );
    }
    return { zoneCode: STORAGE_ZONES.LONG_TERM, sectionCode };
  }
  if (type === 'shortterm' || type === 'st') {
    if (sectionCode !== ST_SECTION_CODE) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Invalid short-term section. Use: ${ST_SECTION_CODE}`
      );
    }
    return { zoneCode: STORAGE_ZONES.SHORT_TERM, sectionCode };
  }
  throw new ApiError(
    httpStatus.BAD_REQUEST,
    "storageType must be 'longterm' or 'shortterm'"
  );
}

/**
 * Add N racks (shelves) to a section. Each rack has FLOORS_PER_SECTION floors.
 * Uses upsert so existing slots are not duplicated.
 */
export const addRacksToSection = async (payload) => {
  const { storageType, sectionCode, numberOfRacksToAdd } = payload;
  if (numberOfRacksToAdd > MAX_RACKS_PER_ADD) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `numberOfRacksToAdd must be at most ${MAX_RACKS_PER_ADD}`
    );
  }

  const { zoneCode } = getZoneAndValidateSection(storageType, sectionCode);

  const existing = await StorageSlot.findOne(
    { zoneCode, sectionCode },
    {},
    { sort: { shelfNumber: -1 } }
  );
  const startShelf = existing ? existing.shelfNumber + 1 : 1;
  const endShelf = startShelf + numberOfRacksToAdd - 1;

  const bulkOps = [];
  for (let shelf = startShelf; shelf <= endShelf; shelf += 1) {
    for (let floor = 1; floor <= FLOORS_PER_SECTION; floor += 1) {
      const shelfStr = String(shelf).padStart(4, '0');
      const floorStr = String(floor).padStart(2, '0');
      const label = `${sectionCode}-S${shelfStr}-F${floorStr}`;
      bulkOps.push({
        updateOne: {
          filter: { zoneCode, sectionCode, shelfNumber: shelf, floorNumber: floor },
          update: {
            $setOnInsert: {
              zoneCode,
              sectionCode,
              shelfNumber: shelf,
              floorNumber: floor,
              label,
              barcode: label,
              isActive: true,
            },
          },
          upsert: true,
        },
      });
    }
  }

  const result = await StorageSlot.bulkWrite(bulkOps, { ordered: false });
  const inserted = result.upsertedCount ?? 0;
  const matched = result.matchedCount ?? 0;

  return {
    sectionCode,
    zoneCode,
    shelvesAdded: numberOfRacksToAdd,
    shelfRange: { start: startShelf, end: endShelf },
    insertedSlots: inserted,
    alreadyPresentSlots: matched,
  };
};

/**
 * Bulk assign yarn boxes to storage slots. For each assignment: find slot by rack barcode,
 * find boxes by box barcode, set box.storageLocation = slot.barcode and box.storedStatus = true.
 */
export const bulkAssignBoxesToSlots = async (payload) => {
  const { assignments } = payload;
  if (!assignments?.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'assignments array is required with at least one item');
  }

  const updated = [];
  const failed = [];

  for (let i = 0; i < assignments.length; i++) {
    const { rackBarcode, boxBarcodes } = assignments[i];
    const slotBarcode = (rackBarcode || '').trim();
    const barcodes = [...new Set((boxBarcodes || []).map((b) => (b || '').trim()).filter(Boolean))];

    if (!barcodes.length) {
      failed.push({ index: i, rackBarcode: slotBarcode, reason: 'no_box_barcodes' });
      continue;
    }

    const slot = await StorageSlot.findOne({ barcode: slotBarcode, isActive: true });
    if (!slot) {
      failed.push({ index: i, rackBarcode: slotBarcode, reason: 'slot_not_found' });
      continue;
    }

    const boxes = await YarnBox.find({ barcode: { $in: barcodes }, ...activeYarnBoxMatch });
    const foundBarcodes = new Set(boxes.map((b) => b.barcode));
    const missingBarcodes = barcodes.filter((b) => !foundBarcodes.has(b));

    for (const box of boxes) {
      box.storageLocation = slot.barcode;
      box.storedStatus = true;
      await box.save();
      updated.push({
        assignmentIndex: i,
        rackBarcode: slot.barcode,
        boxId: box.boxId,
        barcode: box.barcode,
      });
    }

    if (missingBarcodes.length) {
      failed.push({
        index: i,
        rackBarcode: slotBarcode,
        reason: 'boxes_not_found',
        boxBarcodes: missingBarcodes,
      });
    }
  }

  return {
    message: `Assigned ${updated.length} box(es) to slot(s), ${failed.length} assignment(s) had issues`,
    updatedCount: updated.length,
    failedCount: failed.length,
    updated,
    failed,
  };
};


