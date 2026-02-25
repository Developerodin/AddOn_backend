import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { WhmsOrder } from '../../models/whms/index.js';
import { enrichItemsWithProduct } from './productResolution.service.js';

const generateOrderNumber = async () => {
  const last = await WhmsOrder.findOne().sort({ createdAt: -1 }).select('orderNumber');
  const seq = last?.orderNumber ? parseInt(last.orderNumber.replace(/\D/g, ''), 10) + 1 : 1;
  return `ORD-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
};

export const createOrder = async (body) => {
  if (!body.orderNumber) body.orderNumber = await generateOrderNumber();
  const order = await WhmsOrder.create(body);
  return order;
};

export const queryOrders = async (filter, options) => {
  const result = await WhmsOrder.paginate(filter, options);
  if (result.results?.length) {
    result.results = await Promise.all(
      result.results.map(async (o) => {
        const doc = o.toObject ? o.toObject() : o;
        if (doc.items?.length) doc.items = await enrichItemsWithProduct(doc.items);
        return doc;
      })
    );
  }
  return result;
};

export const getOrderById = async (id) => {
  const order = await WhmsOrder.findById(id).populate('items.productId', 'name image softwareCode internalCode');
  if (!order) return null;
  const doc = order.toObject ? order.toObject() : order;
  if (doc.items?.length) doc.items = await enrichItemsWithProduct(doc.items);
  return doc;
};

export const updateOrderById = async (id, updateBody) => {
  const order = await WhmsOrder.findById(id);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  Object.assign(order, updateBody);
  await order.save();
  return getOrderById(id);
};

export const saveTrackingAndDispatch = async (id, tracking) => {
  const order = await WhmsOrder.findById(id);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  order.tracking = tracking;
  order.status = 'dispatched';
  order.lifecycleStatus = 'dispatched';
  order.stockBlockStatus = 'available';
  order.actualDispatchDate = new Date();
  await order.save();
  return getOrderById(id);
};

export const setStockBlockStatus = async (id, stockBlockStatus) => {
  const order = await WhmsOrder.findById(id);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  order.stockBlockStatus = stockBlockStatus;
  await order.save();
  return order;
};

export const setPickBlockForOrderIds = async (orderIds) => {
  await WhmsOrder.updateMany(
    { _id: { $in: orderIds } },
    { $set: { stockBlockStatus: 'pick-block' } }
  );
};

export const deleteOrderById = async (id) => {
  const order = await WhmsOrder.findById(id);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  await WhmsOrder.findByIdAndDelete(id);
};
