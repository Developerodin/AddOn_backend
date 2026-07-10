import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import WarehouseClient, { WarehouseClientType } from '../../models/whms/warehouseClient.model.js';
import WarehouseOrder, { WarehouseOrderFlowStatus } from '../../models/whms/warehouseOrder.model.js';
import StyleCode from '../../models/styleCode.model.js';
import WebsiteOrderSyncLog from '../../models/integrations/websiteOrderSyncLog.model.js';
import { createWarehouseClient } from '../whms/warehouseClient.service.js';
import { createWarehouseOrder } from '../whms/warehouseOrder.service.js';
import { transitionOrder } from '../whms/orderFlow.service.js';
import { notifyWebsiteFromOrder } from './websiteOrderOutbound.service.js';
import {
  buildClientPatchFromWebsite,
  buildWebsiteClientMeta,
  getTradeClientIncompleteFields,
  mergeWebsiteFieldsIntoClient,
} from './websiteOrderClientSync.util.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Extract option value by name (case-insensitive partial match).
 * @param {Array<{ name?: string, value?: string }>} options
 * @param {string} nameHint
 * @returns {string}
 */
const optionValue = (options, nameHint) => {
  if (!Array.isArray(options)) return '';
  const hint = nameHint.toLowerCase();
  const match = options.find((o) => String(o?.name || '').toLowerCase().includes(hint));
  return String(match?.value || '').trim();
};

/**
 * Map website product lines to warehouse single-pair line items.
 * @param {Array<object>} products
 * @returns {Promise<{ singlePair: object[], syncErrors: object[] }>}
 */
const mapLines = async (products) => {
  const singlePair = [];
  const syncErrors = [];

  for (const product of products || []) {
    const model = String(product?.model || '').trim();
    if (!model) {
      syncErrors.push({ model: '', reason: 'missing_model' });
      continue;
    }

    const styleDoc = await StyleCode.findOne({ styleCode: model }).select('_id styleCode pack brand').lean();
    if (!styleDoc) {
      syncErrors.push({ model, reason: 'style_code_not_found' });
      continue;
    }

    singlePair.push({
      styleCodeId: styleDoc._id,
      styleCode: styleDoc.styleCode,
      pack: optionValue(product.options, 'pack') || styleDoc.pack || '',
      colour: optionValue(product.options, 'color') || optionValue(product.options, 'colour'),
      quantity: Math.max(1, Number(product.quantity) || 1),
    });
  }

  return { singlePair, syncErrors };
};

/**
 * Apply website customer data to an existing or new Trade client document.
 * @param {import('mongoose').Document} client
 * @param {object} customer
 * @param {string} addonOrderId
 * @param {boolean} clientCreated
 */
const finalizeTradeClientFromWebsite = async (client, customer, addonOrderId, clientCreated) => {
  const patch = buildClientPatchFromWebsite(customer);
  mergeWebsiteFieldsIntoClient(client, patch);

  if (patch.parentKeyCode && !str(client.parentKeyCode)) {
    client.parentKeyCode = patch.parentKeyCode;
  }

  const incompleteFields = getTradeClientIncompleteFields(client);
  const meta = buildWebsiteClientMeta(customer, clientCreated, incompleteFields);
  client.meta = { ...(client.meta && typeof client.meta.toObject === 'function' ? client.meta.toObject() : client.meta || {}), ...meta };
  client.markModified('meta');

  if (clientCreated && !str(client.remarks)) {
    client.remarks = `Auto-created from addonweb order ${addonOrderId}`;
  }

  await client.save();
  return incompleteFields;
};

const str = (value) => String(value ?? '').trim();

/**
 * Resolve an existing Trade client or create one from website customer data.
 * @param {object} customer
 * @param {string} addonOrderId
 * @returns {Promise<{ client: object, clientCreated: boolean, clientIncompleteFields: string[] }>}
 */
