import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as yarnReqService from '../../services/yarnManagement/yarnReq.service.js';

export const getYarnRequisitionList = catchAsync(async (req, res) => {
  const {
    startDate,
    endDate,
    poSent,
    draftForPo,
    alertStatus,
    page,
    limit,
    skipRecalculation,
    yarnName,
    lastUpdatedFrom,
    lastUpdatedTo,
    sortBy,
    sortOrder,
  } = req.query;
  const result = await yarnReqService.getYarnRequisitionList({
    startDate,
    endDate,
    poSent,
    draftForPo,
    alertStatus,
    page,
    limit,
    skipRecalculation: skipRecalculation === 'true',
    yarnName,
    lastUpdatedFrom,
    lastUpdatedTo,
    sortBy,
    sortOrder,
  });
  res.status(httpStatus.OK).send(result);
});

export const createYarnRequisition = catchAsync(async (req, res) => {
  const yarnRequisition = await yarnReqService.createYarnRequisition(req.body);
  res.status(httpStatus.CREATED).send(yarnRequisition);
});

export const updateYarnRequisitionStatus = catchAsync(async (req, res) => {
  const { yarnRequisitionId } = req.params;
  const { poSent, draftForPo } = req.body;
  const yarnRequisition = await yarnReqService.updateYarnRequisitionStatus(yarnRequisitionId, {
    poSent,
    draftForPo,
  });
  res.status(httpStatus.OK).send(yarnRequisition);
});

export const clearRequisitionDraftFlags = catchAsync(async (req, res) => {
  const result = await yarnReqService.clearRequisitionDraftFlags(req.body.requisitionIds);
  res.status(httpStatus.OK).send(result);
});


