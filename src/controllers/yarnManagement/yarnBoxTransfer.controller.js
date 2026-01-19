import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as yarnBoxTransferService from '../../services/yarnManagement/yarnBoxTransfer.service.js';

/**
 * Transfer boxes from long-term to short-term storage
 */
export const transferBoxesToShortTerm = catchAsync(async (req, res) => {
  const result = await yarnBoxTransferService.transferBoxesToShortTerm(req.body);
  res.status(httpStatus.OK).send(result);
});

/**
 * Get storage location history and remaining inventory
 */
export const getStorageLocationHistory = catchAsync(async (req, res) => {
  const { storageLocation } = req.params;
  const history = await yarnBoxTransferService.getStorageLocationHistory(storageLocation);
  res.status(httpStatus.OK).send(history);
});
