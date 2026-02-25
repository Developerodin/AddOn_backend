import mongoose from 'mongoose';
import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PickList, PackBatch, DamageMissingReport, WhmsOrder } from '../../models/whms/index.js';
import { setPickBlockForOrderIds } from './order.service.js';
import { enrichItemsWithProduct } from './productResolution.service.js';
import { resolveProductBySku } from './productResolution.service.js';

const generatePickBatchId = () =>
  `PICK-BATCH-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
const generatePackBatchCode = () =>
  `PACK-BATCH-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

// Pick list
export const getPickList = async (pickBatchId) => {
  const list = pickBatchId
    ? await PickList.findOne({ pickBatchId })
    : await PickList.findOne({ status: { $in: ['generated', 'picking-in-progress'] } }).sort({ createdAt: -1 });
  if (!list) return null;
  const doc = list.toObject ? list.toObject() : list;
  if (doc.items?.length) doc.items = await enrichItemsWithProduct(doc.items);
  return doc;
};

export const generatePickList = async (body) => {
  const { orderIds = [], batchId } = body;
  const orders = await WhmsOrder.find({ _id: { $in: orderIds }, status: { $nin: ['dispatched', 'cancelled'] } });
  const itemMap = new Map();
  orders.forEach((order) => {
    order.items?.forEach((item) => {
      const key = item.sku;
      if (!itemMap.has(key)) {
        itemMap.set(key, {
          sku: item.sku,
          name: item.name,
          requiredQty: 0,
          linkedOrderIds: [],
          productId: item.productId,
        });
      }
      const row = itemMap.get(key);
      row.requiredQty += item.quantity || 0;
      if (!row.linkedOrderIds.some((id) => id.toString() === order._id.toString())) {
        row.linkedOrderIds.push(order._id);
      }
    });
  });
  const items = Array.from(itemMap.values()).map((r, i) => ({
    ...r,
    pathIndex: i + 1,
    status: 'pending',
    pickedQty: 0,
    batchId: batchId || null,
  }));
  const pickBatchId = generatePickBatchId();
  const list = await PickList.create({
    pickBatchId,
    status: 'generated',
    items,
  });
  await setPickBlockForOrderIds(orderIds);
  await WhmsOrder.updateMany(
    { _id: { $in: orderIds } },
    { $set: { stockBlockStatus: 'pick-block', status: 'in-progress' } }
  );
  return getPickList(list.pickBatchId);
};

export const updatePickItem = async (listId, itemId, body) => {
  const list = await PickList.findById(listId);
  if (!list) throw new ApiError(httpStatus.NOT_FOUND, 'Pick list not found');
  const item = list.items.id(itemId);
  if (!item) throw new ApiError(httpStatus.NOT_FOUND, 'Pick item not found');
  if (body.pickedQty !== undefined) item.pickedQty = Math.min(body.pickedQty, item.requiredQty);
  if (body.status) item.status = body.status;
  if (item.pickedQty >= item.requiredQty) item.status = 'picked';
  if (list.status === 'generated') list.status = 'picking-in-progress';
  list.startedAt = list.startedAt || new Date();
  await list.save();
  return getPickList(list.pickBatchId);
};

export const confirmPick = async (body) => {
  const { itemId, pickedQty } = body;
  const list = await PickList.findOne({ 'items._id': itemId });
  if (!list) throw new ApiError(httpStatus.NOT_FOUND, 'Pick list/item not found');
  const item = list.items.id(itemId);
  if (!item) throw new ApiError(httpStatus.NOT_FOUND, 'Pick item not found');
  item.pickedQty = Math.min(pickedQty ?? item.requiredQty, item.requiredQty);
  item.status = item.pickedQty >= item.requiredQty ? 'picked' : 'partial';
  if (list.status === 'generated') list.status = 'picking-in-progress';
  await list.save();
  return getPickList(list.pickBatchId);
};

export const skipPickItem = async (body) => {
  const { itemId } = body;
  const list = await PickList.findOne({ 'items._id': itemId });
  if (!list) throw new ApiError(httpStatus.NOT_FOUND, 'Pick list/item not found');
  const item = list.items.id(itemId);
  if (!item) throw new ApiError(httpStatus.NOT_FOUND, 'Pick item not found');
  item.status = 'skipped';
  await list.save();
  return getPickList(list.pickBatchId);
};

export const scanPick = async (body) => {
  const { skuOrBarcode, rackLocation } = body;
  const list = await PickList.findOne({ status: { $in: ['generated', 'picking-in-progress'] } }).sort({ createdAt: -1 });
  if (!list) throw new ApiError(httpStatus.NOT_FOUND, 'No active pick list');
  const item = list.items.find((i) => i.sku === skuOrBarcode);
  if (!item) return { match: false, message: 'SKU not in pick list' };
  return { match: true, item: { id: item._id, sku: item.sku, name: item.name, requiredQty: item.requiredQty, rackLocation: item.rackLocation || rackLocation } };
};

