/* eslint-disable no-underscore-dangle, no-await-in-loop, no-restricted-syntax, no-continue, no-param-reassign */
import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnBox, YarnVendorShipment, Supplier } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import { getYarnBoxByBarcode } from './yarnBox.service.js';
import { getSupplierById } from './supplier.service.js';
import { isLtLocation, isStLocation, requireActiveStorageSlot } from './storageLocation.helper.js';
import {
  classifyVendorPreview,
  getReceiveBlockReason,
  getSendBlockReason,
} from './yarnVendorJob.eligibility.js';
import {
  actorFromUser,
  buildReceiveNumber,
  nextShipmentNumber,
  snapshotBoxLine,
  toPreviewBox,
  writeVendorTransactions,
} from './yarnVendorJob.helpers.js';

/**
 * @param {string} value
 * @returns {string[]}
 */
const uniqueTrimmed = (value) => {
  const seen = new Set();
  const out = [];
  for (const raw of value || []) {
    const trimmed = String(raw || '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

const notReturnedFilter = {
  $or: [{ returnedToVendorAt: { $exists: false } }, { returnedToVendorAt: null }],
};

/**
 * Restores boxes stamped by a failed send (uses snapshots taken before vacate).
 * @param {object} shipment
 * @param {Array<object>} lines
 * @returns {Promise<void>}
 */
const rollbackSentBoxes = async (shipment, lines) => {
  await Promise.all(
    (lines || []).map((line) =>
      YarnBox.updateOne(
        { _id: line.boxMongoId, vendorShipmentId: shipment._id },
        {
          $set: {
            atVendorAt: null,
            vendorShipmentId: null,
            vendorSupplierId: null,
            storageLocation: line.storageLocationBefore || '',
            storedStatus: Boolean(String(line.storageLocationBefore || '').trim()),
          },
        }
      )
    )
  );
};

/**
 * Puts boxes back at-vendor if receive note write failed after the rack update.
 * @param {Array<object>} boxes In-memory pre-receive docs
 * @param {string} destBarcode Rack we just assigned
 * @returns {Promise<void>}
 */
const rollbackReceivedBoxes = async (boxes, destBarcode) => {
  await Promise.all(
    (boxes || []).map((box) =>
      YarnBox.updateOne(
        { _id: box._id, storageLocation: destBarcode, atVendorAt: null },
        {
          $set: {
            storageLocation: '',
            storedStatus: false,
            atVendorAt: box.atVendorAt,
            vendorShipmentId: box.vendorShipmentId,
            vendorSupplierId: box.vendorSupplierId,
          },
        }
      )
    )
  );
};

/**
 * @param {object} box
 * @returns {{ isLt: boolean, isSt: boolean }}
 */
const locationFlags = (box) => {
  const loc = String(box?.storageLocation || '').trim();
  return { isLt: isLtLocation(loc), isSt: isStLocation(loc) };
};

/**
 * @param {string} barcode
 * @returns {Promise<object>}
 */
const loadBoxForVendorJob = async (barcode) =>
  getYarnBoxByBarcode(barcode, { includeInactive: true });

/**
 * Preview a scanned barcode for send or receive.
 * @param {string} barcode
 * @returns {Promise<object>}
 */
export const previewBox = async (barcode) => {
  const trimmed = String(barcode || '').trim();
  if (!trimmed) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'barcode is required');
  }
  const box = await loadBoxForVendorJob(trimmed);
  const classification = classifyVendorPreview(box, locationFlags(box));
  let supplier = null;
  if (box.vendorSupplierId) {
    supplier = await Supplier.findById(box.vendorSupplierId).select('brandName').lean();
  }
  return {
    barcode: trimmed,
    eligibleFor: classification.eligibleFor,
    reason: classification.reason,
    box: toPreviewBox(box, supplier),
  };
};

/**
 * Send boxes to a yarn supplier (processor).
 * @param {{ barcodes: string[], supplierId: string, sendingNote?: string }} body
 * @param {object} [user]
 * @returns {Promise<object>}
 */
export const sendBoxesToVendor = async (body, user) => {
  const barcodes = uniqueTrimmed(body?.barcodes);
  if (!barcodes.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'barcodes array is required with at least one barcode');
  }

  const supplier = await getSupplierById(body.supplierId);
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');
  }
  if (supplier.status !== 'active') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Supplier is not active');
  }

  const boxes = [];
  for (const barcode of barcodes) {
    const box = await loadBoxForVendorJob(barcode);
    const reason = getSendBlockReason(box, locationFlags(box));
    if (reason) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${box.boxId || barcode}: ${reason}`);
    }
    boxes.push(box);
  }

  const ids = boxes.map((b) => b._id);
  const fresh = await YarnBox.find({
    _id: { $in: ids },
    $or: [{ atVendorAt: { $exists: false } }, { atVendorAt: null }],
    $and: [{ $or: [{ returnedToVendorAt: { $exists: false } }, { returnedToVendorAt: null }] }],
  }).lean();
  if (fresh.length !== boxes.length) {
    throw new ApiError(httpStatus.CONFLICT, 'One or more boxes changed before confirm — scan again');
  }

  const lines = boxes.map(snapshotBoxLine);
  const now = new Date();
  const actor = actorFromUser(user);
  const shipmentNumber = await nextShipmentNumber();
  const shipment = await YarnVendorShipment.create({
    shipmentNumber,
    supplierId: supplier._id,
    supplierSnapshot: {
      brandName: supplier.brandName || '',
      contactPersonName: supplier.contactPersonName || '',
      contactNumber: supplier.contactNumber || '',
      email: supplier.email || '',
      city: supplier.city || '',
      gstNo: supplier.gstNo || '',
    },
    status: 'open',
    sendingNote: String(body.sendingNote || '').trim(),
    sentAt: now,
    sentBy: actor,
    boxLines: lines,
    boxCount: lines.length,
    totalNetWeight: lines.reduce((s, l) => s + Number(l.netWeight || 0), 0),
  });

  const bulk = boxes.map((box) => ({
    updateOne: {
      filter: {
        _id: box._id,
        $or: [{ atVendorAt: { $exists: false } }, { atVendorAt: null }],
        $and: [notReturnedFilter],
      },
      update: {
        $set: {
          storedStatus: false,
          storageLocation: '',
          atVendorAt: now,
          vendorShipmentId: shipment._id,
          vendorSupplierId: supplier._id,
        },
      },
    },
  }));
  const written = await YarnBox.bulkWrite(bulk);
  if (written.matchedCount !== boxes.length) {
    await rollbackSentBoxes(shipment, lines);
    await YarnVendorShipment.updateOne(
      { _id: shipment._id },
      { $set: { status: 'voided', voidedAt: new Date(), voidedBy: actor } }
    );
    throw new ApiError(httpStatus.CONFLICT, 'One or more boxes changed before confirm — scan again');
  }

  await writeVendorTransactions({
    transactionType: 'yarn_sent_to_vendor',
    lines,
    orderno: shipmentNumber,
    toStorageLocation: 'VENDOR',
    user,
  });

  return shipment.toJSON ? shipment.toJSON() : shipment;
};

/**
 * Receive boxes from a processor onto a scanned LT rack.
 * @param {{ barcodes: string[], toStorageLocation: string, receivingNote?: string }} body
 * @param {object} [user]
 * @returns {Promise<object>}
 */
export const receiveBoxesFromVendor = async (body, user) => {
  const barcodes = uniqueTrimmed(body?.barcodes);
  if (!barcodes.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'barcodes array is required with at least one barcode');
  }

  const dest = await requireActiveStorageSlot(body.toStorageLocation);
  const destBarcode = String(dest.barcode || body.toStorageLocation).trim();
  if (!isLtLocation(destBarcode)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Receive destination must be an active long-term rack');
  }

  const boxes = [];
  for (const barcode of barcodes) {
    const box = await loadBoxForVendorJob(barcode);
    boxes.push(box);
  }

  const supplierId = boxes[0]?.vendorSupplierId != null ? String(boxes[0].vendorSupplierId) : '';
  if (!supplierId) {
    throw new ApiError(httpStatus.BAD_REQUEST, `${boxes[0]?.boxId || barcodes[0]}: ${getReceiveBlockReason(boxes[0])}`);
  }

  for (const box of boxes) {
    const reason = getReceiveBlockReason(box, { expectedSupplierId: supplierId });
    if (reason) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${box.boxId || box.barcode}: ${reason}`);
    }
  }

  const ids = boxes.map((b) => b._id);
  const fresh = await YarnBox.find({
    _id: { $in: ids },
    atVendorAt: { $ne: null },
  }).lean();
  if (fresh.length !== boxes.length) {
    throw new ApiError(httpStatus.CONFLICT, 'One or more boxes changed before confirm — scan again');
  }

  const now = new Date();
  const actor = actorFromUser(user);
  const receiveNumber = buildReceiveNumber();
  const note = String(body.receivingNote || '').trim();

  const shipmentIds = [...new Set(boxes.map((b) => String(b.vendorShipmentId)).filter(Boolean))];
  const shipments = await YarnVendorShipment.find({
    _id: { $in: shipmentIds.map((id) => new mongoose.Types.ObjectId(id)) },
    status: { $ne: 'voided' },
  });
  if (!shipments.length) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor shipment not found for these boxes');
  }

  const boxIdSet = new Set(boxes.map((b) => b.boxId));
  for (const shipment of shipments) {
    shipment.boxLines.forEach((line) => {
      if (boxIdSet.has(line.boxId) && line.receivedAt) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `${line.boxId}: already received on ${line.receiveNumber || 'a prior note'}`
        );
      }
    });
  }

  const bulk = boxes.map((box) => ({
    updateOne: {
      filter: { _id: box._id, atVendorAt: { $ne: null } },
      update: {
        $set: {
          storageLocation: destBarcode,
          storedStatus: true,
          atVendorAt: null,
          vendorShipmentId: null,
          vendorSupplierId: null,
        },
      },
    },
  }));
  const written = await YarnBox.bulkWrite(bulk);
  if (written.matchedCount !== boxes.length) {
    await rollbackReceivedBoxes(boxes, destBarcode);
    throw new ApiError(httpStatus.CONFLICT, 'One or more boxes changed before confirm — scan again');
  }

  try {
    await Promise.all(
      shipments.map((shipment) => {
        const matchingIds = [];
        shipment.boxLines.forEach((line) => {
          if (!boxIdSet.has(line.boxId) || line.receivedAt) {
            return;
          }
          line.receivedAt = now;
          line.receiveNumber = receiveNumber;
          matchingIds.push(line.boxId);
        });
        shipment.receives.push({
          receiveNumber,
          receivingNote: note,
          toStorageLocation: destBarcode,
          receivedAt: now,
          receivedBy: actor,
          boxIds: matchingIds,
        });
        const allBack = shipment.boxLines.every((l) => l.receivedAt);
        if (allBack) shipment.status = 'closed';
        return shipment.save();
      })
    );
  } catch (err) {
    await rollbackReceivedBoxes(boxes, destBarcode);
    throw err;
  }

  await writeVendorTransactions({
    transactionType: 'yarn_received_from_vendor',
    lines: boxes.map(snapshotBoxLine).map((line, i) => ({
      ...line,
      storageLocationBefore: boxes[i].storageLocation || '',
    })),
    orderno: receiveNumber,
    fromStorageLocation: 'VENDOR',
    toStorageLocation: destBarcode,
    user,
  });

  return {
    receiveNumber,
    toStorageLocation: destBarcode,
    boxCount: boxes.length,
    shipmentNumbers: shipments.map((s) => s.shipmentNumber),
    shipments: shipments.map((s) => (s.toJSON ? s.toJSON() : s)),
  };
};

