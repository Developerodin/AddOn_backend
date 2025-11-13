import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnBox } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

export const createYarnBox = async (yarnBoxBody) => {
  if (!yarnBoxBody.boxId) {
    const autoBoxId = `BOX-${Date.now()}`;
    yarnBoxBody.boxId = autoBoxId;
  } else {
    const existingBox = await YarnBox.findOne({ boxId: yarnBoxBody.boxId });
    if (existingBox) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Box ID already exists');
    }
  }

  // Only check for existing barcode if provided (otherwise it will be auto-generated)
  if (yarnBoxBody.barcode) {
    const existingBarcode = await YarnBox.findOne({ barcode: yarnBoxBody.barcode });
    if (existingBarcode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Barcode already exists');
    }
  }

  const yarnBox = await YarnBox.create(yarnBoxBody);
  return yarnBox;
};

export const getYarnBoxById = async (yarnBoxId) => {
  const yarnBox = await YarnBox.findById(yarnBoxId);
  if (!yarnBox) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn box not found');
  }
  return yarnBox;
};

export const getYarnBoxByBarcode = async (barcode) => {
  const yarnBox = await YarnBox.findOne({ barcode });
  if (!yarnBox) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn box not found with this barcode');
  }
  return yarnBox;
};

export const updateYarnBoxById = async (yarnBoxId, updateBody) => {
  const yarnBox = await YarnBox.findById(yarnBoxId);
  if (!yarnBox) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn box not found');
  }

  if (updateBody.boxId && updateBody.boxId !== yarnBox.boxId) {
    const existingBox = await YarnBox.findOne({ boxId: updateBody.boxId, _id: { $ne: yarnBoxId } });
    if (existingBox) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Box ID already exists');
    }
  }

  if (updateBody.barcode && updateBody.barcode !== yarnBox.barcode) {
    const existingBarcode = await YarnBox.findOne({ barcode: updateBody.barcode, _id: { $ne: yarnBoxId } });
    if (existingBarcode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Barcode already exists');
    }
  }

  Object.assign(yarnBox, updateBody);
  await yarnBox.save();
  return yarnBox;
};

export const queryYarnBoxes = async (filters = {}) => {
  const mongooseFilter = {};

  if (filters.po_number) {
    mongooseFilter.poNumber = filters.po_number;
  }

  if (filters.yarn_name) {
    mongooseFilter.yarnName = { $regex: filters.yarn_name, $options: 'i' };
  }

  if (filters.shade_code) {
    mongooseFilter.shadeCode = { $regex: filters.shade_code, $options: 'i' };
  }

  if (filters.storage_location) {
    mongooseFilter.storageLocation = { $regex: filters.storage_location, $options: 'i' };
  }

  if (typeof filters.cones_issued === 'boolean') {
    mongooseFilter['coneData.conesIssued'] = filters.cones_issued;
  }

  const yarnBoxes = await YarnBox.find(mongooseFilter).sort({ createdAt: -1 }).lean();
  return yarnBoxes;
};

export const bulkCreateYarnBoxes = async (bulkData) => {
  const { numberOfBoxes, poNumber, ...commonFields } = bulkData;

  if (numberOfBoxes < 1) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Number of boxes must be at least 1');
  }

  // Check how many boxes already exist for this PO number
  const existingBoxesCount = await YarnBox.countDocuments({ poNumber });

  // If boxes already exist, return existing boxes without creating new ones
  if (existingBoxesCount > 0) {
    const existingBoxes = await YarnBox.find({ poNumber }).sort({ createdAt: -1 });
    return {
      message: `Boxes already exist for PO ${poNumber}`,
      existingCount: existingBoxesCount,
      boxes: existingBoxes,
      created: false,
    };
  }

  // Create new boxes only if none exist
  const boxesToCreate = [];
  const baseTimestamp = Date.now();

  for (let i = 0; i < numberOfBoxes; i++) {
    const boxId = `BOX-${poNumber}-${baseTimestamp}-${i + 1}`;
    // Generate unique barcode using ObjectId (insertMany doesn't trigger pre-save hooks)
    const uniqueBarcode = new mongoose.Types.ObjectId().toString();

    boxesToCreate.push({
      boxId,
      poNumber,
      barcode: uniqueBarcode,
      // Set required fields with defaults if not provided
      yarnName: commonFields.yarnName || `Yarn-${poNumber}`,
      orderDate: commonFields.orderDate || new Date(),
      orderQty: commonFields.orderQty || 0,
      ...commonFields,
      // receivedDate defaults to current date if not provided
      receivedDate: commonFields.receivedDate || new Date(),
    });
  }

  const createdBoxes = await YarnBox.insertMany(boxesToCreate);
  return {
    message: `Successfully created ${numberOfBoxes} boxes for PO ${poNumber}`,
    createdCount: createdBoxes.length,
    boxes: createdBoxes,
    created: true,
  };
};

export const updateQcStatusByPoNumber = async (poNumber, qcStatus, qcData = {}) => {
  const validStatuses = ['qc_approved', 'qc_rejected'];
  
  if (!validStatuses.includes(qcStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Status must be one of: ${validStatuses.join(', ')}`);
  }

  // Find all boxes for this PO number
  const boxes = await YarnBox.find({ poNumber });
  
  if (boxes.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, `No boxes found for PO number: ${poNumber}`);
  }

  // Prepare update object
  const updateFields = {
    'qcData.status': qcStatus,
    'qcData.date': qcData.date ? new Date(qcData.date) : new Date(),
  };

  if (qcData.user) {
    updateFields['qcData.user'] = qcData.user;
  }
  if (qcData.username) {
    updateFields['qcData.username'] = qcData.username;
  }
  if (qcData.remarks !== undefined) {
    updateFields['qcData.remarks'] = qcData.remarks;
  }
  if (qcData.mediaUrl && typeof qcData.mediaUrl === 'object') {
    // Set the mediaUrl object (can contain multiple keys like video1, image1, image2, etc.)
    updateFields['qcData.mediaUrl'] = qcData.mediaUrl;
  }

  // Update QC data for all boxes
  const updateResult = await YarnBox.updateMany(
    { poNumber },
    { $set: updateFields }
  );

  // Fetch updated boxes
  const updatedBoxes = await YarnBox.find({ poNumber });

  return {
    message: `Successfully updated QC status to ${qcStatus} for ${updateResult.modifiedCount} boxes`,
    poNumber,
    status: qcStatus,
    updatedCount: updateResult.modifiedCount,
    totalBoxes: boxes.length,
    boxes: updatedBoxes,
  };
};