// Pack list
export const getPackList = async (batchId) => {
  if (batchId) {
    const batch = await PackBatch.findOne(
      mongoose.Types.ObjectId.isValid(batchId) && String(batchId).length === 24 ? { _id: batchId } : { batchCode: batchId }
    ).populate('orders.orderId');
    return batch;
  }
  const batch = await PackBatch.findOne({ status: { $in: ['ready', 'packing'] } })
    .sort({ createdAt: -1 })
    .populate('orders.orderId');
  return batch ? { batches: [batch] } : { batches: [] };
};

export const getPackBatchById = async (batchId) => {
  const batch = await PackBatch.findOne(
    mongoose.Types.ObjectId.isValid(batchId) && String(batchId).length === 24 ? { _id: batchId } : { batchCode: batchId }
  ).populate('orders.orderId');
  if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Pack batch not found');
  return batch;
};

export const createPackBatch = async (body) => {
  const { orderIds = [] } = body;
  const orders = await WhmsOrder.find({ _id: { $in: orderIds } });
  const batchCode = generatePackBatchCode();
  const packOrders = orders.map((o) => ({
    orderId: o._id,
    orderNumber: o.orderNumber,
    customerName: o.customer?.name,
    status: 'ready',
    priority: o.priority || 'medium',
    items: (o.items || []).map((i) => ({
      sku: i.sku,
      name: i.name,
      pickedQty: i.quantity || 0,
      packedQty: 0,
      status: 'pending',
      productId: i.productId,
    })),
  }));
  const batch = await PackBatch.create({
    batchCode,
    orderIds,
    status: 'ready',
    orders: packOrders,
    cartons: [],
  });
  return getPackBatchById(batch._id);
};

export const updatePackItemQty = async (batchId, orderId, itemId, packedQty) => {
  const batch = await PackBatch.findById(batchId);
  if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Pack batch not found');
  const packOrder = batch.orders.find((o) => o.orderId?.toString() === orderId || o._id.toString() === orderId);
  if (!packOrder) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found in batch');
  const item = packOrder.items.id(itemId);
  if (!item) throw new ApiError(httpStatus.NOT_FOUND, 'Pack item not found');
  item.packedQty = Math.min(packedQty, item.pickedQty);
  item.status = item.packedQty >= item.pickedQty ? 'packed' : 'partial';
  await batch.save();
  return getPackBatchById(batchId);
};

export const addCarton = async (batchId) => {
  const batch = await PackBatch.findById(batchId);
  if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Pack batch not found');
  batch.cartons.push({});
  await batch.save();
  return getPackBatchById(batchId);
};

export const updateCarton = async (batchId, cartonId, body) => {
  const batch = await PackBatch.findById(batchId);
  if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Pack batch not found');
  const carton = batch.cartons.id(cartonId);
  if (!carton) throw new ApiError(httpStatus.NOT_FOUND, 'Carton not found');
  if (body.cartonBarcode) carton.cartonBarcode = body.cartonBarcode;
  await batch.save();
  return getPackBatchById(batchId);
};

export const completePackBatch = async (batchId) => {
  const batch = await PackBatch.findById(batchId);
  if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Pack batch not found');
  batch.status = 'dispatch-ready';
  batch.orders.forEach((o) => { o.status = 'dispatch-ready'; });
  await batch.save();
  return getPackBatchById(batchId);
};

// Barcode (stub: generate and attach to pack items)
export const generateBarcodes = async (body) => {
  const { batchId, orderId, itemIds, types, quantity } = body;
  const batch = await PackBatch.findById(batchId);
  if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Pack batch not found');
  const prefix = `WHMS-${Date.now()}-`;
  const generated = [];
  if (types?.includes('item') && batch.orders) {
    for (const order of batch.orders) {
      for (const item of order.items || []) {
        if (itemIds && !itemIds.includes(item._id.toString())) continue;
        const code = `${prefix}ITEM-${item._id}`;
        item.itemBarcode = code;
        generated.push({ type: 'item', id: item._id, barcode: code });
      }
    }
  }
  if (types?.includes('carton') && batch.cartons?.length) {
    batch.cartons.forEach((c, i) => {
      const code = `${prefix}CARTON-${c._id}`;
      c.cartonBarcode = c.cartonBarcode || code;
      generated.push({ type: 'carton', id: c._id, barcode: c.cartonBarcode });
    });
  }
  await batch.save();
  return { generated };
};

// Damage/Missing report
export const createDamageMissingReport = async (body, user) => {
  const resolved = await resolveProductBySku(body.sku);
  const report = await DamageMissingReport.create({
    ...body,
    itemName: body.itemName || resolved?.name || body.sku,
    reportedBy: user?.email || user?.username || body.reportedBy,
  });
  return report;
};

export const queryDamageMissingReports = async (filter, options) => {
  return DamageMissingReport.paginate(filter, options);
};

// Scan pack
export const scanPack = async (body) => {
  const { barcode, batchId } = body;
  const batch = await PackBatch.findById(batchId);
  if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Pack batch not found');
  for (const order of batch.orders || []) {
    for (const item of order.items || []) {
      if (item.itemBarcode === barcode) {
        item.packedQty = (item.packedQty || 0) + 1;
        item.status = item.packedQty >= item.pickedQty ? 'packed' : 'partial';
        await batch.save();
        return { match: true, item: { id: item._id, sku: item.sku, packedQty: item.packedQty } };
      }
    }
  }
  return { match: false };
};
