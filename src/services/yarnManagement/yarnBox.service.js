import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnBox, YarnPurchaseOrder } from '../../models/index.js';
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
  const yarnBox = await YarnBox.findOne({ barcode }).lean();
  if (!yarnBox) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn box not found with this barcode');
  }

  // Fetch purchase order and supplier by poNumber
  if (yarnBox.poNumber) {
    const purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber: yarnBox.poNumber })
      .populate({
        path: 'supplier',
        select: '_id brandName contactPersonName contactNumber email address city state pincode country gstNo status',
      })
      .select('poNumber supplier supplierName currentStatus')
      .lean();

    if (purchaseOrder) {
      yarnBox.purchaseOrder = {
        poNumber: purchaseOrder.poNumber,
        supplierName: purchaseOrder.supplierName,
        currentStatus: purchaseOrder.currentStatus,
      };
      yarnBox.supplier = purchaseOrder.supplier || null;
    } else {
      yarnBox.purchaseOrder = null;
      yarnBox.supplier = null;
    }
  } else {
    yarnBox.purchaseOrder = null;
    yarnBox.supplier = null;
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

  const storedStatus = filters.stored_status;
  if (storedStatus === true || storedStatus === 'true') {
    mongooseFilter.storedStatus = true;
  } else if (storedStatus === false || storedStatus === 'false') {
    mongooseFilter.storedStatus = false;
  }

  let query = YarnBox.find(mongooseFilter).sort({ createdAt: -1 });
  const limitNum = typeof filters.limit === 'number' ? filters.limit : parseInt(filters.limit, 10);
  if (!Number.isNaN(limitNum) && limitNum > 0) {
    query = query.limit(limitNum);
  }
  const yarnBoxes = await query.lean();
  return yarnBoxes;
};

/**
 * Resolve yarnName and shadeCode for a lot from PO when the lot has exactly one poItem.
 * Uses PO's poItems (with populated yarn) and receivedLotDetails. Returns nulls when lot has multiple poItems.
 * @param {Object} po - Purchase order (lean) with poItems.yarn populated and receivedLotDetails
 * @param {string} lotNumber - Lot number
 * @returns {{ yarnName: string | null, shadeCode: string | null }}
 */
const getYarnAndShadeForLotFromPo = (po, lotNumber) => {
  const receivedLots = po?.receivedLotDetails || [];
  const lot = receivedLots.find((l) => (l.lotNumber || '').trim() === (lotNumber || '').trim());
  const lotPoItems = lot?.poItems || [];
  if (lotPoItems.length !== 1) return { yarnName: null, shadeCode: null };
  const poItemId = typeof lotPoItems[0].poItem === 'string' ? lotPoItems[0].poItem : lotPoItems[0].poItem?.toString?.();
  if (!poItemId) return { yarnName: null, shadeCode: null };
  const poItems = po?.poItems || [];
  const item = poItems.find((i) => i._id && i._id.toString() === poItemId);
  const yarnName = (item?.yarn?.yarnName || item?.yarnName || '').trim() || null;
  const shadeCode = (item?.shadeCode || item?.shade || item?.yarn?.colorFamily?.colorCode || '')?.trim?.() || null;
  return { yarnName, shadeCode };
};

