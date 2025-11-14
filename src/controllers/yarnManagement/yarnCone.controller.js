import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import * as yarnConeService from '../../services/yarnManagement/yarnCone.service.js';

export const createYarnCone = catchAsync(async (req, res) => {
  const yarnCone = await yarnConeService.createYarnCone(req.body);
  res.status(httpStatus.CREATED).send(yarnCone);
});

export const updateYarnCone = catchAsync(async (req, res) => {
  const { yarnConeId } = req.params;
  const yarnCone = await yarnConeService.updateYarnConeById(yarnConeId, req.body);
  res.status(httpStatus.OK).send(yarnCone);
});

export const getYarnCones = catchAsync(async (req, res) => {
  const filters = pick(req.query, [
    'po_number',
    'box_id',
    'issue_status',
    'return_status',
    'storage_id',
    'yarn_name',
    'yarn_id',
    'shade_code',
    'barcode',
  ]);
  const yarnCones = await yarnConeService.queryYarnCones(filters);
  res.status(httpStatus.OK).send(yarnCones);
});

export const generateConesByBox = catchAsync(async (req, res) => {
  const { boxId } = req.params;
  const result = await yarnConeService.generateConesByBox(boxId, req.body);
  const statusCode = result.created ? httpStatus.CREATED : httpStatus.OK;
  res.status(statusCode).send(result);
});


