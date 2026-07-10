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
 * Resolve an existing Trade client or create one from website customer data.
 * @param {object} customer
 * @param {string} addonOrderId
 * @returns {Promise<{ client: object, clientCreated: boolean }>}
 */
const resolveOrCreateTradeClient = async (customer, addonOrderId) => {
  const opencartCustomerId = Number(customer?.opencartCustomerId) || 0;
  const companyName = String(customer?.companyName || customer?.retailerName || '').trim();
  const email = String(customer?.email || '').trim().toLowerCase();
  const gstin = String(customer?.gstin || '').trim();

  if (opencartCustomerId) {
    const byKey = await WarehouseClient.findOne({
      type: WarehouseClientType.TRADE,
      parentKeyCode: `OC-${opencartCustomerId}`,
    });
    if (byKey) return { client: byKey, clientCreated: false };
  }

  if (email) {
    const byEmail = await WarehouseClient.findOne({
      type: WarehouseClientType.TRADE,
      email: new RegExp(`^${escapeRegex(email)}$`, 'i'),
    });
    if (byEmail) return { client: byEmail, clientCreated: false };
  }

  if (gstin) {
    const byGst = await WarehouseClient.findOne({ type: WarehouseClientType.TRADE, gstin });
    if (byGst) return { client: byGst, clientCreated: false };
  }

  if (companyName) {
    const byName = await WarehouseClient.findOne({
      type: WarehouseClientType.TRADE,
      retailerName: new RegExp(`^${escapeRegex(companyName)}$`, 'i'),
    });
    if (byName) return { client: byName, clientCreated: false };
  }

  if (!companyName && !email) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'customer.companyName or customer.email is required');
  }

  const client = await createWarehouseClient({
    type: WarehouseClientType.TRADE,
    retailerName: companyName || email,
    contactPerson: String(customer?.contactPerson || '').trim(),
    mobilePhone: String(customer?.telephone || customer?.mobilePhone || '').trim(),
    email,
    address: String(customer?.address1 || customer?.address || '').trim(),
    city: String(customer?.city || '').trim(),
    zipCode: String(customer?.postcode || customer?.zipCode || '').trim(),
    state: String(customer?.zone || customer?.state || '').trim(),
    gstin,
    parentKeyCode: opencartCustomerId ? `OC-${opencartCustomerId}` : '',
    status: 'active',
    remarks: `Auto-created from addonweb order ${addonOrderId}`,
  });

  return { client, clientCreated: true };
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
    const { client, clientCreated } = await resolveOrCreateTradeClient(payload.customer, addonOrderId);
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
      },
    });

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
