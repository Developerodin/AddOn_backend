import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { VendorBox, VendorPurchaseOrder, VendorManagement } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import * as vendorProductionFlowService from './vendorProductionFlow.service.js';

export const createVendorBox = async (vendorBoxBody) => {
  const payload = { ...vendorBoxBody };
  if (!payload.boxId) {
    payload.boxId = `VBOX-${Date.now()}`;
  } else {
    const existing = await VendorBox.findOne({ boxId: payload.boxId });
    if (existing) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Box ID already exists');
    }
  }
  if (payload.barcode) {
    const existingBarcode = await VendorBox.findOne({ barcode: payload.barcode });
    if (existingBarcode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Barcode already exists');
    }
  }
  const box = await VendorBox.create(payload);
  if (box.numberOfUnits > 0) {
    await vendorProductionFlowService.syncBoxToProductionFlow(box, box.numberOfUnits);
  }
  return box;
};

export const getVendorBoxById = async (vendorBoxId) => {
  const box = await VendorBox.findById(vendorBoxId)
    .populate({ path: 'productId', select: 'name softwareCode internalCode status' })
    .populate({ path: 'vendor', select: 'header' })
    .populate({ path: 'vendorPurchaseOrderId', select: 'vpoNumber vendorName currentStatus' })
    .exec();
  if (!box) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor box not found');
  }
  return box;
};

export const queryVendorBoxes = async (filter, options, search) => {
  let mongoFilter = {};

  if (filter.vpoNumber) {
    mongoFilter.vpoNumber = String(filter.vpoNumber).trim();
  }
  if (filter.vendorPurchaseOrderId) {
    mongoFilter.vendorPurchaseOrderId = new mongoose.Types.ObjectId(filter.vendorPurchaseOrderId);
  }
  if (filter.vendor) {
    mongoFilter.vendor = new mongoose.Types.ObjectId(filter.vendor);
  }
  if (filter.productName) {
    mongoFilter.productName = { $regex: filter.productName, $options: 'i' };
  }
  if (filter.lotNumber) {
    mongoFilter.lotNumber = String(filter.lotNumber).trim();
  }
  if (filter.storedStatus === true || filter.storedStatus === 'true') {
    mongoFilter.storedStatus = true;
  } else if (filter.storedStatus === false || filter.storedStatus === 'false') {
    mongoFilter.storedStatus = false;
  }

  if (search && typeof search === 'string' && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    const searchFilter = {
      $or: [{ boxId: rx }, { vpoNumber: rx }, { productName: rx }, { lotNumber: rx }, { barcode: rx }],
    };
    mongoFilter = Object.keys(mongoFilter).length ? { $and: [mongoFilter, searchFilter] } : searchFilter;
  }

  const paginateOptions = { ...options };
  if (paginateOptions.populate === 'productId') {
    paginateOptions.populate = { path: 'productId', select: 'name softwareCode internalCode status' };
  }

  return VendorBox.paginate(mongoFilter, paginateOptions);
};

export const updateVendorBoxById = async (vendorBoxId, updateBody) => {
  const box = await VendorBox.findById(vendorBoxId);
  if (!box) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor box not found');
  }
  if (updateBody.boxId && updateBody.boxId !== box.boxId) {
    const existing = await VendorBox.findOne({ boxId: updateBody.boxId, _id: { $ne: vendorBoxId } });
    if (existing) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Box ID already exists');
    }
  }
  if (updateBody.barcode && updateBody.barcode !== box.barcode) {
    const existing = await VendorBox.findOne({ barcode: updateBody.barcode, _id: { $ne: vendorBoxId } });
    if (existing) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Barcode already exists');
    }
  }
  const previousUnits = box.numberOfUnits || 0;
  Object.assign(box, updateBody);
  await box.save();
  const currentUnits = box.numberOfUnits || 0;
  if (currentUnits !== previousUnits) {
    await vendorProductionFlowService.syncBoxToProductionFlow(box, currentUnits - previousUnits);
  }
  return box;
};

export const deleteVendorBoxById = async (vendorBoxId) => {
  const box = await VendorBox.findById(vendorBoxId);
  if (!box) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor box not found');
  }
  await box.deleteOne();
  return box;
};

/**
 * Bulk-create boxes for a VPO (similar to yarn box bulk).
 * @param {{ vpoNumber: string, lotDetails: { lotNumber: string, numberOfBoxes: number, productId?: string, vendorPoItemId?: string, orderQty?: number, boxWeight?: number, grossWeight?: number, numberOfUnits?: number, tearweight?: number }[] }} bulkData
 */
