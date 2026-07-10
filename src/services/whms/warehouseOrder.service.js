import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { WarehouseClient, WarehouseOrder } from '../../models/whms/index.js';
import { flowStatusForCoarseStatus } from '../../models/whms/warehouseOrder.model.js';
import StyleCode from '../../models/styleCode.model.js';
import StyleCodePairs from '../../models/styleCodePairs.model.js';
import Product from '../../models/product.model.js';
import WarehouseInventory from '../../models/whms/warehouseInventory.model.js';
import {
  createPickListForOrder,
  syncPickListForOrderLineItems,
  syncPickListOrderMetadata,
} from './pickList.service.js';
import {
  notifyWebsiteFromOrderAsync,
  isWebsiteSourcedOrder,
} from '../integrations/websiteOrderOutbound.service.js';
import {
  buildArticleAttrsByStyleCodeId,
  coalesceLineField,
} from './warehouseOrderCatalogEnrich.js';

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
 * - flowStatus (single), flowStatusIn (comma-separated, e.g. picking-done,barcode-in-progress)
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
  if (query.flowStatusIn && String(query.flowStatusIn).trim()) {
    const parts = String(query.flowStatusIn)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) filter.flowStatus = { $in: parts };
  } else if (query.flowStatus) {
    filter.flowStatus = query.flowStatus;
  }
  if (query.clientType) filter.clientType = query.clientType;
  if (query.clientId) filter.clientId = query.clientId;
  if (query.orderNumber && String(query.orderNumber).trim()) {
    filter.orderNumber = new RegExp(`^${escapeRegex(String(query.orderNumber).trim())}`, 'i');
  }
  if (query.addonOrderId && String(query.addonOrderId).trim()) {
    filter.addonOrderId = new RegExp(`^${escapeRegex(String(query.addonOrderId).trim())}`, 'i');
  }
  if (query.source && String(query.source).trim()) {
    filter['meta.source'] = String(query.source).trim();
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

/**
 * Auto-fill styleCode strings and catalogue colour/pattern/type on line items (create/update).
 * User-entered values are preserved via coalesceLineField.
 * @param {object} payload
 * @returns {Promise<void>}
 */
const enrichWarehouseOrderLineItems = async (payload) => {
  if (!payload || typeof payload !== 'object') return;

  const singleItems = Array.isArray(payload.styleCodeSinglePair) ? payload.styleCodeSinglePair : [];
  const multiItems = Array.isArray(payload.styleCodeMultiPair) ? payload.styleCodeMultiPair : [];

  if (!singleItems.length && !multiItems.length) return;

  const singleIds = singleItems.map((i) => i?.styleCodeId).filter(Boolean);
  const multiIds = multiItems.map((i) => i?.styleCodeMultiPairId).filter(Boolean);

  const [singleDocs, multiDocs] = await Promise.all([
    singleIds.length
      ? StyleCode.find({ _id: { $in: singleIds } }).select('styleCode brand pack').lean()
      : [],
    multiIds.length
      ? StyleCodePairs.find({ _id: { $in: multiIds } }).select('pairStyleCode pack styleCodes').lean()
      : [],
  ]);

  const singleById = new Map(singleDocs.map((d) => [String(d._id), d]));
  const multiById = new Map(multiDocs.map((d) => [String(d._id), d]));

  const linkedStyleCodeIds = new Set(singleIds.map(String));
  multiDocs.forEach((d) => {
    (d.styleCodes || []).forEach((id) => linkedStyleCodeIds.add(String(id)));
  });

  const missingLinkedIds = [...linkedStyleCodeIds].filter((id) => !singleById.has(id));
  const linkedStyleDocs =
    missingLinkedIds.length > 0
      ? await StyleCode.find({ _id: { $in: missingLinkedIds } }).select('styleCode brand pack').lean()
      : [];
  const styleCodeById = new Map([
    ...singleDocs.map((d) => [String(d._id), d]),
    ...linkedStyleDocs.map((d) => [String(d._id), d]),
  ]);

  const articleAttrsByStyleCodeId = await buildArticleAttrsByStyleCodeId([...linkedStyleCodeIds]);

  if (singleItems.length) {
    payload.styleCodeSinglePair = singleItems.map((item) => {
      const doc = singleById.get(String(item.styleCodeId));
      const catalogAttrs = articleAttrsByStyleCodeId.get(String(item.styleCodeId)) || {
        colour: '',
        pattern: '',
      };
      return {
        ...item,
        styleCode: item.styleCode || doc?.styleCode || '',
        pack: coalesceLineField(item.pack, doc?.pack),
        type: coalesceLineField(item.type, doc?.brand),
        colour: coalesceLineField(item.colour || item.color, catalogAttrs.colour),
        pattern: coalesceLineField(item.pattern, catalogAttrs.pattern),
      };
    });
  }

  if (multiItems.length) {
    payload.styleCodeMultiPair = multiItems.map((item) => {
      const doc = multiById.get(String(item.styleCodeMultiPairId));
      return {
        ...item,
        styleCode: item.styleCode || doc?.pairStyleCode || '',
        pack: coalesceLineField(item.pack, doc?.pack != null ? String(doc.pack) : ''),
        colour: '',
        type: '',
        pattern: '',
      };
    });
  }
};

/**
 * Batch-resolve catalogue colour/pattern and row diagnostics for style-code ids (WHMS UI).
 * @param {string[]} styleCodeIds
 * @returns {Promise<Record<string, {
 *   colour: string;
 *   pattern: string;
 *   styleCode: string;
 *   styleCodeExists: boolean;
 *   hasLinkedProduct: boolean;
 *   availableStock: number;
 * }>>}
 */
export const getCatalogueAttrsByStyleCodeIds = async (styleCodeIds) => {
  const uniqueIds = [...new Set(styleCodeIds.map(String).filter(Boolean))];
  const out = {};
  if (!uniqueIds.length) return out;

  const [attrsMap, styleCodeDocs, stockDocs, linkedProducts] = await Promise.all([
    buildArticleAttrsByStyleCodeId(uniqueIds),
    StyleCode.find({ _id: { $in: uniqueIds } }).select('_id styleCode').lean(),
    WarehouseInventory.find({ styleCodeId: { $in: uniqueIds } })
      .select('styleCodeId availableQuantity')
      .lean(),
    Product.find({ styleCodes: { $in: uniqueIds } }).select('styleCodes').lean(),
  ]);

  const styleCodeById = new Map(styleCodeDocs.map((doc) => [String(doc._id), doc]));
  const stockById = new Map(
    stockDocs.map((doc) => [String(doc.styleCodeId), Number(doc.availableQuantity) || 0])
  );
  const linkedProductIds = new Set();
  for (const product of linkedProducts) {
    for (const scId of product.styleCodes || []) {
      linkedProductIds.add(String(scId));
    }
  }

  for (const id of uniqueIds) {
    const attrs = attrsMap.get(id) || { colour: '', pattern: '' };
    const styleDoc = styleCodeById.get(id);
    out[id] = {
      colour: attrs.colour || '',
      pattern: attrs.pattern || '',
      styleCode: styleDoc?.styleCode || '',
      styleCodeExists: Boolean(styleDoc),
      hasLinkedProduct: linkedProductIds.has(id),
      availableStock: stockById.get(id) ?? 0,
    };
  }
  return out;
};

export const createWarehouseOrder = async (body) => {
  if (!body.orderNumber) body.orderNumber = await generateWarehouseOrderNumber();

  const client = await WarehouseClient.findById(body.clientId).select('type retailerName parentKeyCode storeProfile');
  if (!client) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid clientId');
  if (client.type !== body.clientType) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'clientType does not match clientId');
  }

  const clientName =
    client.type === 'Store'
      ? client.storeProfile?.brand || client.storeProfile?.billCode || client.storeProfile?.sapCode || 'Store'
      : client.retailerName || client.parentKeyCode || 'Client';

  await enrichWarehouseOrderLineItems(body);

  const doc = await WarehouseOrder.create({
    ...body,
    clientName,
    ...(body.status ? { flowStatus: flowStatusForCoarseStatus(body.status) } : {}),
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
    await enrichWarehouseOrderLineItems(updateBody);
  }

  // Legacy status edits (old UI) keep flowStatus roughly in sync. Granular stage moves
  // must use the flow-status endpoint (orderFlow.service), which owns flowHistory.
  if (updateBody.status !== undefined && updateBody.flowStatus === undefined) {
    updateBody.flowStatus = flowStatusForCoarseStatus(updateBody.status);
  }

  Object.assign(doc, updateBody);
  await doc.save();

  if (
    (updateBody.status === 'cancelled' || doc.flowStatus === 'cancelled') &&
    isWebsiteSourcedOrder(doc)
  ) {
    await notifyWebsiteFromOrderAsync(doc, 'status_update');
  }

  if (lineItemsTouched) {
    await syncPickListForOrderLineItems(doc);
  } else {
    await syncPickListOrderMetadata(doc);
  }

  return getWarehouseOrderById(id);
};

