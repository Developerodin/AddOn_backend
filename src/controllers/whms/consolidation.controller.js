import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import * as consolidationService from '../../services/whms/consolidation.service.js';

const createBatch = catchAsync(async (req, res) => {
  const batch = await consolidationService.createBatch(req.body);
  res.status(httpStatus.CREATED).send(batch);
});

const getBatches = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await consolidationService.queryBatches(filter, options);
  res.send(result);
});

const getBatch = catchAsync(async (req, res) => {
  const batch = await consolidationService.getBatchById(req.params.id);
  if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Batch not found');
  res.send(batch);
});

const updateBatch = catchAsync(async (req, res) => {
  const batch = await consolidationService.updateBatchById(req.params.id, req.body);
  res.send(batch);
});

const setBatchStatus = catchAsync(async (req, res) => {
  const { status } = req.body;
  const batch = await consolidationService.setBatchStatus(req.params.id, status);
  res.send(batch);
});

export { createBatch, getBatches, getBatch, updateBatch, setBatchStatus };
