import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import PickList from '../../models/whms/pickList.model.js';
import PickListBatch, {
  PickListBatchStatus,
  PickListBatchType,
} from '../../models/whms/pickListBatch.model.js';
import WarehouseOrder, { WarehouseOrderFlowStatus } from '../../models/whms/warehouseOrder.model.js';
import WarehouseInventory from '../../models/whms/warehouseInventory.model.js';
import {
  applyPickDeltaToInventory,
  buildPickRowKey,
  getPickupStatus,
} from './pickList.service.js';
import { transitionOrder } from './orderFlow.service.js';
import { runWithOptionalMongoTransaction } from '../../utils/mongoDeployment.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Generate the next batch number for today (PLB-YYYYMMDD-####).
 * @returns {Promise<string>}
 */
async function generateBatchNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const prefix = `PLB-${y}${m}${d}-`;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 86400000);
  const count = await PickListBatch.countDocuments({ createdAt: { $gte: start, $lt: end } });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

/**
 * FIFO-allocate a total picked quantity across order allocations.
 * @param {Array<{ requiredQty: number }>} allocations
 * @param {number} totalPicked
 * @returns {number[]}
 */
export function allocateFifoQuantities(allocations, totalPicked) {
  let remaining = Math.max(0, Number(totalPicked || 0));
  return allocations.map((alloc) => {
    const req = Number(alloc.requiredQty || 0);
    const assign = Math.min(req, remaining);
    remaining -= assign;
    return assign;
  });
}

/**
 * Aggregate pick-list rows from multiple orders into batch items.
 * @param {object[]} pickRows
 * @returns {object[]}
 */
function aggregatePickRowsIntoBatchItems(pickRows) {
  const map = new Map();

  for (const row of pickRows) {
    const key = buildPickRowKey(row);
    const qty = Number(row.quantity || 0);
    if (!map.has(key)) {
      map.set(key, {
        itemKey: key,
        styleCode: row.styleCode,
        skuCode: row.skuCode,
        styleCodeId: row.styleCodeId ?? null,
        size: row.size || '',
        shade: row.shade || '',
        requiredQty: qty,
        pickedQty: 0,
        status: 'pending',
        allocations: [
          {
            orderId: row.orderId,
            pickListId: row._id,
            orderNumber: row.orderNumber || '',
            requiredQty: qty,
          },
        ],
      });
    } else {
      const agg = map.get(key);
      agg.requiredQty += qty;
      agg.allocations.push({
        orderId: row.orderId,
        pickListId: row._id,
        orderNumber: row.orderNumber || '',
        requiredQty: qty,
      });
    }
  }

  return [...map.values()];
}

/**
 * Apply FIFO pick allocation to underlying pick-list rows and inventory.
 * @param {object} batchItem
 * @param {number} newPickedQty
 * @param {import('mongoose').ClientSession|null} session
 */
async function applyBatchItemPickAllocation(batchItem, newPickedQty, session) {
  const allocations = batchItem.allocations || [];
  const fifoQtys = allocateFifoQuantities(allocations, newPickedQty);

  for (let i = 0; i < allocations.length; i += 1) {
    const alloc = allocations[i];
    const targetQty = fifoQtys[i];

    let pickQuery = PickList.findById(alloc.pickListId);
    if (session) pickQuery = pickQuery.session(session);
    const pickRow = await pickQuery;
    if (!pickRow) continue;

    const prevPickup = Number(pickRow.pickupQuantity || 0);
    const delta = targetQty - prevPickup;
    if (delta === 0) continue;

    await applyPickDeltaToInventory({
      session,
      styleCode: pickRow.styleCode,
      deltaPickupQuantity: delta,
      pickListId: String(pickRow._id),
    });

    pickRow.pickupQuantity = targetQty;
    pickRow.status = getPickupStatus(targetQty, Number(pickRow.quantity || 0));
    await pickRow.save(session ? { session } : undefined);
  }
}

/**
 * Serialize a batch document for API responses with summary stats.
 * @param {object} batch
 * @returns {object}
 */
function serializeBatch(batch) {
  const doc = batch.toJSON ? batch.toJSON() : batch;
  const items = doc.items || [];
  const totalRequired = items.reduce((s, i) => s + Number(i.requiredQty || 0), 0);
  const totalPicked = items.reduce((s, i) => s + Number(i.pickedQty || 0), 0);
  return {
    ...doc,
    summary: {
      itemCount: items.length,
      orderCount: (doc.orderIds || []).length,
      totalRequired,
      totalPicked,
      pickedProgressPct: totalRequired > 0 ? Math.round((totalPicked / totalRequired) * 100) : 0,
    },
  };
}

