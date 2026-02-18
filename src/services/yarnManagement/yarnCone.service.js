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

export const getYarnConeByBarcode = async (barcode) => {
  const yarnCone = await YarnCone.findOne({ barcode })
    .populate({
      path: 'yarn',
      select: '_id yarnName yarnType status',
    })
    .lean();

  if (!yarnCone) {
    throw new ApiError(httpStatus.NOT_FOUND, `Yarn cone with barcode ${barcode} not found`);
  }

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

  const derivedConeWeight = options.coneWeight ?? 0;

  const derivedTearWeight = options.tearWeight ?? 0;

  const derivedIssueWeight =
    options.issueWeight ?? derivedConeWeight ?? null;

  const derivedReturnWeight =
    options.returnWeight ?? derivedConeWeight ?? null;

  const derivedStorageId = options.coneStorageId ?? null;

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

  // Only set numberOfCones when generating cone records. Do NOT set conesIssued/coneIssueDate
  // here — those mean "cones have been issued to production/ST"; they are set when cones
  // are actually moved to short-term storage (yarnCone post-save / storageSlot).
  yarnBox.set('numberOfCones', numberOfCones);
  yarnBox.set('coneData.numberOfCones', numberOfCones);

  await yarnBox.save();

  const updatedBox = await YarnBox.findById(yarnBox._id).lean();

  return {
    message: `Successfully created ${createdCones.length} cones for box ${boxId}`,
    created: true,
    box: updatedBox,
    cones: createdCones.map((cone) => cone.toObject()),
  };
};

/**
 * Return a yarn cone - handles two cases:
 * 1. Empty cone (no yarn left): updates weight to 0
 * 2. Cone with remaining yarn: updates weight and storage location
 * @param {String} barcode - Cone barcode
 * @param {Object} returnData - Return data (returnWeight, returnBy, returnDate, coneStorageId)
 * @returns {Promise<Object>} Updated cone
 */
export const returnYarnCone = async (barcode, returnData = {}) => {
  // Find cone by barcode
  const yarnCone = await YarnCone.findOne({ barcode });
  
  if (!yarnCone) {
    throw new ApiError(httpStatus.NOT_FOUND, `Yarn cone with barcode ${barcode} not found`);
  }

  // Validate that cone is issued
  if (yarnCone.issueStatus !== 'issued') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cone ${barcode} is not issued. Current status: ${yarnCone.issueStatus}`
    );
  }

  // Validate that cone is not already returned
  if (yarnCone.returnStatus === 'returned') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cone ${barcode} is already returned`
    );
  }

  // Get return weight (remaining weight after use)
  // If returnWeight is provided, use it; otherwise calculate from coneWeight and tearWeight
  const returnWeight = returnData.returnWeight !== undefined 
    ? returnData.returnWeight 
    : (yarnCone.coneWeight || 0) - (yarnCone.tearWeight || 0);

  if (returnWeight < 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Return weight cannot be negative. Calculated: ${returnWeight}`
    );
  }

  // Determine if cone is empty (no yarn left)
  const isEmpty = returnWeight === 0 || returnWeight < 0.01; // Consider < 0.01kg as empty

  // Update cone return information
  yarnCone.returnStatus = 'returned';
  yarnCone.returnDate = returnData.returnDate ? new Date(returnData.returnDate) : new Date();
  yarnCone.returnWeight = returnWeight;
  
  if (returnData.returnBy) {
    yarnCone.returnBy = returnData.returnBy;
  }

  // Handle two cases:
  if (isEmpty) {
    // Case 1: Empty cone - update weight to 0, don't update storage location
    yarnCone.coneWeight = 0;
    yarnCone.tearWeight = 0;
    // Keep existing storage location or set to null if not in ST storage
    if (!yarnCone.coneStorageId || !/^ST-/i.test(yarnCone.coneStorageId)) {
      yarnCone.coneStorageId = null; // Empty cone doesn't need storage location
    }
  } else {
    // Case 2: Cone has remaining yarn - update weight and storage location
    // Update cone weight to reflect remaining yarn
    yarnCone.coneWeight = returnWeight;
    yarnCone.tearWeight = 0; // Reset tear weight for returned cone
    
    // Validate and update storage location to short-term storage
    const coneStorageId = returnData.coneStorageId;
    if (coneStorageId) {
      if (!/^ST-/i.test(coneStorageId)) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Storage ID must start with 'ST-' for short-term storage. Provided: ${coneStorageId}`
        );
      }
      yarnCone.coneStorageId = coneStorageId;
    } else if (!yarnCone.coneStorageId || !/^ST-/i.test(yarnCone.coneStorageId)) {
      // If no storage ID provided and current storage is not ST, set a default ST location
      yarnCone.coneStorageId = `ST-RETURNED-${yarnCone.barcode}`;
    }
  }

  // Save cone (post-save hook will automatically sync to inventory)
  await yarnCone.save();

  // Populate yarn info before returning
  await yarnCone.populate({
    path: 'yarn',
    select: '_id yarnName yarnType status',
  });

  const message = isEmpty 
    ? `Cone ${barcode} returned empty (weight set to 0)`
    : `Cone ${barcode} returned with ${returnWeight}kg remaining yarn and stored in short-term storage`;

  return {
    cone: yarnCone.toObject(),
    isEmpty,
    message
  };
};