const resolveOrCreateTradeClient = async (customer, addonOrderId) => {
  const patch = buildClientPatchFromWebsite(customer);
  const email = patch.email;
  const gstin = patch.gstin;
  const companyName = patch.retailerName;
  const opencartCustomerId = Number(customer?.opencartCustomerId) || 0;

  let client = null;

  if (opencartCustomerId) {
    client = await WarehouseClient.findOne({
      type: WarehouseClientType.TRADE,
      parentKeyCode: `OC-${opencartCustomerId}`,
    });
  }

  if (!client && email) {
    client = await WarehouseClient.findOne({
      type: WarehouseClientType.TRADE,
      email: new RegExp(`^${escapeRegex(email)}$`, 'i'),
    });
  }

  if (!client && gstin) {
    client = await WarehouseClient.findOne({ type: WarehouseClientType.TRADE, gstin });
  }

  if (!client && companyName) {
    client = await WarehouseClient.findOne({
      type: WarehouseClientType.TRADE,
      retailerName: new RegExp(`^${escapeRegex(companyName)}$`, 'i'),
    });
  }

  if (!companyName && !email) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'customer.companyName or customer.email is required');
  }

  if (client) {
    const incompleteFields = await finalizeTradeClientFromWebsite(client, customer, addonOrderId, false);
    return { client, clientCreated: false, clientIncompleteFields: incompleteFields };
  }

  const created = await createWarehouseClient({
    type: WarehouseClientType.TRADE,
    retailerName: companyName || email,
    contactPerson: patch.contactPerson,
    mobilePhone: patch.mobilePhone,
    email,
    address: patch.address,
    city: patch.city,
    zipCode: patch.zipCode,
    state: patch.state,
    gstin,
    parentKeyCode: patch.parentKeyCode,
    status: 'active',
    remarks: `Auto-created from addonweb order ${addonOrderId}`,
    meta: buildWebsiteClientMeta(customer, true, getTradeClientIncompleteFields(patch)),
  });

  const fresh = await WarehouseClient.findById(created._id || created.id);
  const incompleteFields = getTradeClientIncompleteFields(fresh);
  return { client: fresh, clientCreated: true, clientIncompleteFields: incompleteFields };
};

/**
 * Write an inbound sync audit log entry.
 * @param {object} entry
 */
const writeSyncLog = async (entry) => {
  try {
    await WebsiteOrderSyncLog.create(entry);
  } catch (e) {
    logger.error('Failed to write website sync log', e);
  }
};

/**
 * Ingest an approved website order into WHMS.
 * @param {object} payload
 * @returns {Promise<object>}
 */
