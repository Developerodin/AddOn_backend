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
 * Resolves the PO supplier document when only an ObjectId is stored on the PO.
 * @param {object} po - lean or populated YarnPurchaseOrder
 * @returns {Promise<object|null>}
 */
export const resolvePoSupplier = async (po) => {
  const embedded = po?.supplier && typeof po.supplier === 'object' ? po.supplier : null;
  if (embedded?.brandName || embedded?.address || embedded?.gstNo) {
    return embedded;
  }

  const supplierId =
    po?.supplier?._id?.toString?.() ||
    po?.supplier?.toString?.() ||
    (typeof po?.supplier === 'string' ? po.supplier : '');

  if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
    return embedded;
  }

  return Supplier.findById(supplierId).select(SUPPLIER_SELECT).lean();
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
  const lines = Array.isArray(vendorReturn?.lines) ? vendorReturn.lines : [];
  const catalogFieldsById = await resolveYarnCatalogFields(lines);

  const snapshotLines = lines.map((line) => {
    const catalogId = line?.yarnCatalogId?.toString?.() || (typeof line?.yarnCatalogId === 'string' ? line.yarnCatalogId : '');
    const catalogFields = catalogFieldsById.get(catalogId);
    return {
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

  const totalNetWeight = snapshotLines.reduce((s, l) => s + l.netWeight, 0);
  const totalGrossWeight = snapshotLines.reduce((s, l) => s + l.coneWeight, 0);

  return {
    supplier: buildConsigneeSnapshot(),
    consignee: await buildVendorConsigneeSnapshot(po),
    lines: snapshotLines,
    totals: {
      coneCount: snapshotLines.length,
      totalNetWeight,
      totalGrossWeight,
    },
    cancellationIntent: vendorReturn.cancellationIntent,
    remark: trimSafe(vendorReturn.remark),
    completedAt: vendorReturn.completedAt || vendorReturn.updatedAt || new Date(),
  };
};
