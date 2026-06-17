import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import catchAsync from '../../utils/catchAsync.js';
import * as vendorM2Service from '../../services/vendorManagement/vendorM2Management.service.js';
import * as vendorM3Service from '../../services/vendorManagement/vendorM3Management.service.js';
import * as vendorM4Service from '../../services/vendorManagement/vendorM4Management.service.js';

// ==================== M2 MANAGEMENT ====================

export const getM2Entries = catchAsync(async (req, res) => {
  const filter = pick(req.query, [
    'vendorProductionFlowId',
    'sourceFloor',
    'status',
    'search',
    'includeResolved',
    'vpoNumber',
  ]);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  if (options.limit) options.limit = parseInt(options.limit, 10);
  if (options.page) options.page = parseInt(options.page, 10);
  const result = await vendorM2Service.getM2Entries(filter, options);
  res.send(result);
});

export const getM2Logs = catchAsync(async (req, res) => {
  const filter = pick(req.query, [
    'vendorProductionFlowId',
    'type',
    'sourceFloor',
    'entryId',
    'dateFrom',
    'dateTo',
    'search',
    'vpoNumber',
  ]);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  if (options.limit) options.limit = parseInt(options.limit, 10);
  if (options.page) options.page = parseInt(options.page, 10);
  const result = await vendorM2Service.getM2Logs(filter, options);
  res.send(result);
});

export const getM2Statistics = catchAsync(async (req, res) => {
  const stats = await vendorM2Service.getM2Statistics();
  res.send(stats);
});

export const markM2MergeToM1 = catchAsync(async (req, res) => {
  const { entryId } = req.params;
  const result = await vendorM2Service.markM2MergeToM1(entryId, req.body, req.user);
  res.status(httpStatus.OK).send(result);
});

export const markM2TransferToM3 = catchAsync(async (req, res) => {
  const { entryId } = req.params;
  const result = await vendorM2Service.markM2TransferToM3(entryId, req.body, req.user);
  res.status(httpStatus.OK).send(result);
});

export const markM2TransferToM4 = catchAsync(async (req, res) => {
  const { entryId } = req.params;
  const result = await vendorM2Service.markM2TransferToM4(entryId, req.body, req.user);
  res.status(httpStatus.OK).send(result);
});

// ==================== M3 MANAGEMENT ====================

export const getM3Flows = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['vendor', 'vendorPurchaseOrder', 'search']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  if (options.limit) options.limit = parseInt(options.limit, 10);
  if (options.page) options.page = parseInt(options.page, 10);
  const result = await vendorM3Service.getM3Flows(filter, options);
  res.send(result);
});

export const getM3Logs = catchAsync(async (req, res) => {
  const filter = pick(req.query, [
    'vendorProductionFlowId',
    'type',
    'sourceFloor',
    'dateFrom',
    'dateTo',
    'search',
    'vpoNumber',
  ]);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  if (options.limit) options.limit = parseInt(options.limit, 10);
  if (options.page) options.page = parseInt(options.page, 10);
  const result = await vendorM3Service.getM3Logs(filter, options);
  res.send(result);
});

export const getM3Statistics = catchAsync(async (req, res) => {
  const stats = await vendorM3Service.getM3Statistics();
  res.send(stats);
});

export const markM3Outward = catchAsync(async (req, res) => {
  const { flowId } = req.params;
  const result = await vendorM3Service.markM3Outward(flowId, req.body, req.user);
  res.status(httpStatus.OK).send(result);
});

// ==================== M4 MANAGEMENT ====================

export const getM4Flows = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['vendor', 'vendorPurchaseOrder', 'search']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  if (options.limit) options.limit = parseInt(options.limit, 10);
  if (options.page) options.page = parseInt(options.page, 10);
  const result = await vendorM4Service.getM4Flows(filter, options);
  res.send(result);
});

export const getM4Logs = catchAsync(async (req, res) => {
  const filter = pick(req.query, [
    'vendorProductionFlowId',
    'type',
    'sourceFloor',
    'dateFrom',
    'dateTo',
    'search',
    'vpoNumber',
  ]);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  if (options.limit) options.limit = parseInt(options.limit, 10);
  if (options.page) options.page = parseInt(options.page, 10);
  const result = await vendorM4Service.getM4Logs(filter, options);
  res.send(result);
});

export const getM4Statistics = catchAsync(async (req, res) => {
  const stats = await vendorM4Service.getM4Statistics();
  res.send(stats);
});

export const markM4Outward = catchAsync(async (req, res) => {
  const { flowId } = req.params;
  const result = await vendorM4Service.markM4Outward(flowId, req.body, req.user);
  res.status(httpStatus.OK).send(result);
});