export const bulkCreateYarnBoxes = async (bulkData) => {
  const { lotDetails, poNumber } = bulkData;

  if (!lotDetails || !Array.isArray(lotDetails) || lotDetails.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'lotDetails array is required with at least one lot');
  }

  // Fetch PO once to resolve yarnName/shadeCode per lot (backend as source of truth; avoids wrong frontend-derived names)
  let purchaseOrder = null;
  try {
    purchaseOrder = await YarnPurchaseOrder.findOne({ poNumber })
      .populate({ path: 'poItems.yarn', select: '_id yarnName colorFamily' })
      .select('poItems receivedLotDetails')
      .lean();
  } catch {
    // Non-fatal: we'll use placeholder yarnName if PO not found
  }

  // Check each lot individually and create boxes only for lots that don't exist
  const existingBoxesByLot = {};
  const skippedLots = [];
  const boxesToCreate = [];
  const baseTimestamp = Date.now();
  let boxCounter = 1;

  for (const lotDetail of lotDetails) {
    const { lotNumber, numberOfBoxes } = lotDetail;

    if (numberOfBoxes < 1) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Number of boxes must be at least 1 for lot ${lotNumber}`
      );
    }

    // Check if boxes already exist for this specific lot
    const existingCount = await YarnBox.countDocuments({ poNumber, lotNumber });
    
    if (existingCount > 0) {
      // Skip this lot - boxes already exist
      existingBoxesByLot[lotNumber] = existingCount;
      skippedLots.push({
        lotNumber,
        numberOfBoxes: existingCount,
        reason: 'Boxes already exist for this lot',
      });
      continue;
    }

    const { yarnName: resolvedYarnName, shadeCode: resolvedShadeCode } = purchaseOrder
      ? getYarnAndShadeForLotFromPo(purchaseOrder, lotNumber)
      : { yarnName: null, shadeCode: null };
    const yarnName = (resolvedYarnName && resolvedYarnName.trim()) || `Yarn-${poNumber}`;

    // Create boxes for this lot
    for (let i = 0; i < numberOfBoxes; i++) {
      const boxId = `BOX-${poNumber}-${lotNumber}-${baseTimestamp}-${boxCounter}`;
      // Generate unique barcode using ObjectId (insertMany doesn't trigger pre-save hooks)
      const uniqueBarcode = new mongoose.Types.ObjectId().toString();

      const boxPayload = {
        boxId,
        poNumber,
        lotNumber,
        barcode: uniqueBarcode,
        yarnName,
        receivedDate: new Date(),
      };
      if (resolvedShadeCode) boxPayload.shadeCode = resolvedShadeCode;
      boxesToCreate.push(boxPayload);
      boxCounter++;
    }
  }

  // If no boxes to create (all lots already exist), return early
  if (boxesToCreate.length === 0) {
    const existingBoxes = await YarnBox.find({ 
      poNumber, 
      lotNumber: { $in: Object.keys(existingBoxesByLot) } 
    }).sort({ createdAt: -1 });
    
    return {
      message: `All lots already have boxes for PO ${poNumber}`,
      existingBoxesByLot,
      skippedLots,
      boxes: existingBoxes,
      created: false,
    };
  }

  // Create boxes for lots that don't exist
  const createdBoxes = await YarnBox.insertMany(boxesToCreate);
  const totalBoxes = createdBoxes.length;
  
  // Build response with created and skipped lots info
  const createdLots = lotDetails
    .filter((lot) => !existingBoxesByLot[lot.lotNumber])
    .map((lot) => ({
      lotNumber: lot.lotNumber,
      numberOfBoxes: lot.numberOfBoxes,
    }));

  const hasSkippedLots = skippedLots.length > 0;
  const message = hasSkippedLots
    ? `Created ${totalBoxes} boxes for ${createdLots.length} lot(s), skipped ${skippedLots.length} lot(s) that already have boxes`
    : `Successfully created ${totalBoxes} boxes for PO ${poNumber}`;
  
  return {
    message,
    createdCount: totalBoxes,
    boxesByLot: createdLots,
    skippedLots: hasSkippedLots ? skippedLots : undefined,
    existingBoxesByLot: hasSkippedLots ? existingBoxesByLot : undefined,
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

  // If QC was approved, trigger inventory sync for boxes stored in long-term storage
  // Note: updateMany doesn't trigger post-save hooks, so we need to handle this manually
  if (qcStatus === 'qc_approved') {
    // Save each box individually to trigger post-save hooks for inventory sync
    // This ensures boxes stored in LT storage get synced to inventory
    for (const box of updatedBoxes) {
      if (box.storedStatus && box.storageLocation && /^LT-/i.test(box.storageLocation) && box.boxWeight > 0) {
        // Trigger save to activate post-save hook
        try {
          await box.save();
        } catch (error) {
          // Log but don't fail the entire operation
          console.error(`[updateQcStatusByPoNumber] Error syncing box ${box.boxId} to inventory:`, error.message);
        }
      }
    }
  }

  return {
    message: `Successfully updated QC status to ${qcStatus} for ${updateResult.modifiedCount} boxes`,
    poNumber,
    status: qcStatus,
    updatedCount: updateResult.modifiedCount,
    totalBoxes: boxes.length,
    boxes: updatedBoxes,
  };
};


