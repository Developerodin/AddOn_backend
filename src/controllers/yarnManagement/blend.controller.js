import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import catchAsync from '../../utils/catchAsync.js';
import * as blendService from '../../services/yarnManagement/blend.service.js';

export const createBlend = catchAsync(async (req, res) => {
  const blend = await blendService.createBlend(req.body);
  res.status(httpStatus.CREATED).send(blend);
});

export const getBlends = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await blendService.queryBlends(filter, options);
  res.send(result);
});

export const getBlend = catchAsync(async (req, res) => {
  const blend = await blendService.getBlendById(req.params.blendId);
  if (!blend) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Blend not found');
  }
  res.send(blend);
});

export const updateBlend = catchAsync(async (req, res) => {
  const blend = await blendService.updateBlendById(req.params.blendId, req.body);
  res.send(blend);
});

export const deleteBlend = catchAsync(async (req, res) => {
  await blendService.deleteBlendById(req.params.blendId);
  res.status(httpStatus.NO_CONTENT).send();
});

