import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as yarnBoxService from '../../services/yarnManagement/yarnBox.service.js';
import pick from '../../utils/pick.js';

export const createYarnBox = catchAsync(async (req, res) => {
  const yarnBox = await yarnBoxService.createYarnBox(req.body);
  res.status(httpStatus.CREATED).send(yarnBox);
});

export const updateYarnBox = catchAsync(async (req, res) => {
  const { yarnBoxId } = req.params;
  const yarnBox = await yarnBoxService.updateYarnBoxById(yarnBoxId, req.body);
  res.status(httpStatus.OK).send(yarnBox);
});

export const bulkCreateYarnBoxes = catchAsync(async (req, res) => {
  const yarnBoxes = await yarnBoxService.bulkCreateYarnBoxes(req.body);
  res.status(httpStatus.CREATED).send(yarnBoxes);
});

export const getYarnBoxes = catchAsync(async (req, res) => {
  const filters = pick(req.query, ['po_number', 'yarn_name', 'shade_code', 'storage_location', 'cones_issued']);
  const yarnBoxes = await yarnBoxService.queryYarnBoxes(filters);
  res.status(httpStatus.OK).send(yarnBoxes);
});


