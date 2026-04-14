import mongoose from 'mongoose';
import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import pick from '../../utils/pick.js';
import Product from '../../models/product.model.js';
import StyleCode from '../../models/styleCode.model.js';
import WarehouseInventory from '../../models/whms/warehouseInventory.model.js';
import WarehouseInventoryLog from '../../models/whms/warehouseInventoryLog.model.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const POPULATE_DEFAULT = [
  { path: 'itemId', select: 'name factoryCode softwareCode internalCode knittingCode' },
  { path: 'styleCodeId', select: 'styleCode eanCode mrp brand pack status' },
];

/**
 * Insert one audit row (append-only). Call after the parent inventory row is saved.
 * @param {Record<string, unknown>} payload
 */
export const appendWarehouseInventoryLog = async (payload) => {
  return WarehouseInventoryLog.create(payload);
};

export const countWarehouseInventoryLogsByInventoryId = async (inventoryId) => {
  if (!inventoryId) return 0;
  return WarehouseInventoryLog.countDocuments({ warehouseInventoryId: inventoryId });
};

/**
 * @param {string|import('mongoose').Types.ObjectId} inventoryId
 * @param {Record<string, unknown>} options — sortBy, limit, page (paginate plugin)
 */
export const queryWarehouseInventoryLogsByInventoryId = async (inventoryId, options) => {
  return WarehouseInventoryLog.paginate(
    { warehouseInventoryId: inventoryId },
    {
      ...options,
      sortBy: options.sortBy || 'createdAt:desc',
    }
  );
};

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

/**
 * Resolve Product + StyleCode master by article number (factoryCode) and style code string.
 * Matches behaviour used when posting inward receive to warehouse inventory.
 *
 * @param {string} articleNumber — factoryCode / article no. from client or sheet
 * @param {string} styleCodeInput — style code as entered (case-insensitive match)
 * @returns {Promise<{ itemId: import('mongoose').Types.ObjectId; styleCodeId: import('mongoose').Types.ObjectId; styleCode: string; itemData: Record<string, unknown>; styleCodeData: Record<string, unknown> }>}
 */
export const resolveWarehouseInventoryRefsByArticleAndStyle = async (articleNumber, styleCodeInput) => {
  const articleTrim = String(articleNumber || '').trim();
  const styleTrim = String(styleCodeInput || '').trim();
  if (!articleTrim) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'factoryCode (article number) is required');
  }
  if (!styleTrim) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'styleCode is required');
  }

  const product = await Product.findOne({
    factoryCode: new RegExp(`^${escapeRegex(articleTrim)}$`, 'i'),
  }).lean();

  if (!product?._id) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Product not found for factoryCode "${articleTrim}"`
    );
  }

  const styleCodeDoc = await StyleCode.findOne({
    styleCode: new RegExp(`^${escapeRegex(styleTrim)}$`, 'i'),
  }).lean();

  if (!styleCodeDoc?._id) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Style code "${styleTrim}" is not registered; add it in Style Code master first`
    );
  }

  return {
    itemId: product._id,
    styleCodeId: styleCodeDoc._id,
    styleCode: styleCodeDoc.styleCode,
    itemData: {
      factoryCode: product.factoryCode,
      name: product.name,
      productId: String(product._id),
    },
    styleCodeData: {
      styleCode: styleCodeDoc.styleCode,
      eanCode: styleCodeDoc.eanCode,
      mrp: styleCodeDoc.mrp,
      brand: styleCodeDoc.brand,
      pack: styleCodeDoc.pack,
    },
  };
};

/**
 * Build a normalized payload for create/merge (resolve article+style or use explicit ids).
 * @param {Record<string, unknown>} body
 */
const buildWarehouseInventoryPayload = async (body) => {
  const clean = { ...body };
  delete clean.logs;

  const article = String(clean.factoryCode ?? clean.articleNumber ?? '').trim();
  const styleInput = String(clean.styleCode ?? '').trim();
  const hasExplicitIds = Boolean(clean.itemId && clean.styleCodeId && styleInput);

  delete clean.factoryCode;
  delete clean.articleNumber;

  if (article && !hasExplicitIds) {
    const resolved = await resolveWarehouseInventoryRefsByArticleAndStyle(article, styleInput);
    Object.assign(clean, {
      itemId: resolved.itemId,
      styleCodeId: resolved.styleCodeId,
      styleCode: resolved.styleCode,
      itemData: resolved.itemData,
      styleCodeData: resolved.styleCodeData,
    });
    if (body.itemData && typeof body.itemData === 'object' && !Array.isArray(body.itemData)) {
      clean.itemData = { ...resolved.itemData, ...body.itemData };
    }
    if (body.styleCodeData && typeof body.styleCodeData === 'object' && !Array.isArray(body.styleCodeData)) {
      clean.styleCodeData = { ...resolved.styleCodeData, ...body.styleCodeData };
    }
  } else if (!hasExplicitIds) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Provide (itemId, styleCodeId, and styleCode) or (factoryCode or articleNumber and styleCode)'
    );
  }

  const addTotal = Math.max(0, Number(clean.totalQuantity ?? 0));
  const addBlocked = Math.max(0, Number(clean.blockedQuantity ?? 0));

  return { clean, addTotal, addBlocked };
};

/**
 * Add quantities onto an existing row (same style code / styleCodeId) and refresh item/style snapshots from payload.
 */
