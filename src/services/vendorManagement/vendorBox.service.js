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
 * Build lotDetails array from the VPO's receivedLotDetails for lots that are still pending.
 * Used when the caller does not provide explicit lotDetails (process-all-pending mode).
 */
function buildLotDetailsFromPo(po) {
  return (po.receivedLotDetails || [])
    .filter((lot) => lot.status === 'lot_pending')
    .map((lot) => ({
      lotNumber: (lot.lotNumber || '').trim(),
      numberOfBoxes: Number(lot.numberOfBoxes) || 0,
    }));
}

/**
 * After boxes are created for a lot, update that lot's status inside the VPO document.
 * @param {string} vpoNumber
 * @param {string} lotNumber
 * @param {string} newStatus - e.g. 'lot_qc_pending'
 */
async function updateLotStatusOnPo(vpoNumber, lotNumber, newStatus) {
  const normalized = String(lotNumber).trim();
  await VendorPurchaseOrder.updateOne(
    { vpoNumber, 'receivedLotDetails.lotNumber': normalized },
    { $set: { 'receivedLotDetails.$.status': newStatus } }
  );
}

/**
 * Bulk-create boxes for a VPO (similar to yarn box bulk).
 *
 * When `lotDetails` is provided, creates boxes for the specified lots (existing behaviour).
 * When `lotDetails` is omitted / empty, auto-detects all pending lots from the VPO's
 * `receivedLotDetails` and creates boxes for those that don't already have boxes.
 *
 * @param {{ vpoNumber: string, lotDetails?: { lotNumber: string, numberOfBoxes?: number, productId?: string, vendorPoItemId?: string, orderQty?: number, boxWeight?: number, grossWeight?: number, numberOfUnits?: number, tearweight?: number }[] }} bulkData
 */
/* eslint-disable no-underscore-dangle -- lean PO subdocs expose Mongo _id */
export const bulkCreateVendorBoxes = async (bulkData) => {
  const { vpoNumber } = bulkData;
  let { lotDetails } = bulkData;

  const po = await VendorPurchaseOrder.findOne({ vpoNumber: String(vpoNumber).trim() })
    .populate({ path: 'poItems.productId', select: 'name' })
    .lean();

  if (!po) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor purchase order not found for this VPO number');
  }

  if (!lotDetails?.length) {
    lotDetails = buildLotDetailsFromPo(po);
  }

  if (!lotDetails.length) {
    return {
      createdCount: 0,
      boxes: [],
      skippedLots: [],
      message: 'No pending lots found on this VPO',
    };
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

  const lotRows = [];
  for (const lot of lotDetails) {
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

    if (!lotNumber) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Each lot needs lotNumber');
    }

    const normalizedLotNumber = String(lotNumber).trim();
    const lotFromPo = (po.receivedLotDetails || []).find((l) => String(l?.lotNumber || '').trim() === normalizedLotNumber);
    const poItemsInLot = lotFromPo?.poItems || [];
    const lotPoItemsWithReceivedBoxes = poItemsInLot.filter((item) => item?.poItem && item.receivedBoxes != null);
    const totalReceivedBoxesInLot = lotPoItemsWithReceivedBoxes.reduce(
      (sum, item) => sum + Math.max(0, Math.trunc(Number(item.receivedBoxes) || 0)),
      0
    );
    const inputNumberOfBoxes = Number(numberOfBoxes);

    const shouldExpandAllPoItemsForLot =
      lotPoItemsWithReceivedBoxes.length > 0 &&
      (!vendorPoItemId ||
        (Number.isFinite(inputNumberOfBoxes) && Math.trunc(inputNumberOfBoxes) === totalReceivedBoxesInLot && totalReceivedBoxesInLot > 0));

    if (shouldExpandAllPoItemsForLot) {
      for (const item of lotPoItemsWithReceivedBoxes) {
        const resolvedPoItemId = String(item.poItem);
        const resolvedNumberOfBoxes = Math.max(0, Math.trunc(Number(item.receivedBoxes) || 0));
        const existingCount = await VendorBox.countDocuments({
          vpoNumber: po.vpoNumber,
          lotNumber: normalizedLotNumber,
          vendorPoItemId: new mongoose.Types.ObjectId(resolvedPoItemId),
        });
        lotRows.push({
          lotNumber: normalizedLotNumber,
          numberOfBoxes: resolvedNumberOfBoxes,
          productId,
          vendorPoItemId: resolvedPoItemId,
          orderQty,
          boxWeight,
          grossWeight,
          numberOfUnits,
          tearweight,
          existingCount,
        });
      }
      continue;
    }

    const poItemFromLot = vendorPoItemId
      ? poItemsInLot.find((item) => String(item?.poItem) === String(vendorPoItemId))
      : null;
    const hasReceivedBoxes = poItemFromLot && poItemFromLot.receivedBoxes != null;
    if (!hasReceivedBoxes && (!Number.isFinite(inputNumberOfBoxes) || inputNumberOfBoxes < 1)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Each lot needs numberOfBoxes >= 1 when receivedBoxes is not set for that PO item');
    }
    const resolvedNumberOfBoxes = hasReceivedBoxes
      ? Math.max(0, Math.trunc(Number(poItemFromLot.receivedBoxes) || 0))
      : Math.trunc(inputNumberOfBoxes);

    const existingFilter = vendorPoItemId
      ? { vpoNumber: po.vpoNumber, lotNumber: normalizedLotNumber, vendorPoItemId: new mongoose.Types.ObjectId(String(vendorPoItemId)) }
      : { vpoNumber: po.vpoNumber, lotNumber: normalizedLotNumber };
    const existingCount = await VendorBox.countDocuments(existingFilter);
    lotRows.push({
      lotNumber: normalizedLotNumber,
      numberOfBoxes: resolvedNumberOfBoxes,
      productId,
      vendorPoItemId,
      orderQty,
      boxWeight,
      grossWeight,
      numberOfUnits,
      tearweight,
      existingCount,
    });
  }

  const lotsWithBoxesCreated = new Set();

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
      skippedLots.push({
        lotNumber,
        vendorPoItemId,
        reason: vendorPoItemId ? 'Boxes already exist for this lot and PO item' : 'Boxes already exist for this lot',
      });
      return;
    }

    if (numberOfBoxes < 1) {
      skippedLots.push({
        lotNumber,
        vendorPoItemId,
        reason: 'No boxes to create (receivedBoxes is 0 for this PO item)',
      });
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

    lotsWithBoxesCreated.add(lotNumber);
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

  await Promise.all(
    [...lotsWithBoxesCreated].map((lotNum) => updateLotStatusOnPo(po.vpoNumber, lotNum, 'lot_qc_pending'))
  );

  return {
    createdCount: inserted.length,
    boxes: inserted,
    skippedLots,
  };
};

