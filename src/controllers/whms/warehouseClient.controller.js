import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import * as warehouseClientService from '../../services/whms/warehouseClient.service.js';

const createWarehouseClient = catchAsync(async (req, res) => {
  const record = await warehouseClientService.createWarehouseClient(req.body);
  res.status(httpStatus.CREATED).send(record);
});

const getWarehouseClients = catchAsync(async (req, res) => {
  const filter = warehouseClientService.buildWarehouseClientFilter(req.query);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await warehouseClientService.queryWarehouseClients(filter, options);
  res.send(result);
});

const getWarehouseClient = catchAsync(async (req, res) => {
  const record = await warehouseClientService.getWarehouseClientById(req.params.clientId);
  if (!record) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse client not found');
  res.send(record);
});

const updateWarehouseClient = catchAsync(async (req, res) => {
  const record = await warehouseClientService.updateWarehouseClientById(req.params.clientId, req.body);
  res.send(record);
});

const deleteWarehouseClient = catchAsync(async (req, res) => {
  await warehouseClientService.deleteWarehouseClientById(req.params.clientId);
  res.status(httpStatus.NO_CONTENT).send();
});

export {
  createWarehouseClient,
  getWarehouseClients,
  getWarehouseClient,
  updateWarehouseClient,
  deleteWarehouseClient,
};
