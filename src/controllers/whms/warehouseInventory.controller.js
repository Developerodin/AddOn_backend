import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import * as warehouseInventoryService from '../../services/whms/warehouseInventory.service.js';
import {
  serializeWarehouseInventory,
  serializeWarehouseInventoryPage,
  serializeWarehouseInventoryLogPage,
} from '../../utils/warehouseInventorySerializer.js';

const withLogSummary = async (record) => {
  if (!record) return null;
  const logCount = await warehouseInventoryService.countWarehouseInventoryLogsByInventoryId(record._id);
  return serializeWarehouseInventory(record, { logCount });
};

const createWarehouseInventory = catchAsync(async (req, res) => {
  const record = await warehouseInventoryService.createWarehouseInventory(req.body);
  res.status(httpStatus.CREATED).send(await withLogSummary(record));
});

const getWarehouseInventories = catchAsync(async (req, res) => {
  const filter = warehouseInventoryService.buildWarehouseInventoryFilter(req.query);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await warehouseInventoryService.queryWarehouseInventories(filter, options);
  res.send(serializeWarehouseInventoryPage(result));
});

/** Single row by exact styleCode (case-insensitive): GET .../by-style-code?styleCode=ABC */
const getWarehouseInventoryByStyleCode = catchAsync(async (req, res) => {
  const record = await warehouseInventoryService.getWarehouseInventoryByStyleCode(req.query.styleCode);
  if (!record) throw new ApiError(httpStatus.NOT_FOUND, 'No warehouse inventory for this style code');
  res.send(await withLogSummary(record));
});

const getWarehouseInventory = catchAsync(async (req, res) => {
  const record = await warehouseInventoryService.getWarehouseInventoryById(req.params.inventoryId);
  if (!record) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse inventory not found');
  res.send(await withLogSummary(record));
});

const getWarehouseInventoryLogs = catchAsync(async (req, res) => {
  const record = await warehouseInventoryService.getWarehouseInventoryById(req.params.inventoryId);
  if (!record) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse inventory not found');
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const page = await warehouseInventoryService.queryWarehouseInventoryLogsByInventoryId(
    req.params.inventoryId,
    options
  );
  res.send(serializeWarehouseInventoryLogPage(page));
});

const updateWarehouseInventory = catchAsync(async (req, res) => {
  const record = await warehouseInventoryService.updateWarehouseInventoryById(
    req.params.inventoryId,
    req.body,
    req.user?._id
  );
  res.send(await withLogSummary(record));
});

const deleteWarehouseInventory = catchAsync(async (req, res) => {
  await warehouseInventoryService.deleteWarehouseInventoryById(req.params.inventoryId);
  res.status(httpStatus.NO_CONTENT).send();
});

export {
  createWarehouseInventory,
  getWarehouseInventories,
  getWarehouseInventoryByStyleCode,
  getWarehouseInventory,
  getWarehouseInventoryLogs,
  updateWarehouseInventory,
  deleteWarehouseInventory,
};
