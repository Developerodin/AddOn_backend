import { StorageSlot, YarnBox, YarnCone } from '../../models/index.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import httpStatus from 'http-status';
import {
  STORAGE_ZONES,
  LT_SECTION_CODES,
  ST_SECTION_CODE,
} from '../../models/storageManagement/storageSlot.model.js';

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

export const getStorageContentsByBarcode = async (barcode) => {
  const storageSlot = await StorageSlot.findOne({ barcode }).lean();

  if (!storageSlot) {
    throw new ApiError(httpStatus.NOT_FOUND, `Storage slot with barcode ${barcode} not found`);
  }

  const { zoneCode } = storageSlot;

  if (zoneCode === STORAGE_ZONES.LONG_TERM) {
    // For long-term storage, return yarn boxes
    // Exclude boxes that have cones in ST storage (boxes are empty, removed from LT)
    const allBoxes = await YarnBox.find({ storageLocation: barcode, storedStatus: true })
      .sort({ createdAt: -1 })
      .lean();

    // Filter out boxes that have cones in ST storage (these boxes should not be in LT)
    const { YarnCone } = await import('../../models/index.js');
    const yarnBoxes = [];
    
    for (const box of allBoxes) {
      const conesInST = await YarnCone.countDocuments({
        boxId: box.boxId,
        coneStorageId: { $regex: /^ST-/i },
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
    // For short-term storage, return yarn cones
    // Show cones that are: (1) not issued, OR (2) issued but returned
    const yarnCones = await YarnCone.find({ 
      coneStorageId: barcode,
      $or: [
        { issueStatus: 'not_issued' },           // Never issued - in storage
        { returnStatus: 'returned' }             // Was issued but returned - back in storage
      ]
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