/**
 * Create a pick-list batch from one or more warehouse orders.
 * @param {{ orderIds: string[], user?: object }} params
 * @returns {Promise<object>}
 */
export const createBatch = async ({ orderIds, user }) => {
  const ids = [...new Set((orderIds || []).map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'At least one orderId is required');
  }

  const orders = await WarehouseOrder.find({ _id: { $in: ids } }).sort({ createdAt: 1 });
  if (orders.length !== ids.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'One or more orders were not found');
  }

  for (const order of orders) {
    const flow = order.flowStatus || WarehouseOrderFlowStatus.ORDER_CREATED;
    if (flow !== WarehouseOrderFlowStatus.ORDER_CREATED) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Order "${order.orderNumber || order._id}" must be in "order-created" (current: "${flow}")`
      );
    }
    if (order.activeBatchId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Order "${order.orderNumber || order._id}" is already part of an active pick-list batch`
      );
    }
  }

  const pickRows = await PickList.find({ orderId: { $in: ids } }).sort({ orderId: 1, styleCode: 1 }).lean();
  if (!pickRows.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No pick-list rows exist for the selected orders');
  }

  const items = aggregatePickRowsIntoBatchItems(pickRows);
  const batchNumber = await generateBatchNumber();
  const type = ids.length === 1 ? PickListBatchType.SINGLE : PickListBatchType.COMBINED;

  const batch = await PickListBatch.create({
    batchNumber,
    type,
    orderIds: orders.map((o) => o._id),
    orderNumbers: orders.map((o) => o.orderNumber || String(o._id)),
    status: PickListBatchStatus.PICKING,
    items,
    createdBy: user?._id ?? user?.id ?? null,
    createdByName: user?.name || user?.email || '',
  });

  await PickList.updateMany({ orderId: { $in: ids } }, { $set: { batchId: batch._id } });
  await WarehouseOrder.updateMany(
    { _id: { $in: ids } },
    { $set: { activeBatchId: batch._id } }
  );

  for (const order of orders) {
    await transitionOrder(
      String(order._id),
      WarehouseOrderFlowStatus.PICKING,
      user,
      { remarks: `Added to pick-list batch ${batchNumber}` },
      { system: true }
    );
  }

  return serializeBatch(batch);
};

/**
 * Build Mongo filter for batch list queries.
 * @param {object} query
 * @returns {object}
 */
export const buildBatchFilter = (query) => {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;
  if (query.orderId) filter.orderIds = query.orderId;
  if (query.q && String(query.q).trim()) {
    const term = escapeRegex(String(query.q).trim());
    const regex = new RegExp(term, 'i');
    filter.$or = [{ batchNumber: regex }, { orderNumbers: regex }];
  }
  return filter;
};

/**
 * Paginated batch list.
 * @param {object} filter
 * @param {object} options
 * @returns {Promise<object>}
 */
export const queryBatches = async (filter, options) => {
  const result = await PickListBatch.paginate(filter, {
    ...options,
    sortBy: options.sortBy || 'createdAt:desc',
  });
  return {
    ...result,
    results: (result.results || []).map((b) => serializeBatch(b)),
  };
};

/**
 * Get one batch by id with live stock lookup per item.
 * @param {string} batchId
 * @returns {Promise<object>}
 */
export const getBatchById = async (batchId) => {
  const batch = await PickListBatch.findById(batchId);
  if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Pick-list batch not found');

  const styleCodes = [...new Set((batch.items || []).map((i) => i.styleCode).filter(Boolean))];
  const stockRows = styleCodes.length
    ? await WarehouseInventory.find({ styleCode: { $in: styleCodes } })
        .select('styleCode availableQuantity totalQuantity')
        .lean()
    : [];
  const stockByCode = new Map(stockRows.map((r) => [r.styleCode, r]));

  const serialized = serializeBatch(batch);
  serialized.items = (serialized.items || []).map((item) => ({
    ...item,
    availableStock: Number(stockByCode.get(item.styleCode)?.availableQuantity ?? 0),
  }));

  const orders = await WarehouseOrder.find({ _id: { $in: batch.orderIds } })
    .select('orderNumber addonOrderId clientName flowStatus activeBatchId')
    .lean();
  serialized.orders = orders.map((o) => ({
    id: String(o._id),
    orderNumber: o.orderNumber,
    addonOrderId: o.addonOrderId,
    clientName: o.clientName,
    flowStatus: o.flowStatus,
  }));

  return serialized;
};

