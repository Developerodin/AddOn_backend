import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import * as approvalsService from '../../services/whms/approvals.service.js';

// Variance
const getVarianceApprovals = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['type', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await approvalsService.queryVarianceApprovals(filter, options);
  res.send(result);
});

const createVarianceApproval = catchAsync(async (req, res) => {
  const approval = await approvalsService.createVarianceApproval(req.body);
  res.status(httpStatus.CREATED).send(approval);
});

const updateVarianceApproval = catchAsync(async (req, res) => {
  const approval = await approvalsService.updateVarianceApprovalById(req.params.id, req.body);
  res.send(approval);
});

// Dispatch
const getDispatchApprovals = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'orderId']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await approvalsService.queryDispatchApprovals(filter, options);
  res.send(result);
});

const createDispatchApproval = catchAsync(async (req, res) => {
  const approval = await approvalsService.createDispatchApproval(req.body);
  res.status(httpStatus.CREATED).send(approval);
});

const updateDispatchApproval = catchAsync(async (req, res) => {
  const approval = await approvalsService.updateDispatchApprovalById(req.params.id, req.body);
  res.send(approval);
});

export {
  getVarianceApprovals,
  createVarianceApproval,
  updateVarianceApproval,
  getDispatchApprovals,
  createDispatchApproval,
  updateDispatchApproval,
};
