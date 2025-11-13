import httpStatus from 'http-status';
import { YarnCone } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import { yarnConeIssueStatuses, yarnConeReturnStatuses } from '../../models/yarnReq/yarnCone.model.js';

export const createYarnCone = async (yarnConeBody) => {
  const existingBarcode = await YarnCone.findOne({ barcode: yarnConeBody.barcode });
  if (existingBarcode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Barcode already exists');
  }

  if (yarnConeBody.issueStatus && !yarnConeIssueStatuses.includes(yarnConeBody.issueStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid issue status');
  }

  if (yarnConeBody.returnStatus && !yarnConeReturnStatuses.includes(yarnConeBody.returnStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid return status');
  }

  const yarnCone = await YarnCone.create(yarnConeBody);
  return yarnCone;
};

export const updateYarnConeById = async (yarnConeId, updateBody) => {
  const yarnCone = await YarnCone.findById(yarnConeId);
  if (!yarnCone) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn cone not found');
  }

  if (updateBody.barcode && updateBody.barcode !== yarnCone.barcode) {
    const existingBarcode = await YarnCone.findOne({ barcode: updateBody.barcode, _id: { $ne: yarnConeId } });
    if (existingBarcode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Barcode already exists');
    }
  }

  if (updateBody.issueStatus && !yarnConeIssueStatuses.includes(updateBody.issueStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid issue status');
  }

  if (updateBody.returnStatus && !yarnConeReturnStatuses.includes(updateBody.returnStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid return status');
  }

  Object.assign(yarnCone, updateBody);
  await yarnCone.save();
  return yarnCone;
};

export const queryYarnCones = async (filters = {}) => {
  const mongooseFilter = {};

  if (filters.po_number) {
    mongooseFilter.poNumber = filters.po_number;
  }

  if (filters.box_id) {
    mongooseFilter.boxId = filters.box_id;
  }

  if (filters.issue_status) {
    mongooseFilter.issueStatus = filters.issue_status;
  }

  if (filters.return_status) {
    mongooseFilter.returnStatus = filters.return_status;
  }

  if (filters.storage_id) {
    mongooseFilter.coneStorageId = filters.storage_id;
  }

  if (filters.yarn_name) {
    mongooseFilter.yarnName = { $regex: filters.yarn_name, $options: 'i' };
  }

  if (filters.yarn_id) {
    mongooseFilter.yarn = filters.yarn_id;
  }

  if (filters.shade_code) {
    mongooseFilter.shadeCode = { $regex: filters.shade_code, $options: 'i' };
  }

  if (filters.barcode) {
    mongooseFilter.barcode = filters.barcode;
  }

  const yarnCones = await YarnCone.find(mongooseFilter)
    .populate({
      path: 'yarn',
      select: '_id yarnName yarnType status',
    })
    .sort({ createdAt: -1 })
    .lean();

  return yarnCones;
};


