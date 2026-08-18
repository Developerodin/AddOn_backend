/* eslint-disable no-underscore-dangle, no-await-in-loop, no-restricted-syntax, no-continue */
import mongoose from 'mongoose';
import { YarnCatalog, YarnVendorShipment } from '../../models/index.js';
import * as yarnTransactionService from './yarnTransaction.service.js';
import { getBoxNetWeight } from './yarnVendorJob.eligibility.js';
import { isLtLocation } from './storageLocation.helper.js';

/**
 * @param {object|null|undefined} user
 * @returns {{ user: object|null, username: string }}
 */
export const actorFromUser = (user) => ({
  user: user?._id || user?.id || null,
  username: String(user?.name || user?.email || '').trim(),
});

/**
 * Unique YV-YYYYMMDD-XXXX challan number.
 * @returns {Promise<string>}
 */
export const nextShipmentNumber = async () => {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `YV-${day}-`;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const count = await YarnVendorShipment.countDocuments({
      shipmentNumber: new RegExp(`^${prefix}`),
    });
    const seq = String(count + 1 + attempt).padStart(4, '0');
    const shipmentNumber = `${prefix}${seq}`;
    const exists = await YarnVendorShipment.exists({ shipmentNumber });
    if (!exists) return shipmentNumber;
  }
  return `${prefix}${Date.now().toString().slice(-4)}`;
};

/**
 * @param {string} [dayKey]
 * @returns {string}
 */
export const buildReceiveNumber = (dayKey) => {
  const day = dayKey || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `YVR-${day}-${Date.now().toString().slice(-6)}`;
};

/**
 * @param {object} box
 * @returns {object}
 */
export const snapshotBoxLine = (box) => {
  const netWeight = getBoxNetWeight(box);
  return {
    boxMongoId: box._id,
    boxId: box.boxId,
    barcode: box.barcode,
    poNumber: box.poNumber || '',
    lotNumber: box.lotNumber || '',
    yarnCatalogId: box.yarnCatalogId || undefined,
    yarnName: box.yarnName || '',
    shadeCode: box.shadeCode || '',
    numberOfCones: Number(box.numberOfCones || 0),
    boxWeight: Number(box.boxWeight || 0),
    tearweight: Number(box.tearweight || 0),
    netWeight,
    grossWeight: Number(box.grossWeight || 0),
    storageLocationBefore: String(box.storageLocation || '').trim(),
    qcStatus: box.qcData?.status || '',
    receivedAt: null,
    receiveNumber: '',
  };
};

/**
 * API preview card payload.
 * @param {object} box
 * @param {object|null} [supplier]
 * @returns {object}
 */
export const toPreviewBox = (box, supplier = null) => ({
  id: box._id != null ? String(box._id) : undefined,
  boxId: box.boxId,
  barcode: box.barcode,
  poNumber: box.poNumber || '',
  lotNumber: box.lotNumber || '',
  yarnName: box.yarnName || '',
  yarnCatalogId: box.yarnCatalogId != null ? String(box.yarnCatalogId) : null,
  shadeCode: box.shadeCode || '',
  numberOfCones: Number(box.numberOfCones || 0),
  boxWeight: Number(box.boxWeight || 0),
  tearweight: Number(box.tearweight || 0),
  netWeight: getBoxNetWeight(box),
  grossWeight: Number(box.grossWeight || 0),
  storageLocation: String(box.storageLocation || '').trim(),
  storedStatus: Boolean(box.storedStatus),
  qcStatus: box.qcData?.status || '',
  atVendorAt: box.atVendorAt || null,
  vendorShipmentId: box.vendorShipmentId != null ? String(box.vendorShipmentId) : null,
  vendorSupplierId: box.vendorSupplierId != null ? String(box.vendorSupplierId) : null,
  vendorName: supplier?.brandName || '',
});

/**
 * @param {object} box
 * @returns {Promise<object|null>}
 */
export const resolveYarnCatalog = async (box) => {
  if (box?.yarnCatalogId && mongoose.Types.ObjectId.isValid(String(box.yarnCatalogId))) {
    const byId = await YarnCatalog.findById(box.yarnCatalogId).select('_id yarnName').lean();
    if (byId) return byId;
  }
  const name = String(box?.yarnName || '').trim();
  if (!name) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return YarnCatalog.findOne({
    yarnName: { $regex: new RegExp(`^${escaped}$`, 'i') },
    status: { $ne: 'deleted' },
  })
    .select('_id yarnName')
    .lean();
};

/**
 * Groups box lines by catalog and writes audit transactions. Failures are logged, not thrown.
 * @param {object} opts
 * @param {'yarn_sent_to_vendor'|'yarn_received_from_vendor'} opts.transactionType
 * @param {Array<object>} opts.lines
 * @param {string} opts.orderno
 * @param {string} [opts.fromStorageLocation]
 * @param {string} [opts.toStorageLocation]
 * @param {object} [opts.user]
 * @returns {Promise<void>}
 */
export const writeVendorTransactions = async ({
  transactionType,
  lines,
  orderno,
  fromStorageLocation,
  toStorageLocation,
  user,
}) => {
  const groups = new Map();
  for (const line of lines) {
    const catalog = await resolveYarnCatalog(line);
    if (!catalog?._id) {
      console.error(`[YarnVendorJob] skip txn, no catalog for box ${line.boxId}`);
      continue;
    }
    const key = String(catalog._id);
    if (!groups.has(key)) {
      groups.set(key, { catalog, lines: [] });
    }
    groups.get(key).lines.push(line);
  }

  for (const { catalog, lines: groupLines } of groups.values()) {
    const ltLines =
      transactionType === 'yarn_sent_to_vendor'
        ? groupLines.filter((l) => isLtLocation(l.storageLocationBefore))
        : groupLines;
    const weightLines = transactionType === 'yarn_sent_to_vendor' && ltLines.length ? ltLines : groupLines;
    const fromLoc =
      transactionType === 'yarn_sent_to_vendor'
        ? weightLines.find((l) => isLtLocation(l.storageLocationBefore))?.storageLocationBefore ||
          String(fromStorageLocation || '')
        : String(fromStorageLocation || 'VENDOR');

    const totalWeight = weightLines.reduce((s, l) => s + Number(l.boxWeight || 0), 0);
    const totalTearWeight = weightLines.reduce((s, l) => s + Number(l.tearweight || 0), 0);
    const totalNetWeight = weightLines.reduce((s, l) => s + Number(l.netWeight || l.boxWeight || 0), 0);
    const numberOfCones = weightLines.reduce((s, l) => s + Number(l.numberOfCones || 0), 0);

    try {
      await yarnTransactionService.createYarnTransaction({
        yarnCatalogId: catalog._id.toString(),
        yarnName: catalog.yarnName,
        transactionType,
        transactionDate: new Date(),
        totalWeight,
        totalNetWeight,
        totalTearWeight,
        numberOfCones,
        orderno,
        boxIds: groupLines.map((l) => l.boxId),
        fromStorageLocation: fromLoc,
        toStorageLocation: String(toStorageLocation || ''),
        issuedByEmail: user?.email || undefined,
      });
    } catch (err) {
      console.error(`[YarnVendorJob] ${transactionType} txn failed:`, err?.message || err);
    }
  }
};
