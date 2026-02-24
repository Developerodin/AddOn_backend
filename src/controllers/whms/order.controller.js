import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import * as whmsOrderService from '../../services/whms/order.service.js';

const createOrder = catchAsync(async (req, res) => {
  const order = await whmsOrderService.createOrder(req.body);
  res.status(httpStatus.CREATED).send(order);
});

const getOrders = catchAsync(async (req, res) => {
  const query = pick(req.query, [
    'status',
    'channel',
    'orderNumber',
    'stockBlockStatus',
    'lifecycleStatus',
    'dateFrom',
    'dateTo',
    'sortBy',
    'limit',
    'page',
  ]);
  const { dateFrom, dateTo, ...rest } = query;
  const filter = { ...rest };
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }
  const options = pick(query, ['sortBy', 'limit', 'page']);
  const result = await whmsOrderService.queryOrders(filter, options);
  res.send(result);
});

const getOrder = catchAsync(async (req, res) => {
  const order = await whmsOrderService.getOrderById(req.params.orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  res.send(order);
});

const updateOrder = catchAsync(async (req, res) => {
  const order = await whmsOrderService.updateOrderById(req.params.orderId, req.body);
  res.send(order);
});

const saveTracking = catchAsync(async (req, res) => {
  const order = await whmsOrderService.saveTrackingAndDispatch(req.params.orderId, req.body);
  res.send(order);
});

const deleteOrder = catchAsync(async (req, res) => {
  await whmsOrderService.deleteOrderById(req.params.orderId);
  res.status(httpStatus.NO_CONTENT).send();
});

export { createOrder, getOrders, getOrder, updateOrder, saveTracking, deleteOrder };