export const ingestWebsiteOrder = async (payload) => {
  const addonOrderId = String(payload.addonOrderId || '').trim();
  if (!addonOrderId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'addonOrderId is required');
  }

  const existing = await WarehouseOrder.findOne({ addonOrderId }).select('_id status clientId');
  if (existing) {
    await writeSyncLog({
      addonOrderId,
      opencartOrderId: payload.opencartOrderId,
      direction: 'inbound',
      status: 'already_synced',
      warehouseOrderId: existing._id,
      warehouseClientId: existing.clientId,
    });
    return {
      status: 'already_synced',
      warehouseOrderId: String(existing._id),
      warehouseClientId: String(existing.clientId),
      clientCreated: false,
    };
  }

  try {
    const { client, clientCreated, clientIncompleteFields } = await resolveOrCreateTradeClient(
      payload.customer,
      addonOrderId
    );
    const { singlePair, syncErrors } = await mapLines(payload.products);

    if (!singlePair.length) {
      await writeSyncLog({
        addonOrderId,
        opencartOrderId: payload.opencartOrderId,
        direction: 'inbound',
        status: 'failed',
        warehouseClientId: client._id,
        clientCreated,
        requestPayload: { addonOrderId, productCount: payload.products?.length },
        error: 'No mappable style codes',
      });
      throw Object.assign(
        new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'No valid product lines — style codes not found in catalogue'),
        { syncErrors }
      );
    }

    const orderStatus = syncErrors.length ? 'draft' : 'pending';
    const order = await createWarehouseOrder({
      clientType: WarehouseClientType.TRADE,
      clientId: String(client._id),
      addonOrderId,
      date: payload.orderDate ? new Date(payload.orderDate) : new Date(),
      status: orderStatus,
      styleCodeSinglePair: singlePair,
      styleCodeMultiPair: [],
      meta: {
        source: 'addonweb',
        opencartOrderId: payload.opencartOrderId,
        opencartCustomerId: payload.customer?.opencartCustomerId,
        websiteOrderTotal: payload.totals?.grandTotal,
        currency: payload.totals?.currency,
        paymentMethod: payload.paymentMethod,
        shippingMethod: payload.shippingMethod,
        approvedBy: payload.approvedBy,
        syncErrors,
        ingestedAt: new Date(),
        clientCreated,
        clientIncompleteFields,
        warehouseClientId: String(client._id),
      },
    });

    const savedOrder = await WarehouseOrder.findById(order._id || order.id);
    if (savedOrder && orderStatus === 'pending') {
      notifyWebsiteFromOrder(savedOrder, 'status_update');
    }

    const logStatus = syncErrors.length ? 'draft' : 'created';
    await writeSyncLog({
      addonOrderId,
      opencartOrderId: payload.opencartOrderId,
      direction: 'inbound',
      status: logStatus,
      warehouseOrderId: order._id || order.id,
      warehouseClientId: client._id,
      clientCreated,
    });

    return {
      status: logStatus,
      warehouseOrderId: String(order._id || order.id),
      warehouseClientId: String(client._id),
      warehouseOrderNumber: order.orderNumber,
      clientCreated,
      clientIncompleteFields,
      syncErrors,
    };
  } catch (error) {
    if (!(error instanceof ApiError)) {
      await writeSyncLog({
        addonOrderId,
        opencartOrderId: payload.opencartOrderId,
        direction: 'inbound',
        status: 'failed',
        error: error.message,
        requestPayload: { addonOrderId },
      });
    }
    throw error;
  }
};

/**
 * Cancel a website-linked warehouse order (if still cancellable).
 * @param {{ addonOrderId: string, reason?: string }} payload
 * @returns {Promise<object>}
 */
export const cancelWebsiteOrder = async (payload) => {
  const addonOrderId = String(payload.addonOrderId || '').trim();
  const order = await WarehouseOrder.findOne({ addonOrderId, 'meta.source': 'addonweb' });
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found for this website order');
  }

  const flowStatus = order.flowStatus;
  const nonCancellable = [
    WarehouseOrderFlowStatus.DISPATCHED,
    WarehouseOrderFlowStatus.PARTIAL_DISPATCHED,
    WarehouseOrderFlowStatus.READY_FOR_PICKUP,
    WarehouseOrderFlowStatus.DELIVERED,
    WarehouseOrderFlowStatus.CANCELLED,
  ];
  if (nonCancellable.includes(flowStatus)) {
    await writeSyncLog({
      addonOrderId,
      direction: 'inbound',
      status: 'cannot_cancel',
      warehouseOrderId: order._id,
      error: `Order is ${flowStatus}`,
    });
    return { status: 'cannot_cancel', reason: `Order already ${flowStatus}` };
  }

  await transitionOrder(
    String(order._id),
    WarehouseOrderFlowStatus.CANCELLED,
    null,
    { remarks: String(payload.reason || 'Cancelled from website') },
    { system: true }
  );

  await writeSyncLog({
    addonOrderId,
    direction: 'inbound',
    status: 'cancelled',
    warehouseOrderId: order._id,
  });

  return { status: 'cancelled', warehouseOrderId: String(order._id) };
};

/**
 * Query sync logs for support.
 * @param {object} filter
 * @param {object} options
 */
export const querySyncLogs = async (filter, options) => {
  return WebsiteOrderSyncLog.paginate(filter, { ...options, sortBy: options.sortBy || 'createdAt:desc' });
};