/**
 * Process a single lot on a VPO: creates boxes for that lot only (skips if already processed).
 * Useful when lots are added incrementally.
 *
 * @param {{ vpoNumber: string, lotNumber: string }} params
 */
export const processVendorLot = async ({ vpoNumber, lotNumber }) => {
  const normalizedVpo = String(vpoNumber).trim();
  const normalizedLot = String(lotNumber).trim();

  const po = await VendorPurchaseOrder.findOne({ vpoNumber: normalizedVpo })
    .populate({ path: 'poItems.productId', select: 'name' })
    .lean();

  if (!po) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor purchase order not found');
  }

  const lotFromPo = (po.receivedLotDetails || []).find(
    (l) => String(l?.lotNumber || '').trim() === normalizedLot
  );
  if (!lotFromPo) {
    throw new ApiError(httpStatus.NOT_FOUND, `Lot "${normalizedLot}" not found on VPO ${normalizedVpo}`);
  }

  if (lotFromPo.status && lotFromPo.status !== 'lot_pending') {
    const existingBoxCount = await VendorBox.countDocuments({
      vpoNumber: normalizedVpo,
      lotNumber: normalizedLot,
    });
    if (existingBoxCount > 0) {
      return {
        createdCount: 0,
        boxes: [],
        skippedLots: [{ lotNumber: normalizedLot, reason: `Lot already processed (status: ${lotFromPo.status}, ${existingBoxCount} boxes exist)` }],
        message: `Lot ${normalizedLot} already processed`,
      };
    }
  }

  return bulkCreateVendorBoxes({
    vpoNumber: normalizedVpo,
    lotDetails: [{ lotNumber: normalizedLot, numberOfBoxes: lotFromPo.numberOfBoxes || 0 }],
  });
};
/* eslint-enable no-underscore-dangle */