export const deleteWarehouseOrderById = async (id) => {
  const doc = await WarehouseOrder.findById(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');

  const meta = doc.meta && typeof doc.meta.toObject === 'function' ? doc.meta.toObject() : doc.meta || {};
  if (meta.source === 'addonweb') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Website orders cannot be deleted. Cancel the order instead to sync with the website.'
    );
  }

  await WarehouseOrder.findByIdAndDelete(id);
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

const WAREHOUSE_CLIENT_TYPES = new Set(['Store', 'Trade', 'Departmental', 'Ecom']);

/**
 * Normalize bulk-import client type strings (e.g. "store" → "Store").
 * @param {string} raw
 * @returns {string|null}
 */
const normalizeBulkImportClientType = (raw) => {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const title = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  if (WAREHOUSE_CLIENT_TYPES.has(title)) return title;
  if (v === 'Departmental' || /^departmental$/i.test(v)) return 'Departmental';
  if (/^ecom$/i.test(v)) return 'Ecom';
  return WAREHOUSE_CLIENT_TYPES.has(v) ? v : null;
};

/**
 * Find WarehouseClient docs by display name + type (may return multiple when names collide).
 * Store: storeProfile.brand / billCode / sapCode / retekCode.
 * Other types: retailerName or parentKeyCode (SAP code).
 */