/**
 * Find a batch item by itemKey.
 * @param {object} batch
 * @param {string} itemKey
 * @returns {object}
 */
function findBatchItem(batch, itemKey) {
  const key = decodeURIComponent(String(itemKey || '').trim());
  const item = (batch.items || []).find((i) => i.itemKey === key);
  if (!item) throw new ApiError(httpStatus.NOT_FOUND, `Batch item "${key}" not found`);
  return item;
}

/**
 * Update picked quantity for one aggregated batch item.
 * @param {string} batchId
 * @param {string} itemKey
 * @param {number} pickedQty
 * @param {object|null} user
 * @returns {Promise<object>}
 */
export const updateBatchItemPickedQty = async (batchId, itemKey, pickedQty, user) => {
  let result;

  await runWithOptionalMongoTransaction(async (session) => {
    let batchQuery = PickListBatch.findById(batchId);
    if (session) batchQuery = batchQuery.session(session);
    const batch = await batchQuery;
    if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Pick-list batch not found');
    if (batch.status !== PickListBatchStatus.PICKING) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Batch is "${batch.status}" — picks are locked`);
    }

    const item = findBatchItem(batch, itemKey);
    const nextPicked = Math.max(0, Number(pickedQty || 0));
    if (nextPicked > Number(item.requiredQty || 0)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Picked quantity (${nextPicked}) cannot exceed required (${item.requiredQty}) for ${item.styleCode}`
      );
    }

    await applyBatchItemPickAllocation(item, nextPicked, session);

    item.pickedQty = nextPicked;
    item.status = getPickupStatus(nextPicked, Number(item.requiredQty || 0));
    await batch.save(session ? { session } : undefined);
    result = serializeBatch(batch);
  }, 'pickListBatch.updateItem');

  return result;
};

/**
 * Bulk-save picked quantities for multiple batch items.
 * @param {string} batchId
 * @param {Array<{ itemKey: string, pickedQty: number }>} picks
 * @param {object|null} user
 * @returns {Promise<object>}
 */
export const saveBatchPicks = async (batchId, picks, user) => {
  for (const pick of picks || []) {
    await updateBatchItemPickedQty(batchId, pick.itemKey, pick.pickedQty, user);
  }
  return getBatchById(batchId);
};

/**
 * Set picker name on a batch and propagate to all linked pick rows.
 * @param {string} batchId
 * @param {string} pickerName
 * @returns {Promise<object>}
 */
export const setBatchPickerName = async (batchId, pickerName) => {
  const name = String(pickerName || '').trim();
  if (!name) throw new ApiError(httpStatus.BAD_REQUEST, 'pickerName is required');

  const batch = await PickListBatch.findById(batchId);
  if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Pick-list batch not found');

  batch.pickerName = name;
  await batch.save();
  await PickList.updateMany({ batchId: batch._id }, { $set: { pickerName: name } });
  return serializeBatch(batch);
};

/**
 * Build barcode label payload for a batch (optionally filtered by styleCode).
 * @param {string} batchId
 * @param {{ styleCode?: string, extraQty?: number }} opts
 * @returns {Promise<object>}
 */
export const buildBarcodePayload = async (batchId, { styleCode, extraQty = 0 } = {}) => {
  const batch = await PickListBatch.findById(batchId);
  if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Pick-list batch not found');

  let items = batch.items || [];
  if (styleCode && String(styleCode).trim()) {
    const code = String(styleCode).trim();
    items = items.filter((i) => i.styleCode === code);
  }

  const extra = Math.max(0, Number(extraQty || 0));
  const labels = [];
  for (const item of items) {
    const baseQty = Number(item.pickedQty || 0);
    const qty = baseQty + (styleCode ? extra : 0);
    if (qty <= 0) continue;
    labels.push({
      styleCode: item.styleCode,
      skuCode: item.skuCode,
      size: item.size || '',
      shade: item.shade || '',
      barcode: item.styleCode,
      quantity: qty,
    });
  }

  if (!labels.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No picked quantities to print barcodes for');
  }

  return {
    batchId: String(batch._id),
    batchNumber: batch.batchNumber,
    type: batch.type,
    orderNumbers: batch.orderNumbers,
    labels,
  };
};

/**
 * Advance all orders in a batch through picking stages to sent-to-scanning.
 * @param {string} batchId
 * @param {object|null} user
 * @returns {Promise<object>}
 */
