import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import WarehouseOrder, { WarehouseOrderFlowStatus } from '../../models/whms/warehouseOrder.model.js';
import PickList from '../../models/whms/pickList.model.js';
import WarehouseInventory from '../../models/whms/warehouseInventory.model.js';
import WhmsInvoice from '../../models/whms/invoice.model.js';
import { appendWarehouseInventoryLog } from './warehouseInventory.service.js';
import { transitionOrder } from './orderFlow.service.js';

const DISPATCH_MODES = Object.freeze([
  WarehouseOrderFlowStatus.DISPATCHED,
  WarehouseOrderFlowStatus.PARTIAL_DISPATCHED,
  WarehouseOrderFlowStatus.READY_FOR_PICKUP,
]);

/**
 * Save dispatch preparation details (courier / AWB / vehicle / boxes / remarks).
 * Allowed once the order is billed; moves it to ready-to-dispatch on first save.
 */
export const setDispatchDetails = async (orderId, user, details) => {
  const order = await WarehouseOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');

  const editableStages = [
    WarehouseOrderFlowStatus.BILLED,
    WarehouseOrderFlowStatus.READY_TO_DISPATCH,
  ];
  if (!editableStages.includes(order.flowStatus)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Dispatch details can be entered after billing (current: "${order.flowStatus}")`
    );
  }

  order.dispatch = {
    ...(order.dispatch ? (order.dispatch.toObject ? order.dispatch.toObject() : order.dispatch) : {}),
    ...details,
  };
  await order.save();

  if (order.flowStatus === WarehouseOrderFlowStatus.BILLED) {
    return transitionOrder(
      orderId,
      WarehouseOrderFlowStatus.READY_TO_DISPATCH,
      user,
      { remarks: 'Dispatch details entered' },
      { system: true }
    );
  }
  return order;
};

/**
 * Mark the shipment as gone: dispatched | partial-dispatched | ready-for-pickup.
 * Stock was already deducted at pick time; per-style traceability rows are written
 * to the inventory log (delta 0) referencing the order.
 */
export const dispatchOrder = async (orderId, user, { mode, remarks = '' }) => {
  if (!DISPATCH_MODES.includes(mode)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `mode must be one of: ${DISPATCH_MODES.join(', ')}`);
  }

  const order = await WarehouseOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');

  if (!order.dispatch || !(order.dispatch.courierName || order.dispatch.trackingNumber)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Enter dispatch details (courier / tracking number) first');
  }

  order.dispatch.dispatchType = mode;
  if (!order.dispatch.dispatchDate) order.dispatch.dispatchDate = new Date();
  await order.save();

  const updated = await transitionOrder(orderId, mode, user, { remarks }, { viaDispatch: true, system: true });

  // Traceability: one log row per picked style (delta 0 — stock left at pick time).
  const pickRows = await PickList.find({ orderId, pickupQuantity: { $gt: 0 } }).lean();
  for (const row of pickRows) {
    const inv = await WarehouseInventory.findOne({ styleCode: row.styleCode }).lean();
    if (!inv) continue;
    await appendWarehouseInventoryLog({
      warehouseInventoryId: inv._id,
      styleCodeId: inv.styleCodeId,
      styleCode: inv.styleCode,
      action: 'order_dispatch',
      message: `Order ${order.orderNumber || orderId} ${mode} (qty ${row.pickupQuantity}, AWB ${order.dispatch.trackingNumber || '—'})`,
      quantityDelta: 0,
      blockedDelta: 0,
      totalQuantityAfter: Number(inv.totalQuantity ?? 0),
      blockedQuantityAfter: Number(inv.blockedQuantity ?? 0),
      availableQuantityAfter: Number(inv.availableQuantity ?? 0),
      userId: user?._id ?? user?.id ?? null,
      meta: { orderId: String(order._id), orderNumber: order.orderNumber, dispatchType: mode },
    });
  }

  return updated;
};

/** Optional delivery confirmation. */
export const setDeliveryStatus = async (orderId, user, { deliveredDate, remarks = '' } = {}) => {
  const order = await WarehouseOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');

  const updated = await transitionOrder(orderId, WarehouseOrderFlowStatus.DELIVERED, user, { remarks });
  updated.dispatch = {
    ...(updated.dispatch ? (updated.dispatch.toObject ? updated.dispatch.toObject() : updated.dispatch) : {}),
    deliveredDate: deliveredDate ? new Date(deliveredDate) : new Date(),
  };
  await updated.save();
  return updated;
};

/** Print payload for shipping labels (frontend renders/prints). */
export const buildShippingLabelPayload = async (orderId) => {
  const order = await WarehouseOrder.findById(orderId).populate('clientId');
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');
  if (!order.dispatch) throw new ApiError(httpStatus.BAD_REQUEST, 'No dispatch details entered for this order');

  const invoice = order.invoiceId ? await WhmsInvoice.findById(order.invoiceId).select('invoiceNumber') : null;
  const boxCount = Number(order.dispatch.boxCount || 1);

  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    invoiceNumber: invoice?.invoiceNumber || '',
    clientType: order.clientType,
    clientName: order.clientName,
    client: order.clientId || null,
    dispatch: order.dispatch,
    labels: Array.from({ length: boxCount }, (_, i) => ({
      boxNumber: i + 1,
      boxCount,
      orderNumber: order.orderNumber,
      clientName: order.clientName,
      courierName: order.dispatch.courierName || '',
      trackingNumber: order.dispatch.trackingNumber || '',
    })),
    generatedAt: new Date(),
  };
};

/** Print payload for the packing list (billed/scanned quantities per style). */
export const buildPackingListPayload = async (orderId) => {
  const order = await WarehouseOrder.findById(orderId).populate('clientId');
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');

  const invoice = order.invoiceId ? await WhmsInvoice.findById(order.invoiceId) : null;
  const items = invoice
    ? (invoice.items || []).map((item, index) => ({
        srNo: index + 1,
        styleCode: item.styleCode,
        skuCode: item.skuCode,
        size: item.size || '',
        shade: item.shade || '',
        quantity: item.quantity,
      }))
    : (await PickList.find({ orderId, pickupQuantity: { $gt: 0 } }).sort({ styleCode: 1 }).lean()).map(
        (row, index) => ({
          srNo: index + 1,
          styleCode: row.styleCode,
          skuCode: row.skuCode,
          size: row.size || '',
          shade: row.shade || '',
          quantity: Number(row.pickupQuantity || 0),
        })
      );

  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    invoiceNumber: invoice?.invoiceNumber || '',
    clientType: order.clientType,
    clientName: order.clientName,
    dispatch: order.dispatch || null,
    items,
    totalQuantity: items.reduce((s, i) => s + Number(i.quantity || 0), 0),
    generatedAt: new Date(),
  };
};
