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
    workflowStage,
    includeDismissed,
    preferredSupplierId,
    supplierName,
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
    workflowStage,
    includeDismissed,
    preferredSupplierId,
    supplierName,
  });
  res.status(httpStatus.OK).send(result);
});

export const createYarnRequisition = catchAsync(async (req, res) => {
  const yarnRequisition = await yarnReqService.createYarnRequisition(req.body);
  res.status(httpStatus.CREATED).send(yarnRequisition);
});

/** PATCH supplier + optional staging (“Send to PO draft”) with supplier draft merge semantics. */
export const patchYarnRequisition = catchAsync(async (req, res) => {
  const { yarnRequisitionId } = req.params;
  const updated = await yarnReqService.patchYarnRequisition(yarnRequisitionId, req.body);
  res.status(httpStatus.OK).send(updated);
});

/** Soft-dismiss a requisition row. */
export const dismissYarnRequisition = catchAsync(async (req, res) => {
  const { yarnRequisitionId } = req.params;
  const updated = await yarnReqService.dismissYarnRequisition(yarnRequisitionId);
  res.status(httpStatus.OK).send(updated);
});

export const clearRequisitionDraftFlags = catchAsync(async (req, res) => {
  const { requisitionIds, linkedPurchaseOrderId } = req.body;
  const result = await yarnReqService.clearRequisitionDraftFlags(requisitionIds, linkedPurchaseOrderId);
  res.status(httpStatus.OK).send(result);
});

