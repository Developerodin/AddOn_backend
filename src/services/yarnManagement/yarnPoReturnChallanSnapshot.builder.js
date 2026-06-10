import mongoose from 'mongoose';
import { YarnCatalog, Supplier } from '../../models/index.js';
import {
  buildSupplierSnapshot,
  buildConsigneeSnapshot,
} from './yarnGrnSnapshot.builder.js';

const SUPPLIER_SELECT =
  'brandName address city state pincode country gstNo contactNumber contactPersonName email';

/**
 * @param {*} value
 * @returns {number}
 */
const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * @param {string|null|undefined} value
 * @returns {string}
 */
const trimSafe = (value) => (value == null ? '' : String(value).trim());

/**
 * Extracts the Supplier ObjectId from a PO supplier field (ref, populated doc, or string).
 * @param {object} po - lean or populated YarnPurchaseOrder
 * @returns {string}
 */
const extractPoSupplierId = (po) => {
  const raw = po?.supplier;
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object') {
    if (raw._id) return raw._id.toString();
    if (mongoose.Types.ObjectId.isValid(raw)) return raw.toString();
  }
  return '';
};

/**
 * Resolves full Brand Master (Supplier) data for challan snapshot at write time only.
 * Always prefers DB fetch when a valid supplier ref exists on the PO.
 * @param {object} po - lean or populated YarnPurchaseOrder
 * @returns {Promise<object|null>}
 */
export const resolvePoSupplier = async (po) => {
  const embedded =
    po?.supplier && typeof po.supplier === 'object' && !mongoose.Types.ObjectId.isValid(po.supplier)
      ? po.supplier
      : null;

  const supplierId = extractPoSupplierId(po);
  if (supplierId && mongoose.Types.ObjectId.isValid(supplierId)) {
    const fromDb = await Supplier.findById(supplierId).select(SUPPLIER_SELECT).lean();
    if (fromDb) return fromDb;
  }

  return embedded;
};

/**
 * Builds consignee snapshot from PO vendor (receiver of returned yarn).
 * @param {object} po - lean or populated YarnPurchaseOrder
 * @returns {Promise<object>}
 */
export const buildVendorConsigneeSnapshot = async (po) => {
  const resolvedSupplier = await resolvePoSupplier(po || {});
  const poWithSupplier = resolvedSupplier
    ? { ...po, supplier: resolvedSupplier }
    : po || {};
  const vendor = buildSupplierSnapshot(poWithSupplier);

  return {
    supplierId: vendor.supplierId || undefined,
    name: vendor.name,
    address: vendor.address,
    city: vendor.city,
    state: vendor.state,
    pincode: vendor.pincode,
    country: vendor.country,
    gstNo: vendor.gstNo,
    contactNumber: vendor.contactNumber,
    contactPersonName: vendor.contactPersonName,
    email: vendor.email,
    stateCode: trimSafe(vendor.gstNo).slice(0, 2) || undefined,
  };
};

/**
 * Resolves yarn catalog fields (name + HSN) for vendor-return line catalog ids.
 * @param {Array<object>} lines
 * @returns {Promise<Map<string, { yarnName: string, hsnCode: string }>>}
 */
const resolveYarnCatalogFields = async (lines) => {
  const ids = [
    ...new Set(
      (lines || [])
        .map((l) => l?.yarnCatalogId?.toString?.() || (typeof l?.yarnCatalogId === 'string' ? l.yarnCatalogId : ''))
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
    ),
  ];
  const map = new Map();
  if (ids.length === 0) return map;
  const catalogs = await YarnCatalog.find({ _id: { $in: ids } })
    .select('yarnName hsnCode')
    .lean();
  for (const c of catalogs) {
    map.set(String(c._id), {
      yarnName: trimSafe(c.yarnName),
      hsnCode: trimSafe(c.hsnCode),
    });
  }
  return map;
};

/**
 * Builds immutable challan snapshot fields from a completed vendor return + PO.
 * Supplier = ADDON HOLDINGS (sender); consignee = vendor (receiver).
 * @param {object} vendorReturn - lean YarnPoVendorReturn (completed)
 * @param {object} purchaseOrder - populated or lean YarnPurchaseOrder
 * @returns {Promise<object>}
 */
export const buildReturnChallanSnapshot = async (vendorReturn, purchaseOrder) => {
  const po = purchaseOrder || {};
  const coneLines = Array.isArray(vendorReturn?.lines) ? vendorReturn.lines : [];
  const boxLines = Array.isArray(vendorReturn?.boxLines) ? vendorReturn.boxLines : [];
  const catalogFieldsById = await resolveYarnCatalogFields([...coneLines, ...boxLines]);

  const snapshotConeLines = coneLines.map((line) => {
    const catalogId = line?.yarnCatalogId?.toString?.() || (typeof line?.yarnCatalogId === 'string' ? line.yarnCatalogId : '');
    const catalogFields = catalogFieldsById.get(catalogId);
    return {
      lineType: 'cone',
      barcode: trimSafe(line.barcode),
      coneId: line.coneId,
      boxId: trimSafe(line.boxId),
      lotNumber: trimSafe(line.lotNumber),
      yarnCatalogId: catalogId || undefined,
      yarnName: catalogFields?.yarnName || '',
      hsnCode: catalogFields?.hsnCode || '',
      coneWeight: toNumber(line.coneWeight),
      tearWeight: toNumber(line.tearWeight),
      netWeight: toNumber(line.netWeight),
    };
  });

  const snapshotBoxLines = boxLines.map((line) => {
    const catalogId = line?.yarnCatalogId?.toString?.() || (typeof line?.yarnCatalogId === 'string' ? line.yarnCatalogId : '');
    const catalogFields = catalogFieldsById.get(catalogId);
    const boxId = trimSafe(line.boxId);
    const coneCount = toNumber(line.numberOfCones);
    const yarnLabel = catalogFields?.yarnName || trimSafe(line.yarnName);
    return {
      lineType: 'box',
      barcode: boxId,
      boxId,
      lotNumber: trimSafe(line.lotNumber),
      yarnCatalogId: catalogId || undefined,
      yarnName: coneCount > 0 ? `${yarnLabel} (${coneCount} cones)`.trim() : yarnLabel,
      hsnCode: catalogFields?.hsnCode || '',
      coneWeight: toNumber(line.boxWeight),
      tearWeight: toNumber(line.tearWeight),
      netWeight: toNumber(line.netWeight),
    };
  });

  const snapshotLines = [...snapshotBoxLines, ...snapshotConeLines];
  const totalNetWeight = snapshotLines.reduce((s, l) => s + l.netWeight, 0);
  const totalGrossWeight = snapshotLines.reduce((s, l) => s + l.coneWeight, 0);

  return {
    supplier: buildConsigneeSnapshot(),
    consignee: await buildVendorConsigneeSnapshot(po),
    lines: snapshotLines,
    totals: {
      boxCount: snapshotBoxLines.length,
      coneCount: snapshotConeLines.length,
      totalNetWeight,
      totalGrossWeight,
    },
    cancellationIntent: vendorReturn.cancellationIntent,
    remark: trimSafe(vendorReturn.remark),
    completedAt: vendorReturn.completedAt || vendorReturn.updatedAt || new Date(),
  };
};