export const sendBatchToScanning = async (batchId, user) => {
  const batch = await PickListBatch.findById(batchId);
  if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Pick-list batch not found');
  if (batch.status !== PickListBatchStatus.PICKING) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Batch is already "${batch.status}"`);
  }

  const totalPicked = (batch.items || []).reduce((s, i) => s + Number(i.pickedQty || 0), 0);
  if (totalPicked <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Save at least one picked quantity before sending to scanning');
  }

  const chain = [
    WarehouseOrderFlowStatus.PICKING_DONE,
    WarehouseOrderFlowStatus.BARCODE_IN_PROGRESS,
    WarehouseOrderFlowStatus.PACKING_DONE,
    WarehouseOrderFlowStatus.SENT_TO_SCANNING,
  ];

  for (const orderId of batch.orderIds) {
    const order = await WarehouseOrder.findById(orderId);
    if (!order) continue;
    let current = order.flowStatus || WarehouseOrderFlowStatus.PICKING;
    for (const next of chain) {
      if (current === next) continue;
      if (current === WarehouseOrderFlowStatus.SENT_TO_SCANNING) break;
      await transitionOrder(
        String(orderId),
        next,
        user,
        { remarks: `Batch ${batch.batchNumber} sent to scanning` },
        { system: true }
      );
      current = next;
    }
  }

  batch.status = PickListBatchStatus.SENT_TO_SCANNING;
  batch.sentToScanningAt = new Date();
  await batch.save();

  return serializeBatch(batch);
};

/**
 * Cancel a pick-list batch and revert orders to order-created.
 * @param {string} batchId
 * @param {object|null} user
 * @returns {Promise<object>}
 */
export const cancelBatch = async (batchId, user) => {
  const batch = await PickListBatch.findById(batchId);
  if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Pick-list batch not found');
  if (batch.status !== PickListBatchStatus.PICKING) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Only batches in "picking" can be cancelled');
  }

  const hasPicks = (batch.items || []).some((i) => Number(i.pickedQty || 0) > 0);
  if (hasPicks) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot cancel a batch with saved pick quantities — clear picks first or complete the batch'
    );
  }

  await runWithOptionalMongoTransaction(async (session) => {
    for (const item of batch.items || []) {
      for (const alloc of item.allocations || []) {
        let pickQuery = PickList.findById(alloc.pickListId);
        if (session) pickQuery = pickQuery.session(session);
        const pickRow = await pickQuery;
        if (pickRow && Number(pickRow.pickupQuantity || 0) > 0) {
          throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot cancel: pick quantities exist on order rows');
        }
      }
    }

    batch.status = PickListBatchStatus.CANCELLED;
    await batch.save(session ? { session } : undefined);

    await PickList.updateMany(
      { batchId: batch._id },
      { $set: { batchId: null, pickupQuantity: 0, status: 'pending' } },
      session ? { session } : undefined
    );
    await WarehouseOrder.updateMany(
      { activeBatchId: batch._id },
      { $set: { activeBatchId: null } },
      session ? { session } : undefined
    );
  }, 'pickListBatch.cancel');

  for (const orderId of batch.orderIds) {
    const order = await WarehouseOrder.findById(orderId);
    if (!order) continue;
    if ((order.flowStatus || '') === WarehouseOrderFlowStatus.PICKING) {
      await transitionOrder(
        String(orderId),
        WarehouseOrderFlowStatus.ORDER_CREATED,
        user,
        { remarks: `Pick-list batch ${batch.batchNumber} cancelled` },
        { system: true }
      );
    }
  }

  return serializeBatch(batch);
};

/**
 * Get batch summary for an order (used by scanning UI).
 * @param {string} orderId
 * @returns {Promise<object|null>}
 */
export const getBatchForOrder = async (orderId) => {
  const order = await WarehouseOrder.findById(orderId).select('activeBatchId orderNumber');
  if (!order?.activeBatchId) return null;

  const batch = await PickListBatch.findById(order.activeBatchId).lean();
  if (!batch) return null;

  const siblingOrders = await WarehouseOrder.find({ _id: { $in: batch.orderIds } })
    .select('orderNumber flowStatus')
    .lean();

  return {
    id: String(batch._id),
    batchNumber: batch.batchNumber,
    type: batch.type,
    status: batch.status,
    orderNumbers: batch.orderNumbers,
    siblings: siblingOrders.map((o) => ({
      id: String(o._id),
      orderNumber: o.orderNumber,
      flowStatus: o.flowStatus,
    })),
  };
};
