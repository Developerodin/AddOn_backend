import PickList from '../../models/whms/pickList.model.js';
import { WarehouseOrderFlowStatus } from '../../models/whms/warehouseOrder.model.js';
import { applyWarehouseInventoryBlockedDelta } from './warehouseInventory.service.js';
import { getOrderReservedQuantitiesByStyleCode } from './pickList.service.js';

const TERMINAL_FLOW_STATUSES = new Set([
  WarehouseOrderFlowStatus.DISPATCHED,
  WarehouseOrderFlowStatus.PARTIAL_DISPATCHED,
  WarehouseOrderFlowStatus.READY_FOR_PICKUP,
  WarehouseOrderFlowStatus.DELIVERED,
  WarehouseOrderFlowStatus.CANCELLED,
]);

/**
 * Whether a warehouse order should reserve inventory on create / line edits.
 * @param {{ status?: string; flowStatus?: string }} order
 * @returns {boolean}
 */
export const shouldReserveInventoryForOrder = (order) => {
  const status = String(order?.status || '').toLowerCase();
  const flowStatus = String(order?.flowStatus || '').toLowerCase();
  if (status === 'cancelled' || flowStatus === WarehouseOrderFlowStatus.CANCELLED) return false;
  if (TERMINAL_FLOW_STATUSES.has(flowStatus)) return false;
  return true;
};

/**
 * Sum quantities by styleCode from pick-list shaped rows.
 * @param {object[]} rows
 * @param {'quantity'|'remaining'} mode — full order qty or unpicked remainder
 * @returns {Map<string, number>}
 */
export const aggregateQtyByStyleCode = (rows, mode = 'quantity') => {
  const map = new Map();
  for (const row of rows || []) {
    const code = String(row.styleCode || '').trim();
    if (!code) continue;
    const qty =
      mode === 'remaining'
        ? Math.max(0, Number(row.quantity || 0) - Number(row.pickupQuantity || 0))
        : Number(row.quantity || 0);
    if (qty <= 0) continue;
    map.set(code, (map.get(code) || 0) + qty);
  }
  return map;
};

/**
 * Apply blocked-quantity deltas for each styleCode in a quantity map.
 * @param {Map<string, number>} qtyByStyleCode
 * @param {object} context
 * @param {string|import('mongoose').Types.ObjectId} context.orderId
 * @param {string} [context.orderNumber]
 * @param {string} context.action
 * @param {string} context.messagePrefix
 */
const applyBlockedDeltasFromMap = async (qtyByStyleCode, { orderId, orderNumber, action, messagePrefix }) => {
  for (const [styleCode, qty] of qtyByStyleCode.entries()) {
    if (!qty) continue;
    await applyWarehouseInventoryBlockedDelta({
      styleCode,
      deltaBlocked: qty,
      orderId: String(orderId),
      orderNumber,
      action,
      message: `${messagePrefix} ${styleCode} (${qty > 0 ? '+' : ''}${qty})`,
    });
  }
};

/**
 * Reserve inventory when a warehouse order is created.
 * @param {import('../../models/whms/warehouseOrder.model.js').default} order
 */
export const blockInventoryForWarehouseOrder = async (order) => {
  if (!shouldReserveInventoryForOrder(order)) return;

  const qtyByStyleCode = await getOrderReservedQuantitiesByStyleCode(order);
  await applyBlockedDeltasFromMap(qtyByStyleCode, {
    orderId: order._id,
    orderNumber: order.orderNumber,
    action: 'order_block_create',
    messagePrefix: 'Warehouse order created — blocked',
  });
};

/**
 * Sync blocked inventory after warehouse order line-item edits.
 * @param {import('../../models/whms/warehouseOrder.model.js').default} order
 * @param {object[]} previousPickRows — pick rows before syncPickListForOrderLineItems
 */
export const syncInventoryBlockForWarehouseOrderLineItems = async (order, previousPickRows) => {
  if (!shouldReserveInventoryForOrder(order)) {
    await releaseInventoryBlockForWarehouseOrder(order._id, previousPickRows);
    return;
  }

  const oldMap = aggregateQtyByStyleCode(previousPickRows, 'quantity');
  const newMap = await getOrderReservedQuantitiesByStyleCode(order);

  const styleCodes = new Set([...oldMap.keys(), ...newMap.keys()]);
  for (const styleCode of styleCodes) {
    const delta = (newMap.get(styleCode) || 0) - (oldMap.get(styleCode) || 0);
    if (!delta) continue;
    await applyWarehouseInventoryBlockedDelta({
      styleCode,
      deltaBlocked: delta,
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      action: 'order_block_sync',
      message: `Warehouse order line edit — blocked ${styleCode} (${delta > 0 ? '+' : ''}${delta})`,
    });
  }
};

/**
 * Release remaining blocked inventory for a warehouse order (cancel / delete).
 * @param {string|import('mongoose').Types.ObjectId} orderId
 * @param {object[]} [pickRows] — optional pre-loaded pick rows
 */
export const releaseInventoryBlockForWarehouseOrder = async (orderId, pickRows) => {
  const rows = pickRows ?? (await PickList.find({ orderId }).lean());
  const remainingMap = aggregateQtyByStyleCode(rows, 'remaining');
  const releaseMap = new Map();
  for (const [styleCode, qty] of remainingMap.entries()) {
    releaseMap.set(styleCode, -qty);
  }

  const orderNumber = rows[0]?.orderNumber;
  await applyBlockedDeltasFromMap(releaseMap, {
    orderId,
    orderNumber,
    action: 'order_block_release',
    messagePrefix: 'Warehouse order released — blocked',
  });
};
