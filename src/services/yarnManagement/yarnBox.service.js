import httpStatus from 'http-status';
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

  const existingBarcode = await YarnBox.findOne({ barcode: yarnBoxBody.barcode });
  if (existingBarcode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Barcode already exists');
  }

  const yarnBox = await YarnBox.create(yarnBoxBody);
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