/**
 * Void a send only when no boxes have been received.
 * @param {string} shipmentId
 * @param {object} [user]
 * @returns {Promise<object>}
 */
export const voidShipment = async (shipmentId, user) => {
  const shipment = await YarnVendorShipment.findById(shipmentId);
  if (!shipment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor shipment not found');
  }
  if (shipment.status === 'voided') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Shipment is already voided');
  }
  if (shipment.boxLines.some((l) => l.receivedAt)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot void a shipment after any box has been received');
  }

  const actor = actorFromUser(user);
  const claimed = await YarnVendorShipment.findOneAndUpdate(
    {
      _id: shipment._id,
      status: 'open',
      $nor: [{ boxLines: { $elemMatch: { receivedAt: { $ne: null } } } }],
    },
    { $set: { status: 'voided', voidedAt: new Date(), voidedBy: actor } },
    { new: true }
  );
  if (!claimed) {
    throw new ApiError(httpStatus.CONFLICT, 'Shipment changed before void — reload and try again');
  }

  const boxIds = claimed.boxLines.map((l) => l.boxId);
  await YarnBox.updateMany(
    { boxId: { $in: boxIds }, vendorShipmentId: claimed._id },
    {
      $set: {
        atVendorAt: null,
        vendorShipmentId: null,
        vendorSupplierId: null,
        storedStatus: false,
        storageLocation: '',
      },
    }
  );

  return claimed.toJSON ? claimed.toJSON() : claimed;
};

