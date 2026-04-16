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

/** Bulk import processes rows in chunks to bound memory and DB load. */
const BULK_IMPORT_BATCH_SIZE = 100;

/**
 * Insert one audit row (append-only). Call after the parent inventory row is saved.
 * @param {Record<string, unknown>} payload
 */
export const appendWarehouseInventoryLog = async (payload) => {
  return WarehouseInventoryLog.create(payload);
};

/** Log first-time stock row (create path). Merge path uses {@link applyWarehouseInventoryMerge}. */
const appendLogForNewInventoryDocument = async (doc) => {
  const total = doc.totalQuantity ?? 0;
  const blocked = doc.blockedQuantity ?? 0;
  await appendWarehouseInventoryLog({
    warehouseInventoryId: doc._id,
    styleCodeId: doc.styleCodeId,
    styleCode: doc.styleCode,
    action: 'import_create',
    message: 'Warehouse inventory row created (import / bulk)',
    quantityDelta: total,
    blockedDelta: blocked,
    totalQuantityAfter: total,
    blockedQuantityAfter: blocked,
    availableQuantityAfter: Math.max(0, total - blocked),
    userId: null,
  });
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
 * Resolve Product + StyleCode by style code only: Style Code master row + Product whose `styleCodes` includes that style.
 * Use when the client sends only styleCode + quantities (factoryCode derived from the linked product).
 *
 * @param {string} styleCodeInput — style code as entered (case-insensitive match)
 * @returns {Promise<{ itemId: import('mongoose').Types.ObjectId|null; styleCodeId: import('mongoose').Types.ObjectId; styleCode: string; itemData?: Record<string, unknown>; styleCodeData: Record<string, unknown> }>}
 */
export const resolveWarehouseInventoryRefsByStyleCodeOnly = async (styleCodeInput) => {
  const styleTrim = String(styleCodeInput || '').trim();
  if (!styleTrim) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'styleCode is required');
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

  const styleId = styleCodeDoc._id;

  const styleCodeData = {
    styleCode: styleCodeDoc.styleCode,
    eanCode: styleCodeDoc.eanCode,
    mrp: styleCodeDoc.mrp,
    brand: styleCodeDoc.brand,
    pack: styleCodeDoc.pack,
  };

  const activeProducts = await Product.find({
    styleCodes: styleId,
    status: 'active',
  }).lean();

  if (activeProducts.length === 1) {
    const product = activeProducts[0];
    return {
      itemId: product._id,
      styleCodeId: styleId,
      styleCode: styleCodeDoc.styleCode,
      itemData: {
        factoryCode: product.factoryCode,
        name: product.name,
        productId: String(product._id),
      },
      styleCodeData,
    };
  }

  if (activeProducts.length > 1) {
    return {
      itemId: null,
      styleCodeId: styleId,
      styleCode: styleCodeDoc.styleCode,
      itemData: undefined,
      styleCodeData,
    };
  }

  const anyProducts = await Product.find({ styleCodes: styleId }).lean();
  if (anyProducts.length === 1) {
    const product = anyProducts[0];
    return {
      itemId: product._id,
      styleCodeId: styleId,
      styleCode: styleCodeDoc.styleCode,
      itemData: {
        factoryCode: product.factoryCode,
        name: product.name,
        productId: String(product._id),
      },
      styleCodeData,
    };
  }

  return {
    itemId: null,
    styleCodeId: styleId,
    styleCode: styleCodeDoc.styleCode,
    itemData: undefined,
    styleCodeData,
  };
};

/**
 * Build a normalized payload for create/merge (resolve article+style, style-only via Product.styleCodes, or use explicit ids).
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
  } else if (!hasExplicitIds && styleInput && !article) {
    const resolved = await resolveWarehouseInventoryRefsByStyleCodeOnly(styleInput);
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
      'Provide (itemId, styleCodeId, and styleCode), (factoryCode or articleNumber and styleCode), or (styleCode only with product linked in Product.styleCodes)'
    );
  }

  const addTotal = Math.max(0, Number(clean.totalQuantity ?? 0));
  const addBlocked = Math.max(0, Number(clean.blockedQuantity ?? 0));

  return { clean, addTotal, addBlocked };
};

/**
 * Persist merge + audit log (no populate — used by bulk hot path).
 */
