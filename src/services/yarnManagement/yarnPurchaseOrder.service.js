import httpStatus from 'http-status';
import { YarnPurchaseOrder, YarnBox, YarnCone } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import { yarnPurchaseOrderStatuses, lotStatuses } from '../../models/yarnReq/yarnPurchaseOrder.model.js';
import * as supplierService from './supplier.service.js';

/**
 * Enriches each PO line item with yarn subtype and colour for Excel/API consumers.
 * Sets item.yarnSubtype, item.colour, and item.yarn.subtype, item.yarn.colour.
 * @param {Object} po - Purchase order (plain object or doc with poItems)
 */
const enrichPoItemsWithSubtypeAndColour = (po) => {
  if (!po?.poItems?.length) return;
  po.poItems.forEach((item) => {
    const yarn = item.yarn;
    const subtype =
      yarn?.yarnSubtype && typeof yarn.yarnSubtype === 'object'
        ? yarn.yarnSubtype.subtype
        : yarn?.yarnSubtype ?? null;
    const colour = yarn?.colorFamily?.name ?? yarn?.colorFamily?.colorCode ?? null;
    item.yarnSubtype = subtype ?? null;
    item.colour = colour ?? null;
    if (yarn && typeof yarn === 'object') {
      yarn.subtype = subtype ?? null;
      yarn.colour = colour ?? null;
    }
  });
};

export const getPurchaseOrders = async ({ startDate, endDate, statusCode }) => {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const filter = {
    createDate: {
      $gte: start,
      $lte: end,
    },
  };

  if (statusCode) {
    filter.currentStatus = statusCode;
  }

  const purchaseOrders = await YarnPurchaseOrder.find(filter)
  .populate({
    path: 'supplier',
    select: '_id brandName contactPersonName contactNumber email address city state pincode country gstNo',
  })
    .populate({
      path: 'poItems.yarn',
      select: '_id yarnName yarnType status yarnSubtype colorFamily',
    })
    .sort({ createDate: -1 })
    .lean();

  purchaseOrders.forEach(enrichPoItemsWithSubtypeAndColour);
  return purchaseOrders;
};

export const getPurchaseOrderById = async (purchaseOrderId) => {
  const purchaseOrder = await YarnPurchaseOrder.findById(purchaseOrderId)
    .populate({
      path: 'supplier',
      select: '_id brandName contactPersonName contactNumber email address city state gstNo',
    })
    .populate({
      path: 'poItems.yarn',
      select: '_id yarnName yarnType status yarnSubtype colorFamily',
    })
    .lean();

  if (purchaseOrder) enrichPoItemsWithSubtypeAndColour(purchaseOrder);
  return purchaseOrder;
};

/**
 * Get purchase order by PO number
 * @param {string} poNumber - PO number (e.g. PO-2026-554)
 * @returns {Promise<Object|null>}
 */
export const getPurchaseOrderByPoNumber = async (poNumber) => {
  const purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber })
    .populate({
      path: 'supplier',
      select: '_id brandName contactPersonName contactNumber email address city state gstNo',
    })
    .populate({
      path: 'poItems.yarn',
      select: '_id yarnName yarnType status yarnSubtype colorFamily',
    })
    .lean();

  if (purchaseOrder) enrichPoItemsWithSubtypeAndColour(purchaseOrder);
  return purchaseOrder;
};


/**
 * Get supplier tearweight for a yarn by PO number and yarn name.
 * Finds the PO by poNumber, gets its supplier, then returns that supplier's tearweight for the yarn.
 * @param {string} poNumber - PO number (e.g. PO-2026-415)
 * @param {string} yarnName - Yarn name (e.g. 110/70-Bottle Green-Bottle Green-Rubber/Rubber)
 * @returns {Promise<{ poNumber: string, supplierId: string, yarnName: string, tearweight: number | null, notFound: boolean }>}
 */
