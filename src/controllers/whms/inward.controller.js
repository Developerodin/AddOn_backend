import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import * as inwardService from '../../services/whms/inward.service.js';

const createInward = catchAsync(async (req, res) => {
  const record = await inwardService.createInward(req.body);
  res.status(httpStatus.CREATED).send(record);
});

const getInwardList = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'supplier', 'reference', 'dateFrom', 'dateTo']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await inwardService.queryInward(filter, options);
  res.send(result);
});

const getInward = catchAsync(async (req, res) => {
  const record = await inwardService.getInwardById(req.params.id);
  if (!record) throw new ApiError(httpStatus.NOT_FOUND, 'GRN not found');
  res.send(record);
});

const updateInward = catchAsync(async (req, res) => {
  const record = await inwardService.updateInwardById(req.params.id, req.body);
  res.send(record);
});

export { createInward, getInwardList, getInward, updateInward };
