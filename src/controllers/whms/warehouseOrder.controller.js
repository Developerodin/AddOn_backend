import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import * as warehouseOrderService from '../../services/whms/warehouseOrder.service.js';

const createWarehouseOrder = catchAsync(async (req, res) => {
  const record = await warehouseOrderService.createWarehouseOrder(req.body);
  res.status(httpStatus.CREATED).send(record);
});

const getWarehouseOrders = catchAsync(async (req, res) => {
  const filter = warehouseOrderService.buildWarehouseOrderFilter(
    pick(req.query, [
      'status',
      'statusIn',
      'clientType',
      'clientId',
      'orderNumber',
      'q',
      'dateFrom',
      'dateTo',
      'createdFrom',
      'createdTo',
      'styleCodeId',
      'styleCodeMultiPairId',
    ])
  );
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await warehouseOrderService.queryWarehouseOrders(filter, options);
  res.send(result);
});

const getWarehouseOrder = catchAsync(async (req, res) => {
  const record = await warehouseOrderService.getWarehouseOrderById(req.params.orderId);
  if (!record) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');
  res.send(record);
});

const updateWarehouseOrder = catchAsync(async (req, res) => {
  const record = await warehouseOrderService.updateWarehouseOrderById(req.params.orderId, req.body);
  res.send(record);
});

const deleteWarehouseOrder = catchAsync(async (req, res) => {
  await warehouseOrderService.deleteWarehouseOrderById(req.params.orderId);
  res.status(httpStatus.NO_CONTENT).send();
});

export {
  createWarehouseOrder,
  getWarehouseOrders,
  getWarehouseOrder,
  updateWarehouseOrder,
  deleteWarehouseOrder,
};