export const getSupplierTearweightByPoAndYarnName = async (poNumber, yarnName) => {
  const purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber }).select('supplier poNumber').lean();
  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, `Purchase order not found for poNumber: ${poNumber}`);
  }
  const supplierId = purchaseOrder.supplier?.toString?.() || purchaseOrder.supplier;
  if (!supplierId) {
    throw new ApiError(httpStatus.NOT_FOUND, `Supplier not found for PO: ${poNumber}`);
  }
  const result = await supplierService.getSupplierYarnTearweight(supplierId, [yarnName]);
  const match = result.yarnTearweights.find((y) => y.yarnName === yarnName.trim());
  const notFound = result.notFound.includes(yarnName.trim());
  return {
    poNumber,
    supplierId: result.supplierId,
    yarnName: yarnName.trim(),
    tearweight: match ? match.tearweight : null,
    notFound,
  };
};

/**
 * Get the next sequential PO number for a given year.
 * Format: PO-YYYY-N where N is 3 digits (001–999), then 4 (1000–9999), 5, 6 as needed.
 * Finds the highest existing PO-YYYY-* in DB and returns PO-YYYY-(max+1).
 * @param {number} year - Full year (e.g. 2026)
 * @returns {Promise<string>} e.g. PO-2026-749
 */
export const getNextPoNumberForYear = async (year) => {
  const prefix = `PO-${year}-`;
  const regex = new RegExp(`^${prefix}\\d+$`);
  const result = await YarnPurchaseOrder.aggregate([
    { $match: { poNumber: regex } },
    {
      $addFields: {
        seq: { $toInt: { $arrayElemAt: [{ $split: ['$poNumber', '-'] }, 2] } },
      },
    },
    { $group: { _id: null, maxSeq: { $max: '$seq' } } },
  ]);
  const nextSeq = result.length && result[0].maxSeq != null ? result[0].maxSeq + 1 : 1;
  const suffix = nextSeq < 1000 ? String(nextSeq).padStart(3, '0') : String(nextSeq);
  return `${prefix}${suffix}`;
};

export const createPurchaseOrder = async (purchaseOrderBody) => {
  let poNumber = (purchaseOrderBody.poNumber || '').trim();
  if (!poNumber) {
    const year = new Date().getFullYear();
    poNumber = await getNextPoNumberForYear(year);
    purchaseOrderBody = { ...purchaseOrderBody, poNumber };
  }
  const existing = await YarnPurchaseOrder.findOne({ poNumber });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'PO number already exists');
  }

  const statusLogs = purchaseOrderBody.statusLogs || [];
  const currentStatus = purchaseOrderBody.currentStatus || yarnPurchaseOrderStatuses[0];

  const payload = {
    ...purchaseOrderBody,
    currentStatus,
    statusLogs,
  };

  const purchaseOrder = await YarnPurchaseOrder.create(payload);
  return purchaseOrder;
};

export const updatePurchaseOrderById = async (purchaseOrderId, updateBody) => {
  const purchaseOrder = await YarnPurchaseOrder.findById(purchaseOrderId);

  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  if (updateBody.poNumber && updateBody.poNumber !== purchaseOrder.poNumber) {
    const poExists = await YarnPurchaseOrder.findOne({ poNumber: updateBody.poNumber, _id: { $ne: purchaseOrderId } });
    if (poExists) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'PO number already exists');
    }
  }

  Object.assign(purchaseOrder, updateBody);
  await purchaseOrder.save();
  return purchaseOrder;
};

export const deletePurchaseOrderById = async (purchaseOrderId) => {
  const purchaseOrder = await YarnPurchaseOrder.findById(purchaseOrderId);

  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  await purchaseOrder.deleteOne();
  return purchaseOrder;
};

export const updatePurchaseOrderStatus = async (purchaseOrderId, statusCode, updatedBy, notes = null) => {
  const purchaseOrder = await YarnPurchaseOrder.findById(purchaseOrderId);

  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  if (!yarnPurchaseOrderStatuses.includes(statusCode)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid status code');
  }

  purchaseOrder.currentStatus = statusCode;
  purchaseOrder.statusLogs.push({
    statusCode,
    updatedBy: {
      username: updatedBy.username,
      user: updatedBy.user_id,
    },
    notes: notes || undefined,
  });

  if (statusCode === 'goods_received' || statusCode === 'goods_partially_received') {
    if (!purchaseOrder.goodsReceivedDate) {
      purchaseOrder.goodsReceivedDate = new Date();
    }
  }

  await purchaseOrder.save();
  return purchaseOrder;
};

