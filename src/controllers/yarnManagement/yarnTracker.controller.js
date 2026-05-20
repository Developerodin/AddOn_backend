import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as yarnTrackerService from '../../services/yarnManagement/yarnTracker.service.js';

export const getBoxTrackerByBarcode = catchAsync(async (req, res) => {
  const { barcode } = req.params;
  const includeInactive = req.query?.include_inactive;
  const data = await yarnTrackerService.getBoxTrackerByBarcode(barcode, { includeInactive });
  res.status(httpStatus.OK).send(data);
});

export const getConeTrackerByBarcode = catchAsync(async (req, res) => {
  const { barcode } = req.params;
  const includeInactive = req.query?.include_inactive;
  const data = await yarnTrackerService.getConeTrackerByBarcode(barcode, { includeInactive });
  res.status(httpStatus.OK).send(data);
});
