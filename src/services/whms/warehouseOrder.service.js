import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { WarehouseClient, WarehouseOrder } from '../../models/whms/index.js';
import { flowStatusForCoarseStatus } from '../../models/whms/warehouseOrder.model.js';
import StyleCode from '../../models/styleCode.model.js';
import StyleCodePairs from '../../models/styleCodePairs.model.js';
import Product from '../../models/product.model.js';
import WarehouseInventory from '../../models/whms/warehouseInventory.model.js';
import PickListBatch, { PickListBatchStatus } from '../../models/whms/pickListBatch.model.js';
import {
  createPickListForOrder,
  syncPickListForOrderLineItems,
  syncPickListOrderMetadata,
} from './pickList.service.js';
import {
  blockInventoryForWarehouseOrder,
  releaseInventoryBlockForWarehouseOrder,
  syncInventoryBlockForWarehouseOrderLineItems,
} from './warehouseOrderInventoryBlock.helper.js';
import PickList from '../../models/whms/pickList.model.js';
import {
  notifyWebsiteFromOrderAsync,
  isWebsiteSourcedOrder,
} from '../integrations/websiteOrderOutbound.service.js';
import {
  buildArticleAttrsByStyleCodeId,
  coalesceLineField,
} from './warehouseOrderCatalogEnrich.js';
import { generateWarehouseOrderNumber } from './warehouseOrderNumber.js';

export { bulkImportWarehouseOrders } from './warehouseOrderBulkImport.service.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
      ? StyleCode.find({ _id: { $in: singleIds } }).select('styleCode brand pack eanCode').lean()
      : [],
    multiIds.length
      ? StyleCodePairs.find({ _id: { $in: multiIds } }).select('pairStyleCode pack styleCodes eanCode').lean()
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
      ? await StyleCode.find({ _id: { $in: missingLinkedIds } }).select('styleCode brand pack eanCode').lean()
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
        eanCode: coalesceLineField(item.eanCode, doc?.eanCode),
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
        eanCode: coalesceLineField(item.eanCode, doc?.eanCode),
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
  await blockInventoryForWarehouseOrder(doc);

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

  if (lineItemsTouched && doc.activeBatchId) {
    const batch = await PickListBatch.findById(doc.activeBatchId).select('status batchNumber');
    if (batch && batch.status === PickListBatchStatus.PICKING) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Order line items cannot be edited while pick-list batch "${batch.batchNumber}" is active`
      );
    }
  }

  if (lineItemsTouched) {
    await enrichWarehouseOrderLineItems(updateBody);
  }

  // PATCH must not reset granular flowStatus when the coarse status bucket is unchanged
  // (edit form re-sends the same legacy status on every save). Cancel is the only lifecycle
  // change allowed here; granular stage moves use PATCH …/flow-status (orderFlow.service).
  if (updateBody.status !== undefined && updateBody.flowStatus === undefined) {
    const statusChanged = updateBody.status !== doc.status;
    if (!statusChanged) {
      delete updateBody.status;
    } else if (updateBody.status === 'cancelled') {
      updateBody.flowStatus = flowStatusForCoarseStatus('cancelled');
    } else {
      delete updateBody.status;
    }
  }

  const prevStatus = doc.status;
  const prevFlowStatus = doc.flowStatus;

  Object.assign(doc, updateBody);
  await doc.save();

  const isCancelledNow =
    doc.status === 'cancelled' || doc.flowStatus === 'cancelled';
  const wasCancelledBefore =
    prevStatus === 'cancelled' || prevFlowStatus === 'cancelled';

  if (isCancelledNow && !wasCancelledBefore) {
    await releaseInventoryBlockForWarehouseOrder(doc._id);
  } else if (lineItemsTouched && !isCancelledNow) {
    const previousPickRows = await PickList.find({ orderId: doc._id }).lean();
    await syncPickListForOrderLineItems(doc);
    await syncInventoryBlockForWarehouseOrderLineItems(doc, previousPickRows);
  } else if (lineItemsTouched) {
    await syncPickListForOrderLineItems(doc);
  } else {
    await syncPickListOrderMetadata(doc);
  }

  if (
    isCancelledNow &&
    isWebsiteSourcedOrder(doc)
  ) {
    await notifyWebsiteFromOrderAsync(doc, 'status_update');
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

  await releaseInventoryBlockForWarehouseOrder(doc._id);
  await WarehouseOrder.findByIdAndDelete(id);
  return doc;
};
