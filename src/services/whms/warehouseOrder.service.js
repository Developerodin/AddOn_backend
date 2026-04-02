import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { WarehouseClient, WarehouseOrder } from '../../models/whms/index.js';
import StyleCode from '../../models/styleCode.model.js';
import StyleCodePairs from '../../models/styleCodePairs.model.js';
import { createPickListForOrder } from './pickList.service.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const generateWarehouseOrderNumber = async () => {
  const last = await WarehouseOrder.findOne().sort({ createdAt: -1 }).select('orderNumber');
  // Parse only the trailing sequence from WO-YYYY-<seq> to avoid merging year digits.
  const match = String(last?.orderNumber || '').match(/^WO-\d{4}-(\d+)$/);
  const seq = match ? parseInt(match[1], 10) + 1 : 1;
  return `WO-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
};

/**
 * Supported query params (all optional):
 * - q: full-text-ish search over { orderNumber, clientName }
 * - dateFrom/dateTo: filter by order `date`
 * - createdFrom/createdTo: filter by document createdAt
 * - status (single), statusIn (comma-separated, e.g. pending,in-progress)
 * - clientType, clientId, orderNumber
 * - styleCodeId, styleCodeMultiPairId: filter orders containing those items
 */
export const buildWarehouseOrderFilter = (query) => {
  const filter = {};

  if (query.statusIn && String(query.statusIn).trim()) {
    const parts = String(query.statusIn)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) filter.status = { $in: parts };
  } else if (query.status) {
    filter.status = query.status;
  }
  if (query.clientType) filter.clientType = query.clientType;
  if (query.clientId) filter.clientId = query.clientId;
  if (query.orderNumber && String(query.orderNumber).trim()) {
    filter.orderNumber = new RegExp(`^${escapeRegex(String(query.orderNumber).trim())}`, 'i');
  }

  if (query.q && String(query.q).trim()) {
    const term = escapeRegex(String(query.q).trim());
    const regex = new RegExp(term, 'i');
    filter.$or = [{ orderNumber: regex }, { clientName: regex }];
  }

  if (query.dateFrom || query.dateTo) {
    filter.date = {};
    if (query.dateFrom) filter.date.$gte = new Date(query.dateFrom);
    if (query.dateTo) filter.date.$lte = new Date(query.dateTo);
  }

  if (query.createdFrom || query.createdTo) {
    filter.createdAt = {};
    if (query.createdFrom) filter.createdAt.$gte = new Date(query.createdFrom);
    if (query.createdTo) filter.createdAt.$lte = new Date(query.createdTo);
  }

  if (query.styleCodeId) {
    filter['styleCodeSinglePair.styleCodeId'] = query.styleCodeId;
  }
  if (query.styleCodeMultiPairId) {
    filter['styleCodeMultiPair.styleCodeMultiPairId'] = query.styleCodeMultiPairId;
  }

  return filter;
};

export const createWarehouseOrder = async (body) => {
  if (!body.orderNumber) body.orderNumber = await generateWarehouseOrderNumber();

  const client = await WarehouseClient.findById(body.clientId).select('type retailerName distributorName storeProfile');
  if (!client) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid clientId');
  if (client.type !== body.clientType) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'clientType does not match clientId');
  }

  const clientName =
    client.type === 'Store'
      ? client.storeProfile?.brand || client.storeProfile?.billCode || client.storeProfile?.sapCode || 'Store'
      : client.retailerName || client.distributorName || 'Client';

  // Auto-fill readable style codes if frontend only sends ids.
  const singleItems = Array.isArray(body.styleCodeSinglePair) ? body.styleCodeSinglePair : [];
  const multiItems = Array.isArray(body.styleCodeMultiPair) ? body.styleCodeMultiPair : [];

  if (singleItems.some((i) => !i?.styleCode)) {
    const ids = singleItems.map((i) => i?.styleCodeId).filter(Boolean);
    const rows = await StyleCode.find({ _id: { $in: ids } }).select('styleCode');
    const byId = new Map(rows.map((r) => [String(r._id), r.styleCode]));
    body.styleCodeSinglePair = singleItems.map((i) => ({
      ...i,
      styleCode: i.styleCode || byId.get(String(i.styleCodeId)) || '',
    }));
  }

  if (multiItems.some((i) => !i?.styleCode)) {
    const ids = multiItems.map((i) => i?.styleCodeMultiPairId).filter(Boolean);
    const rows = await StyleCodePairs.find({ _id: { $in: ids } }).select('pairStyleCode');
    const byId = new Map(rows.map((r) => [String(r._id), r.pairStyleCode]));
    body.styleCodeMultiPair = multiItems.map((i) => ({
      ...i,
      styleCode: i.styleCode || byId.get(String(i.styleCodeMultiPairId)) || '',
    }));
  }

  const doc = await WarehouseOrder.create({
    ...body,
    clientName,
  });

  await createPickListForOrder(doc);

  return WarehouseOrder.findById(doc._id).populate('clientId');
};

export const queryWarehouseOrders = async (filter, options) => {
  return WarehouseOrder.paginate(filter, {
    ...options,
    populate: 'clientId',
  });
};

export const getWarehouseOrderById = async (id) => {
  return WarehouseOrder.findById(id).populate('clientId');
};

export const updateWarehouseOrderById = async (id, updateBody) => {
  const doc = await WarehouseOrder.findById(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');

  if (updateBody.clientId !== undefined || updateBody.clientType !== undefined) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'clientId/clientType cannot be updated');
  }

  Object.assign(doc, updateBody);
  await doc.save();
  return getWarehouseOrderById(id);
};

export const deleteWarehouseOrderById = async (id) => {
  const doc = await WarehouseOrder.findByIdAndDelete(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');
  return doc;
};
