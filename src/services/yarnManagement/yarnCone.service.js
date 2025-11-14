import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnCone, YarnBox } from '../../models/index.js';
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

export const generateConesByBox = async (boxId, options = {}) => {
  const yarnBox = await YarnBox.findOne({ boxId });

  if (!yarnBox) {
    throw new ApiError(httpStatus.NOT_FOUND, `Yarn box not found for boxId: ${boxId}`);
  }

  const existingConeCount = await YarnCone.countDocuments({ boxId: yarnBox.boxId });
  const force = Boolean(options.force);

  if (existingConeCount > 0 && !force) {
    const existingCones = await YarnCone.find({ boxId: yarnBox.boxId }).lean();
    const boxData = yarnBox.toObject();

    return {
      message: `Yarn cones already exist for box ${boxId}`,
      created: false,
      box: boxData,
      cones: existingCones,
    };
  }

  if (existingConeCount > 0 && force) {
    await YarnCone.deleteMany({ boxId: yarnBox.boxId });
  }

  const numberOfCones =
    options.numberOfCones ??
    yarnBox.numberOfCones ??
    yarnBox?.coneData?.numberOfCones;

  if (!numberOfCones || numberOfCones <= 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Number of cones must be provided and greater than zero'
    );
  }

  const issueStatus = options.issueStatus ?? 'not_issued';
  if (!yarnConeIssueStatuses.includes(issueStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid issue status');
  }

  const returnStatus = options.returnStatus ?? 'not_returned';
  if (!yarnConeReturnStatuses.includes(returnStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid return status');
  }

  const toDate = (value) => (value ? new Date(value) : undefined);
  const safeNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const derivedConeWeight =
    options.coneWeight ??
    (yarnBox.boxWeight && numberOfCones
      ? safeNumber(yarnBox.boxWeight / numberOfCones)
      : null);

  const derivedTearWeight =
    options.tearWeight ?? safeNumber(yarnBox.tearweight);

  const derivedIssueWeight =
    options.issueWeight ?? derivedConeWeight ?? null;

  const derivedReturnWeight =
    options.returnWeight ?? derivedConeWeight ?? null;

  const derivedStorageId =
    options.coneStorageId ?? yarnBox.storageLocation ?? null;

  const basePayload = {
    poNumber: yarnBox.poNumber,
    boxId: yarnBox.boxId,
    coneWeight: derivedConeWeight,
    tearWeight: derivedTearWeight,
    yarnName: options.yarnName ?? yarnBox.yarnName ?? null,
    shadeCode: options.shadeCode ?? yarnBox.shadeCode ?? null,
    issueStatus,
    issueWeight: derivedIssueWeight,
    returnStatus,
    returnWeight: derivedReturnWeight,
    coneStorageId: derivedStorageId,
  };

  if (options.issuedBy) {
    basePayload.issuedBy = options.issuedBy;
  }

  if (options.issueDate) {
    basePayload.issueDate = toDate(options.issueDate);
  }

  if (options.returnBy) {
    basePayload.returnBy = options.returnBy;
  }

  if (options.returnDate) {
    basePayload.returnDate = toDate(options.returnDate);
  }

  if (options.yarn) {
    basePayload.yarn = options.yarn;
  }

  const conesToCreate = Array.from({ length: numberOfCones }, () => ({
    ...basePayload,
    barcode: new mongoose.Types.ObjectId().toString(),
  }));

  const createdCones = await YarnCone.insertMany(conesToCreate);

  yarnBox.set('numberOfCones', numberOfCones);
  yarnBox.set('coneData.conesIssued', true);
  yarnBox.set('coneData.numberOfCones', numberOfCones);
  yarnBox.set(
    'coneData.coneIssueDate',
    toDate(options.coneIssueDate) ?? new Date()
  );

  if (options.coneIssueBy) {
    yarnBox.set('coneData.coneIssueBy', options.coneIssueBy);
  }

  await yarnBox.save();

  const updatedBox = await YarnBox.findById(yarnBox._id).lean();

  return {
    message: `Successfully created ${createdCones.length} cones for box ${boxId}`,
    created: true,
    box: updatedBox,
    cones: createdCones.map((cone) => cone.toObject()),
  };
};


