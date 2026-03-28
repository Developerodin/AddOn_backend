import mongoose from 'mongoose';
import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import pick from '../../utils/pick.js';
import WarehouseInventory from '../../models/whms/warehouseInventory.model.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const POPULATE_DEFAULT = [
  { path: 'itemId', select: 'name factoryCode softwareCode internalCode knittingCode' },
  { path: 'styleCodeId', select: 'styleCode eanCode mrp brand pack status' },
];

/**
 * @param {Record<string, unknown>} query
 */
export const buildWarehouseInventoryFilter = (query) => {
  const filter = {};

  if (query.itemId && mongoose.Types.ObjectId.isValid(query.itemId)) {
    filter.itemId = new mongoose.Types.ObjectId(query.itemId);
  }
  if (query.styleCodeId && mongoose.Types.ObjectId.isValid(query.styleCodeId)) {
    filter.styleCodeId = new mongoose.Types.ObjectId(query.styleCodeId);
  }
  if (query.styleCode && String(query.styleCode).trim()) {
    const term = escapeRegex(String(query.styleCode).trim());
    filter.styleCode = { $regex: term, $options: 'i' };
  }

  return filter;
};

export const createWarehouseInventory = async (body) => {
  try {
    const doc = await WarehouseInventory.create(body);
    return WarehouseInventory.findById(doc._id).populate(POPULATE_DEFAULT);
  } catch (err) {
    if (err?.code === 11000) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Warehouse inventory already exists for this style code or styleCodeId'
      );
    }
    throw err;
  }
};

export const queryWarehouseInventories = async (filter, options) => {
  return WarehouseInventory.paginate(filter, {
    ...options,
    populate: options.populate ?? POPULATE_DEFAULT,
  });
};

export const getWarehouseInventoryById = async (id) => {
  return WarehouseInventory.findById(id).populate(POPULATE_DEFAULT);
};

/**
 * Exact style code match (case-insensitive) on stored `styleCode`.
 * @param {string} styleCode
 */
export const getWarehouseInventoryByStyleCode = async (styleCode) => {
  const trim = String(styleCode || '').trim();
  if (!trim) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'styleCode is required');
  }
  return WarehouseInventory.findOne({
    styleCode: new RegExp(`^${escapeRegex(trim)}$`, 'i'),
  }).populate(POPULATE_DEFAULT);
};

const PATCH_KEYS = ['itemData', 'styleCodeData', 'totalQuantity', 'blockedQuantity'];

export const updateWarehouseInventoryById = async (id, updateBody, userId = null) => {
  const doc = await WarehouseInventory.findById(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse inventory not found');

  const patch = pick(updateBody, PATCH_KEYS);
  const reason = typeof updateBody.adjustReason === 'string' ? updateBody.adjustReason.trim() : '';

  if (Object.keys(patch).length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No updatable fields (itemData, styleCodeData, totalQuantity, blockedQuantity)');
  }

  const prevTotal = doc.totalQuantity ?? 0;
  const prevBlocked = doc.blockedQuantity ?? 0;

  Object.assign(doc, patch);

  const totalChanged = patch.totalQuantity !== undefined && doc.totalQuantity !== prevTotal;
  const blockedChanged = patch.blockedQuantity !== undefined && doc.blockedQuantity !== prevBlocked;

  if (totalChanged || blockedChanged) {
    doc.logs.push({
      action: 'manual_adjust',
      message: reason || 'Manual update via API',
      quantityDelta: totalChanged ? doc.totalQuantity - prevTotal : undefined,
      blockedDelta: blockedChanged ? doc.blockedQuantity - prevBlocked : undefined,
      totalQuantityAfter: doc.totalQuantity,
      blockedQuantityAfter: doc.blockedQuantity,
      availableQuantityAfter: Math.max(0, (doc.totalQuantity ?? 0) - (doc.blockedQuantity ?? 0)),
      userId: userId || null,
    });
    doc.markModified('logs');
  }

  await doc.save();
  return WarehouseInventory.findById(doc._id).populate(POPULATE_DEFAULT);
};

export const deleteWarehouseInventoryById = async (id) => {
  const doc = await WarehouseInventory.findByIdAndDelete(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse inventory not found');
  return doc;
};
