import mongoose from 'mongoose';
import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import pick from '../../utils/pick.js';
import Product from '../../models/product.model.js';
import { InwardReceive } from '../../models/whms/index.js';
import { reconcileInwardReceiveWarehouseInventory } from './inwardReceiveWarehouseInventory.helper.js';
import { promoteVendorDispatchToInwardReceive as promoteVendorDispatchToInwardReceiveHelper } from './inwardReceiveFromVendorDispatch.helper.js';

/** Fields the frontend (WHMS) may PATCH — not articleId/orderId/refs. */
const INWARD_RECEIVE_PATCH_KEYS = [
  'receivedQuantity',
  'status',
  'styleCode',
  'brand',
  'orderData',
  'receivedAt',
  'QuantityFromFactory',
];

const POPULATE_DEFAULT = [
  { path: 'articleId', select: 'articleNumber id status plannedQuantity' },
  { path: 'orderId', select: 'orderNumber status currentFloor priority' },
  {
    path: 'vendorProductionFlowId',
    select: 'referenceCode plannedQuantity vendor vendorPurchaseOrder product currentFloorKey',
  },
  { path: 'vendorPurchaseOrderId', select: 'vpoNumber currentStatus vendorName total' },
];

/**
 * Build Mongo filter from list query (exact ids, partial text, date range on createdAt / receivedAt).
 * @param {Record<string, unknown>} query
 * @returns {Record<string, unknown>}
 */
export const buildInwardReceiveFilter = (query) => {
  const filter = {};

  if (query.status) filter.status = query.status;
  if (query.inwardSource) filter.inwardSource = query.inwardSource;
  if (query.articleId && mongoose.Types.ObjectId.isValid(query.articleId)) {
    filter.articleId = new mongoose.Types.ObjectId(query.articleId);
  }
  if (query.orderId && mongoose.Types.ObjectId.isValid(query.orderId)) {
    filter.orderId = new mongoose.Types.ObjectId(query.orderId);
  }
  if (query.vendorProductionFlowId && mongoose.Types.ObjectId.isValid(query.vendorProductionFlowId)) {
    filter.vendorProductionFlowId = new mongoose.Types.ObjectId(query.vendorProductionFlowId);
  }
  if (query.vendorPurchaseOrderId && mongoose.Types.ObjectId.isValid(query.vendorPurchaseOrderId)) {
    filter.vendorPurchaseOrderId = new mongoose.Types.ObjectId(query.vendorPurchaseOrderId);
  }
  if (query.articleNumber && String(query.articleNumber).trim()) {
    filter.articleNumber = { $regex: String(query.articleNumber).trim(), $options: 'i' };
  }
  if (query.styleCode && String(query.styleCode).trim()) {
    filter.styleCode = { $regex: String(query.styleCode).trim(), $options: 'i' };
  }
  if (query.brand && String(query.brand).trim()) {
    filter.brand = { $regex: String(query.brand).trim(), $options: 'i' };
  }

  const useReceivedAt = query.dateField === 'receivedAt';
  const from = query.receivedAtFrom || query.dateFrom;
  const to = query.receivedAtTo || query.dateTo;
  if (from || to) {
    const range = {};
    if (from) range.$gte = new Date(from);
    if (to) range.$lte = new Date(to);
    filter[useReceivedAt ? 'receivedAt' : 'createdAt'] = range;
  }

  return filter;
};

/**
 * WHMS gate: materialize vendor inward queue rows from `dispatch.receivedData`.
 * Call after warehouse scans the same container (or without barcode for confirm-only lines).
 */
export const promoteVendorDispatchToInwardReceive = async (vendorProductionFlowId, options = {}) => {
  return promoteVendorDispatchToInwardReceiveHelper(vendorProductionFlowId, options);
};

export const createInwardReceive = async (body) => {
  const clean = { ...body };
  delete clean.warehouseInventoryCreditedQty;

  const record = await InwardReceive.create(clean);
  try {
    const previous = { warehouseInventoryCreditedQty: 0 };
    const { warehouseInventoryCreditedQty } = await reconcileInwardReceiveWarehouseInventory(
      previous,
      record.toObject()
    );
    await InwardReceive.updateOne({ _id: record._id }, { $set: { warehouseInventoryCreditedQty } });
  } catch (err) {
    await InwardReceive.deleteOne({ _id: record._id });
    throw err;
  }
  return record;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Resolve `vendorCode` for vendor-source inward rows (keyed on `articleNumber` = Product.factoryCode)
 * and attach it as a top-level field so the WHMS inward screen can show the vendor's own code.
 * Production-source rows are left untouched (they have only a factory code).
 * @param {{ results?: Array<Object> }} paginated
 */
const attachVendorCodesToInwardRows = async (paginated) => {
  const rows = paginated?.results || [];
  if (!rows.length) return;
  const codes = [
    ...new Set(
      rows
        .filter((r) => String(r.inwardSource) === 'vendor' && r.articleNumber)
        .map((r) => String(r.articleNumber).trim())
        .filter(Boolean)
    ),
  ];
  const codeToVendor = new Map();
  if (codes.length) {
    const products = await Product.find({
      $or: codes.map((c) => ({ factoryCode: new RegExp(`^${escapeRegex(c)}$`, 'i') })),
    })
      .select('factoryCode vendorCode')
      .lean();
    for (const product of products) {
      const fc = String(product.factoryCode ?? '').trim().toLowerCase();
      if (fc) codeToVendor.set(fc, String(product.vendorCode ?? '').trim());
    }
  }
  paginated.results = rows.map((row) => {
    const obj = row?.toJSON ? row.toJSON() : row;
    if (String(obj.inwardSource) === 'vendor') {
      obj.vendorCode = codeToVendor.get(String(obj.articleNumber ?? '').trim().toLowerCase()) || '';
    }
    return obj;
  });
};

export const queryInwardReceives = async (filter, options) => {
  const result = await InwardReceive.paginate(filter, {
    ...options,
    populate: options.populate ?? POPULATE_DEFAULT,
  });
  await attachVendorCodesToInwardRows(result);
  return result;
};

export const getInwardReceiveById = async (id) => {
  return InwardReceive.findById(id).populate(POPULATE_DEFAULT);
};

export const updateInwardReceiveById = async (id, updateBody) => {
  const doc = await InwardReceive.findById(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Inward receive not found');
  const patch = pick(updateBody, INWARD_RECEIVE_PATCH_KEYS);
  delete patch.warehouseInventoryCreditedQty;
  if (Object.keys(patch).length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No updatable fields provided (use receivedQuantity, status, etc.)');
  }

  const previous = {
    status: doc.status,
    receivedQuantity: doc.receivedQuantity,
    warehouseInventoryCreditedQty: doc.warehouseInventoryCreditedQty ?? 0,
    styleCode: doc.styleCode,
    articleNumber: doc.articleNumber,
  };

  Object.assign(doc, patch);
  const { warehouseInventoryCreditedQty } = await reconcileInwardReceiveWarehouseInventory(previous, doc.toObject());
  doc.warehouseInventoryCreditedQty = warehouseInventoryCreditedQty;
  await doc.save();
  return getInwardReceiveById(id);
};

export const deleteInwardReceiveById = async (id) => {
  const doc = await InwardReceive.findByIdAndDelete(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Inward receive not found');
  return doc;
};
