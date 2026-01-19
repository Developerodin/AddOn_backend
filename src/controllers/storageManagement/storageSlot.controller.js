import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as storageSlotService from '../../services/storageManagement/storageSlot.service.js';
import * as yarnBoxTransferService from '../../services/yarnManagement/yarnBoxTransfer.service.js';

export const getStorageSlots = catchAsync(async (req, res) => {
  const result = await storageSlotService.queryStorageSlots(req.query);
  res.status(httpStatus.OK).send(result);
});

export const getStorageSlotsByZone = catchAsync(async (req, res) => {
  const result = await storageSlotService.getStorageSlotsByZone(req.params.zone, req.query);
  res.status(httpStatus.OK).send(result);
});

export const getStorageContentsByBarcode = catchAsync(async (req, res) => {
  const result = await storageSlotService.getStorageContentsByBarcode(req.params.barcode);
  res.status(httpStatus.OK).send(result);
});

export const getStorageLocationHistory = catchAsync(async (req, res) => {
  const { storageLocation } = req.params;
  const history = await yarnBoxTransferService.getStorageLocationHistory(storageLocation);
  res.status(httpStatus.OK).send(history);
});


