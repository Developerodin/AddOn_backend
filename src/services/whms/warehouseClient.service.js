import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import pick from '../../utils/pick.js';
import WarehouseClient, { WarehouseClientType } from '../../models/whms/warehouseClient.model.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ROOT_PATCH_KEYS = [
  'slNo',
  'distributorName',
  'parentKeyCode',
  'retailerName',
  'type',
  'contactPerson',
  'mobilePhone',
  'address',
  'locality',
  'city',
  'zipCode',
  'state',
  'gstin',
  'email',
  'phone1',
  'rsm',
  'asm',
  'se',
  'dso',
  'outlet',
  'status',
  'remarks',
];

/**
 * @param {Record<string, unknown>} query
 */
export const buildWarehouseClientFilter = (query) => {
  const filter = {};

  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;

  if (query.city && String(query.city).trim()) {
    filter.city = new RegExp(escapeRegex(String(query.city).trim()), 'i');
  }
  if (query.state && String(query.state).trim()) {
    filter.state = new RegExp(escapeRegex(String(query.state).trim()), 'i');
  }
  if (query.parentKeyCode && String(query.parentKeyCode).trim()) {
    filter.parentKeyCode = new RegExp(escapeRegex(String(query.parentKeyCode).trim()), 'i');
  }

  if (query.search && String(query.search).trim()) {
    const term = escapeRegex(String(query.search).trim());
    filter.$or = [
      { retailerName: { $regex: term, $options: 'i' } },
      { distributorName: { $regex: term, $options: 'i' } },
      { parentKeyCode: { $regex: term, $options: 'i' } },
      { gstin: { $regex: term, $options: 'i' } },
      { contactPerson: { $regex: term, $options: 'i' } },
      { outlet: { $regex: term, $options: 'i' } },
    ];
  }

  return filter;
};

export const createWarehouseClient = async (body) => {
  const doc = await WarehouseClient.create(body);
  return WarehouseClient.findById(doc._id);
};

export const queryWarehouseClients = async (filter, options) => {
  return WarehouseClient.paginate(filter, options);
};

export const getWarehouseClientById = async (id) => {
  return WarehouseClient.findById(id);
};

export const updateWarehouseClientById = async (id, body) => {
  const doc = await WarehouseClient.findById(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse client not found');

  const patch = pick(body, ROOT_PATCH_KEYS);
  const storeProfilePatch = body.storeProfile;

  if (Object.keys(patch).length === 0 && storeProfilePatch === undefined) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No updatable fields provided');
  }

  Object.assign(doc, patch);

  if (storeProfilePatch !== undefined && doc.type === WarehouseClientType.STORE) {
    const current = doc.storeProfile && typeof doc.storeProfile.toObject === 'function'
      ? doc.storeProfile.toObject()
      : doc.storeProfile || {};
    doc.storeProfile = { ...current, ...storeProfilePatch };
    doc.markModified('storeProfile');
  }

  await doc.save();
  return WarehouseClient.findById(doc._id);
};

export const deleteWarehouseClientById = async (id) => {
  const doc = await WarehouseClient.findByIdAndDelete(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse client not found');
  return doc;
};