const mergeWarehouseInventoryQuantities = async (doc, clean, addTotal, addBlocked) => {
  const prevTotal = doc.totalQuantity ?? 0;
  const prevBlocked = doc.blockedQuantity ?? 0;
  const nextTotal = prevTotal + addTotal;
  let nextBlocked = prevBlocked + addBlocked;
  if (nextBlocked > nextTotal) {
    nextBlocked = nextTotal;
  }

  doc.itemId = clean.itemId;
  doc.styleCodeId = clean.styleCodeId;
  doc.styleCode = clean.styleCode;
  if (clean.itemData !== undefined) doc.itemData = clean.itemData;
  if (clean.styleCodeData !== undefined) doc.styleCodeData = clean.styleCodeData;
  doc.totalQuantity = nextTotal;
  doc.blockedQuantity = nextBlocked;

  await doc.save();

  const totalChanged = nextTotal !== prevTotal;
  const blockedChanged = nextBlocked !== prevBlocked;
  if (totalChanged || blockedChanged) {
    await appendWarehouseInventoryLog({
      warehouseInventoryId: doc._id,
      styleCodeId: doc.styleCodeId,
      styleCode: doc.styleCode,
      action: 'import_merge',
      message: 'Merged quantities from inventory create/import (same article + style)',
      quantityDelta: totalChanged ? nextTotal - prevTotal : undefined,
      blockedDelta: blockedChanged ? nextBlocked - prevBlocked : undefined,
      totalQuantityAfter: nextTotal,
      blockedQuantityAfter: nextBlocked,
      availableQuantityAfter: Math.max(0, nextTotal - nextBlocked),
      userId: null,
    });
  }

  return WarehouseInventory.findById(doc._id).populate(POPULATE_DEFAULT);
};

/**
 * @returns {Promise<{ record: unknown; wasMerged: boolean }>}
 */
const upsertWarehouseInventory = async (body) => {
  const { clean, addTotal, addBlocked } = await buildWarehouseInventoryPayload(body);

  const existing = await WarehouseInventory.findOne({ styleCodeId: clean.styleCodeId });
  if (existing) {
    const record = await mergeWarehouseInventoryQuantities(existing, clean, addTotal, addBlocked);
    return { record, wasMerged: true };
  }

  try {
    const doc = await WarehouseInventory.create(clean);
    const record = await WarehouseInventory.findById(doc._id).populate(POPULATE_DEFAULT);
    return { record, wasMerged: false };
  } catch (err) {
    if (err?.code === 11000) {
      const retry = await WarehouseInventory.findOne({ styleCodeId: clean.styleCodeId });
      if (retry) {
        const record = await mergeWarehouseInventoryQuantities(retry, clean, addTotal, addBlocked);
        return { record, wasMerged: true };
      }
    }
    throw err;
  }
};

export const createWarehouseInventory = async (body) => {
  const { record } = await upsertWarehouseInventory(body);
  return record;
};

/**
 * Bulk-create or merge warehouse inventory rows (e.g. Excel → JSON). Each element matches {@link createWarehouseInventory}.
 * Same article + same style resolves to one row: quantities are added, not a second document.
 * Continues on per-row failure; see returned `errors`.
 *
 * @param {Record<string, unknown>[]} items
 * @returns {Promise<{ total: number; created: number; inserted: number; merged: number; failed: number; errors: Array<{ index: number; error: string; factoryCode?: unknown; articleNumber?: unknown; styleCode?: unknown; itemId?: unknown; styleCodeId?: unknown }>; processingTime: number }>}
 */
export const bulkImportWarehouseInventory = async (items) => {
  const results = {
    total: items.length,
    /** Rows processed successfully (insert + merge) — same meaning as before */
    created: 0,
    inserted: 0,
    merged: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };
  const startTime = Date.now();

  for (let i = 0; i < items.length; i += 1) {
    const row = items[i];
    try {
      const { wasMerged } = await upsertWarehouseInventory(row);
      results.created += 1;
      if (wasMerged) results.merged += 1;
      else results.inserted += 1;
    } catch (error) {
      results.failed += 1;
      const message = error instanceof ApiError ? error.message : error?.message || String(error);
      results.errors.push({
        index: i,
        factoryCode: row.factoryCode,
        articleNumber: row.articleNumber,
        styleCode: row.styleCode,
        itemId: row.itemId,
        styleCodeId: row.styleCodeId,
        error: message,
      });
    }
  }

  results.processingTime = Date.now() - startTime;
  return results;
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

  await doc.save();

  if (totalChanged || blockedChanged) {
    await appendWarehouseInventoryLog({
      warehouseInventoryId: doc._id,
      styleCodeId: doc.styleCodeId,
      styleCode: doc.styleCode,
      action: 'manual_adjust',
      message: reason || 'Manual update via API',
      quantityDelta: totalChanged ? doc.totalQuantity - prevTotal : undefined,
      blockedDelta: blockedChanged ? doc.blockedQuantity - prevBlocked : undefined,
      totalQuantityAfter: doc.totalQuantity,
      blockedQuantityAfter: doc.blockedQuantity,
      availableQuantityAfter: Math.max(0, (doc.totalQuantity ?? 0) - (doc.blockedQuantity ?? 0)),
      userId: userId || null,
    });
  }

  return WarehouseInventory.findById(doc._id).populate(POPULATE_DEFAULT);
};

export const deleteWarehouseInventoryById = async (id) => {
  await WarehouseInventoryLog.deleteMany({ warehouseInventoryId: id });
  const doc = await WarehouseInventory.findByIdAndDelete(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse inventory not found');
  return doc;
};