/**
 * @param {object} filter
 * @param {object} options
 * @returns {Promise<object>}
 */
export const queryShipments = async (filter, options) => {
  const mongoFilter = {};
  if (filter.status) mongoFilter.status = filter.status;
  if (filter.supplierId && mongoose.Types.ObjectId.isValid(filter.supplierId)) {
    mongoFilter.supplierId = filter.supplierId;
  }
  return YarnVendorShipment.paginate(mongoFilter, { sortBy: 'sentAt:desc', ...options });
};

/**
 * @param {string} shipmentId
 * @returns {Promise<object>}
 */
export const getShipmentById = async (shipmentId) => {
  const shipment = await YarnVendorShipment.findById(shipmentId);
  if (!shipment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor shipment not found');
  }
  return shipment.toJSON ? shipment.toJSON() : shipment;
};

/**
 * Boxes currently off-site at a processor.
 * @param {{ supplierId?: string }} [filter]
 * @returns {Promise<object[]>}
 */
export const listAtVendor = async (filter = {}) => {
  const mongoFilter = { atVendorAt: { $ne: null } };
  if (filter.supplierId && mongoose.Types.ObjectId.isValid(filter.supplierId)) {
    mongoFilter.vendorSupplierId = filter.supplierId;
  }
  const boxes = await YarnBox.find(mongoFilter)
    .select(
      'boxId barcode poNumber lotNumber yarnName shadeCode boxWeight tearweight numberOfCones atVendorAt vendorShipmentId vendorSupplierId storageLocation'
    )
    .lean();
  const supplierIds = [...new Set(boxes.map((b) => String(b.vendorSupplierId || '')).filter(Boolean))];
  const shipmentIds = [...new Set(boxes.map((b) => String(b.vendorShipmentId || '')).filter(Boolean))];
  const [suppliers, shipments] = await Promise.all([
    supplierIds.length
      ? Supplier.find({ _id: { $in: supplierIds } }).select('brandName').lean()
      : [],
    shipmentIds.length
      ? YarnVendorShipment.find({ _id: { $in: shipmentIds } }).select('shipmentNumber sendingNote sentAt').lean()
      : [],
  ]);
  const supplierMap = new Map(suppliers.map((s) => [String(s._id), s]));
  const shipmentMap = new Map(shipments.map((s) => [String(s._id), s]));
  const now = Date.now();
  return boxes.map((box) => {
    const sentAt = box.atVendorAt ? new Date(box.atVendorAt).getTime() : now;
    const daysOut = Math.max(0, Math.floor((now - sentAt) / 86400000));
    const supplier = supplierMap.get(String(box.vendorSupplierId || ''));
    const shipment = shipmentMap.get(String(box.vendorShipmentId || ''));
    return {
      ...toPreviewBox(box, supplier),
      daysOut,
      shipmentNumber: shipment?.shipmentNumber || '',
      sendingNote: shipment?.sendingNote || '',
      sentAt: box.atVendorAt,
    };
  });
};
