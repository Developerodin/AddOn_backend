import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import ApiError from '../../utils/ApiError.js';
import * as pickPackService from '../../services/whms/pickPack.service.js';
import pick from '../../utils/pick.js';

// Pick list
const getPickList = catchAsync(async (req, res) => {
  const { batchId } = req.query;
  const list = await pickPackService.getPickList(batchId);
  // When no batchId: no active list is valid — return 200 with null so frontend can show "No pick list" / Generate
  if (!list && batchId) throw new ApiError(httpStatus.NOT_FOUND, 'Pick list not found');
  res.send(list ?? null);
});

const generatePickList = catchAsync(async (req, res) => {
  const list = await pickPackService.generatePickList(req.body);
  res.status(httpStatus.CREATED).send(list);
});

const updatePickListItem = catchAsync(async (req, res) => {
  const { listId, itemId } = req.params;
  const list = await pickPackService.updatePickItem(listId, itemId, req.body);
  res.send(list);
});

const confirmPick = catchAsync(async (req, res) => {
  const list = await pickPackService.confirmPick(req.body);
  res.send(list);
});

const skipPickItem = catchAsync(async (req, res) => {
  const list = await pickPackService.skipPickItem(req.body);
  res.send(list);
});

const scanPick = catchAsync(async (req, res) => {
  const result = await pickPackService.scanPick(req.body);
  res.send(result);
});

// Pack list
const getPackList = catchAsync(async (req, res) => {
  const { batchId } = req.query;
  const list = await pickPackService.getPackList(batchId);
  if (batchId && !list) throw new ApiError(httpStatus.NOT_FOUND, 'Pack list not found');
  res.send(list || { batches: [] });
});

const createPackBatch = catchAsync(async (req, res) => {
  const batch = await pickPackService.createPackBatch(req.body);
  res.status(httpStatus.CREATED).send(batch);
});

const getPackBatch = catchAsync(async (req, res) => {
  const batch = await pickPackService.getPackBatchById(req.params.batchId);
  res.send(batch);
});

const updatePackItemQty = catchAsync(async (req, res) => {
  const { batchId, orderId, itemId } = req.params;
  const { packedQty } = req.body;
  const batch = await pickPackService.updatePackItemQty(batchId, orderId, itemId, packedQty);
  res.send(batch);
});

const addCarton = catchAsync(async (req, res) => {
  const batch = await pickPackService.addCarton(req.params.batchId);
  res.status(httpStatus.CREATED).send(batch);
});

const updateCarton = catchAsync(async (req, res) => {
  const { batchId, cartonId } = req.params;
  const batch = await pickPackService.updateCarton(batchId, cartonId, req.body);
  res.send(batch);
});

const completePackBatch = catchAsync(async (req, res) => {
  const batch = await pickPackService.completePackBatch(req.params.batchId);
  res.send(batch);
});

// Barcode
const generateBarcodes = catchAsync(async (req, res) => {
  const result = await pickPackService.generateBarcodes(req.body);
  res.send(result);
});

// Damage/Missing
const createDamageMissingReport = catchAsync(async (req, res) => {
  const report = await pickPackService.createDamageMissingReport(req.body, req.user);
  res.status(httpStatus.CREATED).send(report);
});

const getDamageMissingReports = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['orderId', 'dateFrom', 'dateTo']);
  const options = pick(req.query, ['limit', 'page']);
  const result = await pickPackService.queryDamageMissingReports(filter, options);
  res.send(result);
});

// Scan pack
const scanPack = catchAsync(async (req, res) => {
  const result = await pickPackService.scanPack(req.body);
  res.send(result);
});

export {
  getPickList,
  generatePickList,
  updatePickListItem,
  confirmPick,
  skipPickItem,
  scanPick,
  getPackList,
  createPackBatch,
  getPackBatch,
  updatePackItemQty,
  addCarton,
  updateCarton,
  completePackBatch,
  generateBarcodes,
  createDamageMissingReport,
  getDamageMissingReports,
  scanPack,
};