export const updateLotStatus = async (poNumber, lotNumber, lotStatus) => {
  const purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber });

  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  if (!lotStatuses.includes(lotStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid lot status');
  }

  if (!purchaseOrder.receivedLotDetails || purchaseOrder.receivedLotDetails.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No received lot details found for this purchase order');
  }

  // Find the lot in receivedLotDetails
  const lotIndex = purchaseOrder.receivedLotDetails.findIndex(
    (lot) => lot.lotNumber === lotNumber
  );

  if (lotIndex === -1) {
    throw new ApiError(httpStatus.NOT_FOUND, `Lot ${lotNumber} not found in received lot details`);
  }

  // Update the lot status
  purchaseOrder.receivedLotDetails[lotIndex].status = lotStatus;

  await purchaseOrder.save();
  return purchaseOrder;
};

export const updateLotStatusAndQcApprove = async (poNumber, lotNumber, lotStatus, updatedBy, notes, qcData) => {
  const purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber });

  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  if (!lotStatuses.includes(lotStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid lot status');
  }

  if (!purchaseOrder.receivedLotDetails || purchaseOrder.receivedLotDetails.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No received lot details found for this purchase order');
  }

  // Find the lot in receivedLotDetails
  const lotIndex = purchaseOrder.receivedLotDetails.findIndex(
    (lot) => lot.lotNumber === lotNumber
  );

  if (lotIndex === -1) {
    throw new ApiError(httpStatus.NOT_FOUND, `Lot ${lotNumber} not found in received lot details`);
  }

  // Update the lot status
  purchaseOrder.receivedLotDetails[lotIndex].status = lotStatus;

  // Update receivedBy if provided
  if (updatedBy) {
    purchaseOrder.receivedBy = {
      username: updatedBy.username,
      user: updatedBy.user_id,
      receivedAt: new Date(),
    };
  }

  await purchaseOrder.save();

  // Update all boxes for this PO and lot with QC data
  // Only update QC status if lot is accepted or rejected
  let qcStatus = null;
  let actionMessage = '';

  if (lotStatus === 'lot_accepted') {
    qcStatus = 'qc_approved';
    actionMessage = 'QC approved';
  } else if (lotStatus === 'lot_rejected') {
    qcStatus = 'qc_rejected';
    actionMessage = 'QC rejected';
  }

  const boxes = await YarnBox.find({ poNumber, lotNumber });

  if (boxes.length > 0 && qcStatus) {
    // Prepare QC update fields
    const qcUpdateFields = {
      'qcData.status': qcStatus,
      'qcData.date': new Date(),
    };

    if (updatedBy) {
      qcUpdateFields['qcData.user'] = updatedBy.user_id;
      qcUpdateFields['qcData.username'] = updatedBy.username;
    }

    if (qcData.remarks !== undefined) {
      qcUpdateFields['qcData.remarks'] = qcData.remarks;
    }

    if (qcData.mediaUrl && typeof qcData.mediaUrl === 'object') {
      qcUpdateFields['qcData.mediaUrl'] = qcData.mediaUrl;
    }

    // Update all boxes for this lot
    await YarnBox.updateMany(
      { poNumber, lotNumber },
      { $set: qcUpdateFields }
    );
  }

  // Fetch updated boxes
  const updatedBoxes = await YarnBox.find({ poNumber, lotNumber });

  const message = qcStatus
    ? `Successfully updated lot status to ${lotStatus} and ${actionMessage} ${updatedBoxes.length} boxes for lot ${lotNumber}`
    : `Successfully updated lot status to ${lotStatus} for lot ${lotNumber}`;

  return {
    purchaseOrder,
    boxes: updatedBoxes,
    updatedBoxesCount: updatedBoxes.length,
    qcStatus: qcStatus || null,
    message,
  };
};

/**
 * Delete a lot by poNumber and lotNumber.
 * Order: 1) Delete all cones (poNumber + boxId in lot's boxes), 2) Delete all boxes (poNumber + lotNumber), 3) Remove lot from PO receivedLotDetails.
 * @param {string} poNumber - PO number
 * @param {string} lotNumber - Lot number
 * @returns {Promise<{ purchaseOrder, deletedConesCount, deletedBoxesCount, message }>}
 */
