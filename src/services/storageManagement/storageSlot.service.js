import { StorageSlot } from '../../models/index.js';
import pick from '../../utils/pick.js';

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


