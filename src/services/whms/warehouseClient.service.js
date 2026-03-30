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

  if (query.parentKeyCode && String(query.parentKeyCode).trim()) {
    filter.parentKeyCode = new RegExp(escapeRegex(String(query.parentKeyCode).trim()), 'i');
  }

  const andClause = [];

  if (query.city && String(query.city).trim()) {
    const term = escapeRegex(String(query.city).trim());
    const regex = new RegExp(term, 'i');
    andClause.push({ $or: [{ city: regex }, { 'storeProfile.city': regex }] });
  }
  if (query.state && String(query.state).trim()) {
    const term = escapeRegex(String(query.state).trim());
    const regex = new RegExp(term, 'i');
    andClause.push({ $or: [{ state: regex }, { 'storeProfile.state': regex }] });
  }

  if (query.search && String(query.search).trim()) {
    const term = escapeRegex(String(query.search).trim());
    andClause.push({
      $or: [
        { retailerName: { $regex: term, $options: 'i' } },
        { distributorName: { $regex: term, $options: 'i' } },
        { parentKeyCode: { $regex: term, $options: 'i' } },
        { gstin: { $regex: term, $options: 'i' } },
        { contactPerson: { $regex: term, $options: 'i' } },
        { outlet: { $regex: term, $options: 'i' } },
        { 'storeProfile.brand': { $regex: term, $options: 'i' } },
        { 'storeProfile.brandSub': { $regex: term, $options: 'i' } },
        { 'storeProfile.sapCode': { $regex: term, $options: 'i' } },
        { 'storeProfile.billCode': { $regex: term, $options: 'i' } },
        { 'storeProfile.retekCode': { $regex: term, $options: 'i' } },
        { 'storeProfile.classification': { $regex: term, $options: 'i' } },
      ],
    });
  }

  if (andClause.length > 0) {
    filter.$and = andClause;
  }

  return filter;
};

export const createWarehouseClient = async (body) => {
  if (body.type === WarehouseClientType.STORE) {
    const doc = await WarehouseClient.create({
      type: WarehouseClientType.STORE,
      storeProfile: body.storeProfile || {},
      ...(body.status !== undefined && { status: body.status }),
      ...(body.remarks !== undefined && { remarks: body.remarks }),
      ...(body.slNo !== undefined && { slNo: body.slNo }),
    });
    return WarehouseClient.findById(doc._id);
  }
  const doc = await WarehouseClient.create(body);
  return WarehouseClient.findById(doc._id);
};

export const queryWarehouseClients = async (filter, options) => {
  return WarehouseClient.paginate(filter, options);
};

export const getWarehouseClientById = async (id) => {
  return WarehouseClient.findById(id);
};

/**
 * Store clients only persist `storeProfile` (unless changing `type` away from Store).
 * Non-Store clients use root fields; `storeProfile` is ignored unless switching to Store.
 */
export const updateWarehouseClientById = async (id, body) => {
  const doc = await WarehouseClient.findById(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse client not found');

  const nextType = body.type !== undefined ? body.type : doc.type;

  if (doc.type === WarehouseClientType.STORE && nextType !== WarehouseClientType.STORE) {
    const patch = pick(body, ROOT_PATCH_KEYS);
    if (Object.keys(patch).length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'No updatable fields provided');
    }
    Object.assign(doc, patch);
    await doc.save();
    return WarehouseClient.findById(doc._id);
  }

  if (nextType === WarehouseClientType.STORE) {
    if (doc.type === WarehouseClientType.STORE) {
      if (body.storeProfile === undefined) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'No updatable fields provided');
      }
      const current = doc.storeProfile && typeof doc.storeProfile.toObject === 'function'
        ? doc.storeProfile.toObject()
        : doc.storeProfile || {};
      doc.storeProfile = { ...current, ...body.storeProfile };
      doc.markModified('storeProfile');
      await doc.save();
      return WarehouseClient.findById(doc._id);
    }

    if (body.storeProfile === undefined) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'storeProfile is required when setting type to Store');
    }
    doc.type = WarehouseClientType.STORE;
    const current = doc.storeProfile && typeof doc.storeProfile.toObject === 'function'
      ? doc.storeProfile.toObject()
      : doc.storeProfile || {};
    doc.storeProfile = { ...current, ...body.storeProfile };
    doc.markModified('storeProfile');
    await doc.save();
    return WarehouseClient.findById(doc._id);
  }

  const patch = pick(body, ROOT_PATCH_KEYS);
  const storeProfilePatch = body.storeProfile;

  if (Object.keys(patch).length === 0 && storeProfilePatch === undefined) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No updatable fields provided');
  }

  Object.assign(doc, patch);

  await doc.save();
  return WarehouseClient.findById(doc._id);
};

export const deleteWarehouseClientById = async (id) => {
  const doc = await WarehouseClient.findByIdAndDelete(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse client not found');
  return doc;
};