export const deleteLotByPoAndLotNumber = async (poNumber, lotNumber) => {
  const po = (poNumber || '').trim();
  const lot = (lotNumber || '').trim();
  if (!po || !lot) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'poNumber and lotNumber are required');
  }

  const purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber: po });
  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }

  const hasLot = purchaseOrder.receivedLotDetails?.some((l) => (l.lotNumber || '').trim() === lot);
  if (!hasLot) {
    throw new ApiError(httpStatus.NOT_FOUND, `Lot ${lot} not found in received lot details`);
  }

  const boxes = await YarnBox.find({ poNumber: po, lotNumber: lot }).select('boxId').lean();
  const boxIds = boxes.map((b) => b.boxId);

  const conesResult = await YarnCone.deleteMany({
    poNumber: po,
    boxId: { $in: boxIds },
  });
  const deletedConesCount = conesResult.deletedCount ?? 0;

  const boxesResult = await YarnBox.deleteMany({ poNumber: po, lotNumber: lot });
  const deletedBoxesCount = boxesResult.deletedCount ?? 0;

  await YarnPurchaseOrder.updateOne(
    { poNumber: po },
    { $pull: { receivedLotDetails: { lotNumber: lot } } }
  );
  const updatedPo = await YarnPurchaseOrder.findOne({ poNumber: po })
    .populate({ path: 'supplier', select: '_id brandName' })
    .populate({ path: 'poItems.yarn', select: '_id yarnName' })
    .lean();

  return {
    purchaseOrder: updatedPo,
    deletedConesCount,
    deletedBoxesCount,
    message: `Lot ${lot} deleted: ${deletedConesCount} cones, ${deletedBoxesCount} boxes removed; lot removed from PO.`,
  };
};

/**
 * QC approve all lots in a PO at once.
 * @param {string} purchaseOrderId - MongoDB _id of PO
 * @param {Object} updatedBy - { username, user_id }
 * @param {string} [notes] - notes (default: 'QC approved all lots')
 * @param {string} [remarks] - remarks for QC
 * @returns {Promise<{ purchaseOrder, lotsApproved, totalBoxesUpdated, results }>}
 */
export const qcApproveAllLotsForPo = async (purchaseOrderId, updatedBy, notes = 'QC approved all lots', remarks = '') => {
  const purchaseOrder = await YarnPurchaseOrder.findById(purchaseOrderId);
  if (!purchaseOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  }
  const poNumber = purchaseOrder.poNumber;
  const receivedLotDetails = purchaseOrder.receivedLotDetails || [];
  if (receivedLotDetails.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No received lot details found for this purchase order');
  }

  const lotStatus = 'lot_accepted';
  const qcData = { remarks: remarks || '', mediaUrl: null };
  const results = [];
  let totalBoxesUpdated = 0;

  for (const lot of receivedLotDetails) {
    const lotNumber = lot.lotNumber;
    try {
      const r = await updateLotStatusAndQcApprove(
        poNumber,
        lotNumber,
        lotStatus,
        updatedBy,
        notes || 'QC approved all lots',
        qcData
      );
      results.push({ lotNumber, success: true, boxesUpdated: r.updatedBoxesCount });
      totalBoxesUpdated += r.updatedBoxesCount || 0;
    } catch (err) {
      results.push({ lotNumber, success: false, error: err.message || String(err) });
    }
  }

  const updatedPo = await YarnPurchaseOrder.findById(purchaseOrderId)
    .populate({ path: 'supplier', select: '_id brandName' })
    .populate({ path: 'poItems.yarn', select: '_id yarnName' })
    .lean();

  return {
    purchaseOrder: updatedPo,
    lotsApproved: results.filter((r) => r.success).length,
    lotsFailed: results.filter((r) => !r.success).length,
    totalBoxesUpdated,
    results,
    message: `QC approved ${results.filter((r) => r.success).length} lot(s), ${totalBoxesUpdated} boxes updated for PO ${poNumber}`,
  };
};

