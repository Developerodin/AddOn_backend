import { StorageSlot, YarnBox, YarnCone } from '../../models/index.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import httpStatus from 'http-status';
import { STORAGE_ZONES } from '../../models/storageManagement/storageSlot.model.js';

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

  const [results, total] = await Promise.all([
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

  const [results, total] = await Promise.all([
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
    const yarnBoxes = await YarnBox.find({ storageLocation: barcode })
      .sort({ createdAt: -1 })
      .lean();

    return {
      storageSlot,
      zoneType: 'LONG_TERM',
      type: 'boxes',
      count: yarnBoxes.length,
      data: yarnBoxes,
    };
  }

  if (zoneCode === STORAGE_ZONES.SHORT_TERM) {
    // For short-term storage, return yarn cones
    const yarnCones = await YarnCone.find({ coneStorageId: barcode })
      .sort({ createdAt: -1 })
      .lean();

    return {
      storageSlot,
      zoneType: 'SHORT_TERM',
      type: 'cones',
      count: yarnCones.length,
      data: yarnCones,
    };
  }

  throw new ApiError(httpStatus.BAD_REQUEST, `Unknown zone code: ${zoneCode}`);
};


