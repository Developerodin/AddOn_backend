import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as yarnReqService from '../../services/yarnManagement/yarnReq.service.js';

export const getYarnRequisitionList = catchAsync(async (req, res) => {
  const { startDate, endDate, poSent, alertStatus, page, limit, skipRecalculation } = req.query;
  const result = await yarnReqService.getYarnRequisitionList({
    startDate,
    endDate,
    poSent,
    alertStatus,
    page,
    limit,
    skipRecalculation: skipRecalculation === 'true',
  });
  res.status(httpStatus.OK).send(result);
});

export const createYarnRequisition = catchAsync(async (req, res) => {
  const yarnRequisition = await yarnReqService.createYarnRequisition(req.body);
  res.status(httpStatus.CREATED).send(yarnRequisition);
});

export const updateYarnRequisitionStatus = catchAsync(async (req, res) => {
  const { yarnRequisitionId } = req.params;
  const { poSent } = req.body;
  const yarnRequisition = await yarnReqService.updateYarnRequisitionStatus(yarnRequisitionId, poSent);
  res.status(httpStatus.OK).send(yarnRequisition);
});


