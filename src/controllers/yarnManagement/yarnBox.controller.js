import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as yarnBoxService from '../../services/yarnManagement/yarnBox.service.js';
import * as yarnBoxTransferService from '../../services/yarnManagement/yarnBoxTransfer.service.js';
import pick from '../../utils/pick.js';

export const createYarnBox = catchAsync(async (req, res) => {
  const yarnBox = await yarnBoxService.createYarnBox(req.body);
  res.status(httpStatus.CREATED).send(yarnBox);
});

export const getYarnBox = catchAsync(async (req, res) => {
  const { yarnBoxId } = req.params;
  const yarnBox = await yarnBoxService.getYarnBoxById(yarnBoxId);
  res.status(httpStatus.OK).send(yarnBox);
});

export const getYarnBoxByBarcode = catchAsync(async (req, res) => {
  const { barcode } = req.params;
  const includeInactive = req.query?.include_inactive;
  const yarnBox = await yarnBoxService.getYarnBoxByBarcode(barcode, { includeInactive });
  res.status(httpStatus.OK).send(yarnBox);
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

export const bulkMatchUpdateYarnBoxes = catchAsync(async (req, res) => {
  const result = await yarnBoxService.bulkMatchUpdateYarnBoxes(req.body);
  res.status(httpStatus.OK).send(result);
});

export const getYarnBoxes = catchAsync(async (req, res) => {
  const filters = pick(req.query, [
    'po_number',
    'yarn_name',
    'shade_code',
    'storage_location',
    'cones_issued',
    'stored_status',
    'include_inactive',
    'limit',
  ]);
  const yarnBoxes = await yarnBoxService.queryYarnBoxes(filters);
  res.status(httpStatus.OK).send(yarnBoxes);
});

export const updateQcStatusByPoNumber = catchAsync(async (req, res) => {
  const { poNumber } = req.body;
  const { status, ...qcData } = req.body;
  const result = await yarnBoxService.updateQcStatusByPoNumber(poNumber, status, qcData);
  res.status(httpStatus.OK).send(result);
});

export const transferBoxes = catchAsync(async (req, res) => {
  const result = await yarnBoxTransferService.transferBoxes(req.body);
  res.status(httpStatus.OK).send(result);
});

export const transferBoxesToShortTerm = catchAsync(async (req, res) => {
  const result = await yarnBoxTransferService.transferBoxesToShortTerm(req.body);
  res.status(httpStatus.OK).send(result);
});

export const getBoxesByStorageLocation = catchAsync(async (req, res) => {
  const { storageLocation } = req.params;
  const boxes = await yarnBoxService.getBoxesByStorageLocation(storageLocation);
  res.status(httpStatus.OK).send(boxes);
});

export const getBoxesWithoutStorageLocation = catchAsync(async (req, res) => {
  const boxes = await yarnBoxService.getBoxesWithoutStorageLocation({
    yarn_name: req.query.yarn_name,
  });
  res.status(httpStatus.OK).send(boxes);
});

export const bulkSetBoxStorageLocation = catchAsync(async (req, res) => {
  const result = await yarnBoxService.bulkSetBoxStorageLocation(req.body);
  res.status(httpStatus.OK).send(result);
});

export const resetBoxesWeightToZeroIfStConesPresent = catchAsync(async (req, res) => {
  const { poNumber, dryRun } = req.body;
  const result = await yarnBoxService.resetBoxesWeightToZeroIfStConesPresent({ poNumber, dryRun });
  res.status(httpStatus.OK).send(result);
});

export const backfillLtBoxWeightFromStCones = catchAsync(async (req, res) => {
  const { dryRun, limit, onlyBoxId } = req.body;
  const result = await yarnBoxService.backfillLtBoxWeightFromStCones({ dryRun, limit, onlyBoxId });
  res.status(httpStatus.OK).send(result);
});


