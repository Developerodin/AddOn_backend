import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { VarianceApproval, DispatchApproval } from '../../models/whms/index.js';

// Variance
export const queryVarianceApprovals = async (filter, options) => {
  return VarianceApproval.paginate(filter, options);
};

export const createVarianceApproval = async (body) => {
  return VarianceApproval.create(body);
};

export const getVarianceApprovalById = async (id) => {
  return VarianceApproval.findById(id);
};

export const updateVarianceApprovalById = async (id, body) => {
  const approval = await VarianceApproval.findById(id);
  if (!approval) throw new ApiError(httpStatus.NOT_FOUND, 'Variance approval not found');
  Object.assign(approval, body);
  await approval.save();
  return approval;
};

// Dispatch
export const queryDispatchApprovals = async (filter, options) => {
  return DispatchApproval.paginate(filter, { ...options, populate: 'orderId' });
};

export const createDispatchApproval = async (body) => {
  return DispatchApproval.create(body);
};

export const getDispatchApprovalById = async (id) => {
  return DispatchApproval.findById(id).populate('orderId');
};

export const updateDispatchApprovalById = async (id, body) => {
  const approval = await DispatchApproval.findById(id);
  if (!approval) throw new ApiError(httpStatus.NOT_FOUND, 'Dispatch approval not found');
  Object.assign(approval, body);
  await approval.save();
  return approval;
};
