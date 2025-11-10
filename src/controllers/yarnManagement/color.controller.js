import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import catchAsync from '../../utils/catchAsync.js';
import * as colorService from '../../services/yarnManagement/color.service.js';

export const createColor = catchAsync(async (req, res) => {
  const color = await colorService.createColor(req.body);
  res.status(httpStatus.CREATED).send(color);
});

export const getColors = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await colorService.queryColors(filter, options);
  res.send(result);
});

export const getColor = catchAsync(async (req, res) => {
  const color = await colorService.getColorById(req.params.colorId);
  if (!color) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Color not found');
  }
  res.send(color);
});

export const updateColor = catchAsync(async (req, res) => {
  const color = await colorService.updateColorById(req.params.colorId, req.body);
  res.send(color);
});

export const deleteColor = catchAsync(async (req, res) => {
  await colorService.deleteColorById(req.params.colorId);
  res.status(httpStatus.NO_CONTENT).send();
});