const applyWarehouseInventoryMerge = async (doc, clean, addTotal, addBlocked) => {
  const prevTotal = doc.totalQuantity ?? 0;
  const prevBlocked = doc.blockedQuantity ?? 0;
  const nextTotal = prevTotal + addTotal;
  let nextBlocked = prevBlocked + addBlocked;
  if (nextBlocked > nextTotal) {
    nextBlocked = nextTotal;
  }

  if (clean.itemId != null) {
    doc.itemId = clean.itemId;
    if (clean.itemData !== undefined) doc.itemData = clean.itemData;
  } else {
    doc.set('itemId', null);
    doc.itemData = undefined;
  }
  doc.styleCodeId = clean.styleCodeId;
  doc.styleCode = clean.styleCode;
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
};

/**
 * Add quantities onto an existing row (same style code / styleCodeId) and refresh item/style snapshots from payload.
 */
const mergeWarehouseInventoryQuantities = async (doc, clean, addTotal, addBlocked) => {
  await applyWarehouseInventoryMerge(doc, clean, addTotal, addBlocked);
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
    await appendLogForNewInventoryDocument(doc);
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

const isStyleOnlyBulkRow = (row) => {
  if (!row || typeof row !== 'object') return false;
  const style = String(row.styleCode ?? '').trim();
  if (!style) return false;
  const article = String(row.factoryCode ?? row.articleNumber ?? '').trim();
  if (article) return false;
  if (row.itemId || row.styleCodeId) return false;
  return true;
};

const indexProductsByStyleId = (products) => {
  /** @type {Map<string, Record<string, unknown>[]>} */
  const m = new Map();
  for (const p of products) {
    const ids = p.styleCodes || [];
    for (const sid of ids) {
      const k = String(sid);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
  }
  return m;
};

/**
 * Single active product → attach product. Single product (inactive only) → attach.
 * Otherwise save style-only row (no itemId / itemData) — multiple or zero products on this style.
 */
const pickProductForStyle = (styleIdStr, activeByStyle, anyByStyle) => {
  const active = activeByStyle.get(styleIdStr) || [];
  if (active.length === 1) return { product: active[0], styleOnly: false };
  if (active.length > 1) return { product: null, styleOnly: true };

  const any = anyByStyle.get(styleIdStr) || [];
  if (any.length === 1) return { product: any[0], styleOnly: false };
  return { product: null, styleOnly: true };
};

const STYLE_PREFETCH_CHUNK = 150;

/**
 * Prefetch StyleCode docs for many distinct strings (case-insensitive), merged into one map keyed by UPPERCASE input.
 */
const prefetchStyleDocsByStrings = async (uniqueStyles) => {
  /** @type {Map<string, Record<string, unknown>>} */
  const byUpper = new Map();
  for (let i = 0; i < uniqueStyles.length; i += STYLE_PREFETCH_CHUNK) {
    const chunk = uniqueStyles.slice(i, i + STYLE_PREFETCH_CHUNK);
    const docs = await StyleCode.find({
      $or: chunk.map((s) => ({ styleCode: new RegExp(`^${escapeRegex(s)}$`, 'i') })),
    }).lean();
    for (const d of docs) {
      if (d?.styleCode) byUpper.set(String(d.styleCode).toUpperCase(), d);
    }
  }
  return byUpper;
};

/**
 * Style-only bulk import: a few DB round-trips + per-row save (no per-row style/product find, no populate).
 */
const bulkImportWarehouseInventoryStyleOnlyOptimized = async (items) => {
  const batchSize = BULK_IMPORT_BATCH_SIZE;
  const total = items.length;
  const batchCount = total === 0 ? 0 : Math.ceil(total / batchSize);

  const results = {
    total,
    batchSize,
    batchCount,
    created: 0,
    inserted: 0,
    merged: 0,
    failed: 0,
    notCreated: [],
    errors: [],
    batchResults: [],
    processingTime: 0,
  };
  const startTime = Date.now();

  const pushFailure = (globalIndex, batchNumber, indexInBatch, row, err) => {
    const reason = err instanceof ApiError ? err.message : err?.message || String(err);
    const entry = {
      index: globalIndex,
      batch: batchNumber,
      indexInBatch,
      reason,
      error: reason,
      factoryCode: row.factoryCode,
      articleNumber: row.articleNumber,
      styleCode: row.styleCode,
      itemId: row.itemId,
      styleCodeId: row.styleCodeId,
    };
    results.notCreated.push(entry);
    results.errors.push(entry);
  };

  const uniqueStyles = [...new Set(items.map((r) => String(r.styleCode ?? '').trim()).filter(Boolean))];
  const styleByUpper = await prefetchStyleDocsByStrings(uniqueStyles);

  const styleObjectIds = [
    ...new Set(
      uniqueStyles
        .map((s) => styleByUpper.get(s.toUpperCase())?._id)
        .filter(Boolean)
        .map((id) => String(id))
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));

  const [activeProducts, allProducts] = await Promise.all([
    styleObjectIds.length
      ? Product.find({ styleCodes: { $in: styleObjectIds }, status: 'active' }).lean()
      : [],
    styleObjectIds.length ? Product.find({ styleCodes: { $in: styleObjectIds } }).lean() : [],
  ]);
  const activeByStyle = indexProductsByStyleId(activeProducts);
  const anyByStyle = indexProductsByStyleId(allProducts);

  const invDocs =
    styleObjectIds.length > 0
      ? await WarehouseInventory.find({ styleCodeId: { $in: styleObjectIds } })
      : [];
  /** @type {Map<string, import('mongoose').Document>} */
  const invMap = new Map(invDocs.map((d) => [String(d.styleCodeId), d]));

  const upsertFromCache = async (clean, addTotal, addBlocked) => {
    const sid = String(clean.styleCodeId);
    let existing = invMap.get(sid);
    if (existing) {
      await applyWarehouseInventoryMerge(existing, clean, addTotal, addBlocked);
      return { wasMerged: true };
    }
    try {
      const doc = await WarehouseInventory.create(clean);
      await appendLogForNewInventoryDocument(doc);
      invMap.set(sid, doc);
      return { wasMerged: false };
    } catch (err) {
      if (err?.code === 11000) {
        const retry = await WarehouseInventory.findOne({ styleCodeId: clean.styleCodeId });
        if (retry) {
          await applyWarehouseInventoryMerge(retry, clean, addTotal, addBlocked);
          invMap.set(sid, retry);
          return { wasMerged: true };
        }
      }
      throw err;
    }
  };

  for (let b = 0; b < batchCount; b += 1) {
    const batchNumber = b + 1;
    const offset = b * batchSize;
    const chunk = items.slice(offset, offset + batchSize);

    let batchInserted = 0;
    let batchMerged = 0;
    let batchFailed = 0;

    for (let j = 0; j < chunk.length; j += 1) {
      const i = offset + j;
      const row = chunk[j];
      try {
        const styleTrim = String(row.styleCode ?? '').trim();
        const styleDoc = styleByUpper.get(styleTrim.toUpperCase());
        if (!styleDoc?._id) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Style code "${styleTrim}" is not registered; add it in Style Code master first`
          );
        }
        const sid = String(styleDoc._id);
        const { product, styleOnly } = pickProductForStyle(sid, activeByStyle, anyByStyle);

        const clean = {
          styleCodeId: styleDoc._id,
          styleCode: styleDoc.styleCode,
          styleCodeData: {
            styleCode: styleDoc.styleCode,
            eanCode: styleDoc.eanCode,
            mrp: styleDoc.mrp,
            brand: styleDoc.brand,
            pack: styleDoc.pack,
          },
          totalQuantity: Math.max(0, Number(row.totalQuantity ?? 0)),
          blockedQuantity: Math.max(0, Number(row.blockedQuantity ?? 0)),
        };
        if (!styleOnly && product) {
          clean.itemId = product._id;
          clean.itemData = {
            factoryCode: product.factoryCode,
            name: product.name,
            productId: String(product._id),
          };
        } else {
          clean.itemId = null;
          clean.itemData = undefined;
        }
        if (row.itemData && typeof row.itemData === 'object' && !Array.isArray(row.itemData)) {
          clean.itemData = clean.itemData ? { ...clean.itemData, ...row.itemData } : { ...row.itemData };
        }
        if (row.styleCodeData && typeof row.styleCodeData === 'object' && !Array.isArray(row.styleCodeData)) {
          clean.styleCodeData = { ...clean.styleCodeData, ...row.styleCodeData };
        }

        const addTotal = Math.max(0, Number(clean.totalQuantity ?? 0));
        const addBlocked = Math.max(0, Number(clean.blockedQuantity ?? 0));

        const { wasMerged } = await upsertFromCache(clean, addTotal, addBlocked);
        results.created += 1;
        if (wasMerged) {
          results.merged += 1;
          batchMerged += 1;
        } else {
          results.inserted += 1;
          batchInserted += 1;
        }
      } catch (error) {
        results.failed += 1;
        batchFailed += 1;
        pushFailure(i, batchNumber, j, row, error);
      }
    }

    results.batchResults.push({
      batch: batchNumber,
      fromIndex: offset,
      toIndex: offset + chunk.length - 1,
      rowCount: chunk.length,
      inserted: batchInserted,
      merged: batchMerged,
      failed: batchFailed,
    });
  }

  results.processingTime = Date.now() - startTime;
  return results;
};

export const createWarehouseInventory = async (body) => {
  const { record } = await upsertWarehouseInventory(body);
  return record;
};

/**
 * Bulk-create or merge warehouse inventory rows (e.g. Excel → JSON). Each element matches {@link createWarehouseInventory}.
 * Same article + same style resolves to one row: quantities are added, not a second document.
 * Processes **100 rows per batch** (sequential batches, sequential rows within a batch). Failures include **reason** and batch position.
 *
 * @param {Record<string, unknown>[]} items
 */
export const bulkImportWarehouseInventory = async (items) => {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    return {
      total: 0,
      batchSize: BULK_IMPORT_BATCH_SIZE,
      batchCount: 0,
      created: 0,
      inserted: 0,
      merged: 0,
      failed: 0,
      notCreated: [],
      errors: [],
      batchResults: [],
      processingTime: 0,
    };
  }

  if (list.every(isStyleOnlyBulkRow)) {
    return bulkImportWarehouseInventoryStyleOnlyOptimized(list);
  }

  const batchSize = BULK_IMPORT_BATCH_SIZE;
  const total = list.length;
  const batchCount = Math.ceil(total / batchSize);

  const results = {
    total,
    batchSize,
    batchCount,
    /** Rows processed successfully (insert + merge) */
    created: 0,
    inserted: 0,
    merged: 0,
    failed: 0,
    /** Rows that were not created/updated, with human-readable `reason` */
    notCreated: [],
    /** @deprecated use `notCreated` — same entries; kept for older clients */
    errors: [],
    /** Per-batch success/failure counts (batch is 1-based) */
    batchResults: [],
    processingTime: 0,
  };
  const startTime = Date.now();

  const pushFailure = (globalIndex, batchNumber, indexInBatch, row, err) => {
    const reason = err instanceof ApiError ? err.message : err?.message || String(err);
    const entry = {
      index: globalIndex,
      batch: batchNumber,
      indexInBatch,
      reason,
      error: reason,
      factoryCode: row.factoryCode,
      articleNumber: row.articleNumber,
      styleCode: row.styleCode,
      itemId: row.itemId,
      styleCodeId: row.styleCodeId,
    };
    results.notCreated.push(entry);
    results.errors.push(entry);
  };

  for (let b = 0; b < batchCount; b += 1) {
    const batchNumber = b + 1;
    const offset = b * batchSize;
    const chunk = list.slice(offset, offset + batchSize);

    let batchInserted = 0;
    let batchMerged = 0;
    let batchFailed = 0;

    for (let j = 0; j < chunk.length; j += 1) {
      const i = offset + j;
      const row = chunk[j];
      try {
        const { wasMerged } = await upsertWarehouseInventory(row);
        results.created += 1;
        if (wasMerged) {
          results.merged += 1;
          batchMerged += 1;
        } else {
          results.inserted += 1;
          batchInserted += 1;
        }
      } catch (error) {
        results.failed += 1;
        batchFailed += 1;
        pushFailure(i, batchNumber, j, row, error);
      }
    }

    results.batchResults.push({
      batch: batchNumber,
      fromIndex: offset,
      toIndex: offset + chunk.length - 1,
      rowCount: chunk.length,
      inserted: batchInserted,
      merged: batchMerged,
      failed: batchFailed,
    });
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