const findClientsByName = async (clientName, clientType) => {
  const name = String(clientName).trim();
  if (!name) return [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped}$`, 'i');

  const filter = { type: clientType };
  if (clientType === 'Store') {
    filter.$or = [
      { 'storeProfile.brand': regex },
      { 'storeProfile.billCode': regex },
      { 'storeProfile.sapCode': regex },
      { 'storeProfile.retekCode': regex },
    ];
  } else {
    filter.$or = [{ retailerName: regex }, { parentKeyCode: regex }];
  }

  return WarehouseClient.find(filter).lean();
};

/**
 * Resolve client for bulk import — prefer explicit MongoDB clientId; fall back to name with duplicate guard.
 * @param {{ clientId?: string, clientName?: string, clientType: string }} row
 */
const resolveClientForBulkImport = async (row) => {
  const clientType = normalizeBulkImportClientType(row.clientType);
  if (!clientType) throw new Error(`Invalid clientType "${row.clientType}"`);

  const clientId = row.clientId != null ? String(row.clientId).trim() : '';
  if (clientId) {
    const client = await WarehouseClient.findById(clientId).lean();
    if (!client) throw new Error(`Client id "${clientId}" not found`);
    if (client.type !== clientType) {
      throw new Error(`clientType "${clientType}" does not match client id "${clientId}" (actual: ${client.type})`);
    }
    return { client, clientType };
  }

  const clientName = String(row.clientName ?? '').trim();
  if (!clientName) throw new Error('Either clientId or clientName is required');

  const matches = await findClientsByName(clientName, clientType);
  if (matches.length === 0) {
    throw new Error(`Client "${clientName}" not found for type "${clientType}"`);
  }
  if (matches.length > 1) {
    const ids = matches.map((c) => String(c._id)).join(', ');
    throw new Error(
      `Multiple clients (${matches.length}) match "${clientName}" for type "${clientType}". ` +
        `Use clientId to disambiguate. Matching ids: ${ids}`
    );
  }

  return { client: matches[0], clientType };
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
 *  - styleCodeSinglePair[].styleCode (code string — resolved to styleCodeId; pack, type, colour, pattern auto-filled from catalogue)
 *  - styleCodeMultiPair[].styleCode  (code string — resolved to styleCodeMultiPairId; pack, type, colour, pattern auto-filled when omitted)
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

  const linkedStyleCodeIds = new Set();
  multiDocs.forEach((d) => {
    (d.styleCodes || []).forEach((id) => linkedStyleCodeIds.add(String(id)));
  });

  const missingLinkedIds = [...linkedStyleCodeIds].filter(
    (id) => !singleDocs.some((d) => String(d._id) === id),
  );
  const linkedStyleDocs =
    missingLinkedIds.length > 0
      ? await StyleCode.find({ _id: { $in: missingLinkedIds } }).lean()
      : [];
  const styleCodeById = new Map(
    [...singleDocs, ...linkedStyleDocs].map((d) => [String(d._id), d]),
  );

  const articleAttrsByStyleCodeId = await buildArticleAttrsByStyleCodeId([
    ...singleDocs.map((d) => String(d._id)),
    ...linkedStyleCodeIds,
  ]);

  // ── Process orders strictly one-by-one to keep orderNumber unique ──
  for (let i = 0; i < orders.length; i += 1) {
    const row = orders[i];
    try {
      if (!row.clientType) throw new Error('clientType is required');

      const { client, clientType } = await resolveClientForBulkImport(row);

      const clientName =
        client.type === 'Store'
          ? client.storeProfile?.brand ||
            client.storeProfile?.billCode ||
            client.storeProfile?.sapCode ||
            client.storeProfile?.retekCode ||
            'Store'
          : client.retailerName || client.parentKeyCode || 'Client';

      const parsedDate = parseFlexibleDate(row.date);

      const singleItems = (row.styleCodeSinglePair || []).map((item, sIdx) => {
        const code = String(item.styleCode || '').trim();
        const doc = singleByCode.get(code);
        if (!doc) throw new Error(`Single-pair styleCode "${code}" not found (item ${sIdx + 1})`);
        const catalogAttrs = articleAttrsByStyleCodeId.get(String(doc._id)) || {
          colour: '',
          pattern: '',
        };
        return {
          styleCodeId: doc._id,
          styleCode: doc.styleCode,
          pack: doc.pack || '',
          type: coalesceLineField(item.type, doc.brand),
          colour: coalesceLineField(item.colour || item.color, catalogAttrs.colour),
          pattern: coalesceLineField(item.pattern, catalogAttrs.pattern),
          quantity: Number(item.quantity),
        };
      });

      const multiItems = (row.styleCodeMultiPair || []).map((item, mIdx) => {
        const code = String(item.styleCode || '').trim();
        const doc = multiByCode.get(code);
        if (!doc) throw new Error(`Multi-pair styleCode "${code}" not found (item ${mIdx + 1})`);
        const firstLinkedId = doc.styleCodes?.[0] ? String(doc.styleCodes[0]) : '';
        const linkedStyle = firstLinkedId ? styleCodeById.get(firstLinkedId) : null;
        const catalogAttrs = firstLinkedId
          ? articleAttrsByStyleCodeId.get(firstLinkedId) || { colour: '', pattern: '' }
          : { colour: '', pattern: '' };
        return {
          styleCodeMultiPairId: doc._id,
          styleCode: doc.pairStyleCode,
          pack: String(doc.pack || ''),
          type: coalesceLineField(item.type, linkedStyle?.brand),
          colour: coalesceLineField(item.colour || item.color, catalogAttrs.colour),
          pattern: coalesceLineField(item.pattern, catalogAttrs.pattern),
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
        clientType,
        clientId: client._id,
        clientName,
        ...(addonOrderId !== undefined ? { addonOrderId } : {}),
        styleCodeSinglePair: singleItems,
        styleCodeMultiPair: multiItems,
        status: row.status || 'pending',
        flowStatus: flowStatusForCoarseStatus(row.status || 'pending'),
      });

      await createPickListForOrder(created);
      results.created += 1;
    } catch (error) {
      results.failed += 1;
      results.errors.push({
        index: i,
        row: i + 1,
        clientName: row.clientName,
        clientId: row.clientId,
        reason: error.message,
        error: error.message,
      });
    }
  }

  results.processingTime = Date.now() - startTime;
  return results;
};
