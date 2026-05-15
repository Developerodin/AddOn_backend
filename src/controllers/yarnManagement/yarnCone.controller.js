import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import * as yarnConeService from '../../services/yarnManagement/yarnCone.service.js';

import * as yarnConeFloorIssueService from '../../services/yarnManagement/yarnConeFloorIssue.service.js';

export const createFloorIssueBatch = catchAsync(async (req, res) => {
  const email = req.user?.email;
  if (!email) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required to create a floor issue batch.');
  }
  const batch = await yarnConeFloorIssueService.createFloorIssueBatch({
    floor: req.body.floor,
    issuedByEmail: email,
  });
  res.status(httpStatus.CREATED).send(batch);
});

export const issueConeForFloor = catchAsync(async (req, res) => {
  const email = req.user?.email;
  if (!email) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required to issue cones for linking or sampling.');
  }
  const result = await yarnConeFloorIssueService.issueConeForFloor({ ...req.body, issuedByEmail: email });
  res.status(httpStatus.OK).send(result);
});
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
    'order_id',
    'article_id',
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

export const getYarnConeByBarcode = catchAsync(async (req, res) => {
  const { barcode } = req.params;
  const { expected_order_id, expected_article_id } = pick(req.query, [
    'expected_order_id',
    'expected_article_id',
  ]);
  const yarnCone = await yarnConeService.getYarnConeByBarcode(barcode, {
    expectedOrderId: expected_order_id,
    expectedArticleId: expected_article_id,
  });
  res.status(httpStatus.OK).send(yarnCone);
});

export const getShortTermConesByBoxId = catchAsync(async (req, res) => {
  const { boxId } = req.params;
  const cones = await yarnConeService.getShortTermConesByBoxId(boxId);
  res.status(httpStatus.OK).send(cones);
});

export const generateConesByBox = catchAsync(async (req, res) => {
  const { boxId } = req.params;
  const result = await yarnConeService.generateConesByBox(boxId, req.body);
  const statusCode = result.created ? httpStatus.CREATED : httpStatus.OK;
  res.status(statusCode).send(result);
});

export const returnYarnCone = catchAsync(async (req, res) => {
  const { barcode } = req.params;
  const returnData = pick(req.body, [
    'returnWeight',
    'returnBy',
    'returnDate',
    'coneStorageId',
    'orderId',
    'productionOrderId',
    'articleId',
  ]);
  
  const result = await yarnConeService.returnYarnCone(barcode, returnData);
  res.status(httpStatus.OK).send(result);
});

export const getConesByStorageLocation = catchAsync(async (req, res) => {
  const { storageLocation } = req.params;
  const cones = await yarnConeService.getConesByStorageLocation(storageLocation);
  res.status(httpStatus.OK).send(cones);
});

export const getConesWithoutStorageLocation = catchAsync(async (req, res) => {
  const cones = await yarnConeService.getConesWithoutStorageLocation();
  res.status(httpStatus.OK).send(cones);
});

export const bulkSetConeStorageLocation = catchAsync(async (req, res) => {
  const result = await yarnConeService.bulkSetConeStorageLocation(req.body);
  res.status(httpStatus.OK).send(result);
});