/* eslint-disable no-underscore-dangle -- lean PO subdocs expose Mongo _id */
export const bulkCreateVendorBoxes = async (bulkData) => {
  const { lotDetails, vpoNumber } = bulkData;
  if (!lotDetails?.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'lotDetails array is required with at least one lot');
  }

  const po = await VendorPurchaseOrder.findOne({ vpoNumber: String(vpoNumber).trim() })
    .populate({ path: 'poItems.productId', select: 'name' })
    .lean();

  if (!po) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor purchase order not found for this VPO number');
  }

  const vendorId = po.vendor;
  const vendorDoc = await VendorManagement.findById(vendorId).select('_id').lean();
  if (!vendorDoc) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor not found for this PO');
  }

  const boxesToCreate = [];
  const skippedLots = [];
  const baseTs = Date.now();
  let counter = 0;
  const poId = new mongoose.Types.ObjectId(String(po._id));

  const lotRows = await Promise.all(
    lotDetails.map(async (lot) => {
      const {
        lotNumber,
        numberOfBoxes,
        productId,
        vendorPoItemId,
        orderQty,
        boxWeight,
        grossWeight,
        numberOfUnits,
        tearweight,
      } = lot;
      if (!lotNumber || numberOfBoxes < 1) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Each lot needs lotNumber and numberOfBoxes >= 1');
      }
      const existingCount = await VendorBox.countDocuments({ vpoNumber: po.vpoNumber, lotNumber });
      return {
        lotNumber,
        numberOfBoxes,
        productId,
        vendorPoItemId,
        orderQty,
        boxWeight,
        grossWeight,
        numberOfUnits,
        tearweight,
        existingCount,
      };
    })
  );

  lotRows.forEach((row) => {
    const {
      lotNumber,
      numberOfBoxes,
      productId,
      vendorPoItemId,
      orderQty,
      boxWeight,
      grossWeight,
      numberOfUnits,
      tearweight,
      existingCount,
    } = row;
    if (existingCount > 0) {
      skippedLots.push({ lotNumber, reason: 'Boxes already exist for this lot' });
      return;
    }

    let resolvedProductId = productId;
    let resolvedPoItemId = vendorPoItemId;

    if (!resolvedProductId && resolvedPoItemId) {
      const item = po.poItems?.find((i) => String(i._id) === String(resolvedPoItemId));
      if (item?.productId) {
        const pid = item.productId;
        resolvedProductId = pid._id ? String(pid._id) : String(pid);
      }
    }
    if (!resolvedProductId && po.poItems?.length === 1) {
      const item = po.poItems[0];
      const pid = item.productId;
      resolvedProductId = pid?._id ? String(pid._id) : String(pid);
      resolvedPoItemId = String(item._id);
    }
    if (!resolvedProductId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Could not resolve product for lot ${lotNumber}: pass productId or vendorPoItemId, or use a PO with exactly one line item`
      );
    }

    for (let i = 0; i < numberOfBoxes; i += 1) {
      counter += 1;
      const boxId = `VBOX-${po.vpoNumber}-${String(lotNumber).replace(/\s+/g, '')}-${baseTs + counter}`;
      boxesToCreate.push({
        boxId,
        vpoNumber: po.vpoNumber,
        vendorPurchaseOrderId: poId,
        vendor: vendorId,
        vendorPoItemId: resolvedPoItemId ? new mongoose.Types.ObjectId(resolvedPoItemId) : undefined,
        productId: new mongoose.Types.ObjectId(resolvedProductId),
        lotNumber,
        orderDate: new Date(),
        orderQty,
        boxWeight,
        grossWeight,
        numberOfUnits,
        tearweight,
      });
    }
  });

  if (!boxesToCreate.length) {
    return {
      createdCount: 0,
      boxes: [],
      skippedLots,
      message: skippedLots.length ? 'All lots skipped (boxes already exist)' : 'No boxes to create',
    };
  }

  const inserted = await VendorBox.create(boxesToCreate);
  await Promise.all(
    inserted.map(async (box) => {
      const units = Number(box.numberOfUnits) || 0;
      if (units > 0) {
        await vendorProductionFlowService.syncBoxToProductionFlow(box, units);
      }
    })
  );
  return {
    createdCount: inserted.length,
    boxes: inserted,
    skippedLots,
  };
};
/* eslint-enable no-underscore-dangle */
