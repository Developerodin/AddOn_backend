import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { WarehouseClient, WarehouseOrder } from '../../models/whms/index.js';
import StyleCode from '../../models/styleCode.model.js';
import StyleCodePairs from '../../models/styleCodePairs.model.js';
import {
  createPickListForOrder,
  syncPickListForOrderLineItems,
  syncPickListOrderMetadata,
} from './pickList.service.js';

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
  if (query.addonOrderId && String(query.addonOrderId).trim()) {
    filter.addonOrderId = new RegExp(`^${escapeRegex(String(query.addonOrderId).trim())}`, 'i');
  }

  if (query.q && String(query.q).trim()) {
    const term = escapeRegex(String(query.q).trim());
    const regex = new RegExp(term, 'i');
    filter.$or = [{ orderNumber: regex }, { clientName: regex }, { addonOrderId: regex }];
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

/** Auto-fill styleCode strings on line items when the client only sends ids (create/update). */
const enrichWarehouseOrderStyleCodes = async (payload) => {
  if (!payload || typeof payload !== 'object') return;

  const singleItems = Array.isArray(payload.styleCodeSinglePair) ? payload.styleCodeSinglePair : [];
  if (singleItems.length && singleItems.some((i) => !i?.styleCode)) {
    const ids = singleItems.map((i) => i?.styleCodeId).filter(Boolean);
    const rows = await StyleCode.find({ _id: { $in: ids } }).select('styleCode');
    const byId = new Map(rows.map((r) => [String(r._id), r.styleCode]));
    payload.styleCodeSinglePair = singleItems.map((i) => ({
      ...i,
      styleCode: i.styleCode || byId.get(String(i.styleCodeId)) || '',
    }));
  }

  const multiItems = Array.isArray(payload.styleCodeMultiPair) ? payload.styleCodeMultiPair : [];
  if (multiItems.length && multiItems.some((i) => !i?.styleCode)) {
    const ids = multiItems.map((i) => i?.styleCodeMultiPairId).filter(Boolean);
    const rows = await StyleCodePairs.find({ _id: { $in: ids } }).select('pairStyleCode');
    const byId = new Map(rows.map((r) => [String(r._id), r.pairStyleCode]));
    payload.styleCodeMultiPair = multiItems.map((i) => ({
      ...i,
      styleCode: i.styleCode || byId.get(String(i.styleCodeMultiPairId)) || '',
    }));
  }
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

  await enrichWarehouseOrderStyleCodes(body);

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

  const lineItemsTouched =
    Object.prototype.hasOwnProperty.call(updateBody, 'styleCodeSinglePair') ||
    Object.prototype.hasOwnProperty.call(updateBody, 'styleCodeMultiPair');

  if (lineItemsTouched) {
    await enrichWarehouseOrderStyleCodes(updateBody);
  }

  Object.assign(doc, updateBody);
  await doc.save();

  if (lineItemsTouched) {
    await syncPickListForOrderLineItems(doc);
  } else {
    await syncPickListOrderMetadata(doc);
  }

  return getWarehouseOrderById(id);
};

export const deleteWarehouseOrderById = async (id) => {
  const doc = await WarehouseOrder.findByIdAndDelete(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');
  return doc;
};

/**
 * Parse date strings like "17/02/2026", "17-02-2026" (DD/MM/YYYY or DD-MM-YYYY),
 * Excel serial numbers (e.g. 46123), or ISO strings.  Returns a Date or null.
 */
const parseFlexibleDate = (raw) => {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  const str = String(raw).trim();

  const ddmmyyyy = str.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (ddmmyyyy) return new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`);

  // Excel serial date (pure digits, typically 5-digit range)
  if (/^\d{4,6}$/.test(str)) {
    const serial = Number(str);
    if (serial > 0) {
      const EXCEL_EPOCH = new Date(Date.UTC(1899, 11, 30)).getTime();
      return new Date(EXCEL_EPOCH + serial * 86400000);
    }
  }

  const iso = new Date(str);
  return Number.isNaN(iso.getTime()) ? null : iso;
};

/**
 * Resolve a WarehouseClient by name + type.
 * For Store clients the name is matched against storeProfile.brand / billCode / sapCode.
 * For other types it is matched against retailerName or distributorName.
 */
const resolveClientByName = async (clientName, clientType) => {
  const name = String(clientName).trim();
  if (!name) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped}$`, 'i');

  const filter = { type: clientType };
  if (clientType === 'Store') {
    filter.$or = [
      { 'storeProfile.brand': regex },
      { 'storeProfile.billCode': regex },
      { 'storeProfile.sapCode': regex },
    ];
  } else {
    filter.$or = [{ retailerName: regex }, { distributorName: regex }];
  }

  return WarehouseClient.findOne(filter).lean();
};

/**
 * Bulk-import warehouse orders from a flat array (typically from an Excel/CSV upload).
 *
 * Each row accepts human-readable values:
 *  - clientType (string, e.g. "Store")
 *  - clientName (string — resolved to clientId)
 *  - date (DD/MM/YYYY or DD-MM-YYYY)
 *  - status (string)
 *  - addonOrderId (optional — external / customer Addon order reference)
 *  - styleCodeSinglePair[].styleCode (code string — resolved to styleCodeId, pack & type auto-filled)
 *  - styleCodeMultiPair[].styleCode  (code string — resolved to styleCodeMultiPairId, pack auto-filled)
 */
export const bulkImportWarehouseOrders = async (orders, batchSize = 50) => {
  const results = {
    total: orders.length,
    created: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };
  const startTime = Date.now();

  // ── Pre-fetch look-up maps so we don't hit DB per-row ──
  const allSingleCodes = new Set();
  const allMultiCodes = new Set();
  for (const row of orders) {
    (row.styleCodeSinglePair || []).forEach((i) => { if (i?.styleCode) allSingleCodes.add(String(i.styleCode).trim()); });
    (row.styleCodeMultiPair || []).forEach((i) => { if (i?.styleCode) allMultiCodes.add(String(i.styleCode).trim()); });
  }

  const [singleDocs, multiDocs] = await Promise.all([
    allSingleCodes.size ? StyleCode.find({ styleCode: { $in: [...allSingleCodes] } }).lean() : [],
    allMultiCodes.size ? StyleCodePairs.find({ pairStyleCode: { $in: [...allMultiCodes] } }).lean() : [],
  ]);

  const singleByCode = new Map(singleDocs.map((d) => [d.styleCode, d]));
  const multiByCode = new Map(multiDocs.map((d) => [d.pairStyleCode, d]));

  // ── Process orders strictly one-by-one to keep orderNumber unique ──
  for (let i = 0; i < orders.length; i += 1) {
    const row = orders[i];
    try {
      if (!row.clientType) throw new Error('clientType is required');
      if (!row.clientName) throw new Error('clientName is required');

      const client = await resolveClientByName(row.clientName, row.clientType);
      if (!client) throw new Error(`Client "${row.clientName}" not found for type "${row.clientType}"`);

      const clientName =
        client.type === 'Store'
          ? client.storeProfile?.brand || client.storeProfile?.billCode || client.storeProfile?.sapCode || 'Store'
          : client.retailerName || client.distributorName || 'Client';

      const parsedDate = parseFlexibleDate(row.date);

      const singleItems = (row.styleCodeSinglePair || []).map((item, sIdx) => {
        const code = String(item.styleCode || '').trim();
        const doc = singleByCode.get(code);
        if (!doc) throw new Error(`Single-pair styleCode "${code}" not found (item ${sIdx + 1})`);
        return {
          styleCodeId: doc._id,
          styleCode: doc.styleCode,
          pack: doc.pack || '',
          type: doc.brand || '',
          colour: item.colour || item.color || '',
          pattern: item.pattern || '',
          quantity: Number(item.quantity),
        };
      });

      const multiItems = (row.styleCodeMultiPair || []).map((item, mIdx) => {
        const code = String(item.styleCode || '').trim();
        const doc = multiByCode.get(code);
        if (!doc) throw new Error(`Multi-pair styleCode "${code}" not found (item ${mIdx + 1})`);
        return {
          styleCodeMultiPairId: doc._id,
          styleCode: doc.pairStyleCode,
          pack: String(doc.pack || ''),
          type: item.type || '',
          colour: item.colour || item.color || '',
          pattern: item.pattern || '',
          quantity: Number(item.quantity),
        };
      });

      if (singleItems.length + multiItems.length === 0) {
        throw new Error('Order must have at least one style-code item');
      }

      const orderNumber = await generateWarehouseOrderNumber();
      const addonOrderId =
        row.addonOrderId != null && String(row.addonOrderId).trim() ? String(row.addonOrderId).trim() : undefined;

      const created = await WarehouseOrder.create({
        orderNumber,
        date: parsedDate || new Date(),
        clientType: row.clientType,
        clientId: client._id,
        clientName,
        ...(addonOrderId !== undefined ? { addonOrderId } : {}),
        styleCodeSinglePair: singleItems,
        styleCodeMultiPair: multiItems,
        status: row.status || 'pending',
      });

      await createPickListForOrder(created);
      results.created += 1;
    } catch (error) {
      results.failed += 1;
      results.errors.push({
        index: i,
        clientName: row.clientName,
        error: error.message,
      });
    }
  }

  results.processingTime = Date.now() - startTime;
  return results;
};
