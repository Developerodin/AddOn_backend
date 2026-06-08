import mongoose from 'mongoose';
import { YarnCatalog } from '../../models/index.js';
import {
  buildSupplierSnapshot,
  buildConsigneeSnapshot,
} from './yarnGrnSnapshot.builder.js';

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
 * Resolves yarn display names for vendor-return line catalog ids.
 * @param {Array<object>} lines
 * @returns {Promise<Map<string, string>>}
 */
const resolveYarnNames = async (lines) => {
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
    .select('yarnName')
    .lean();
  for (const c of catalogs) {
    map.set(String(c._id), trimSafe(c.yarnName));
  }
  return map;
};

/**
 * Builds immutable challan snapshot fields from a completed vendor return + PO.
 * @param {object} vendorReturn - lean YarnPoVendorReturn (completed)
 * @param {object} purchaseOrder - populated or lean YarnPurchaseOrder
 * @returns {Promise<object>}
 */
export const buildReturnChallanSnapshot = async (vendorReturn, purchaseOrder) => {
  const po = purchaseOrder || {};
  const lines = Array.isArray(vendorReturn?.lines) ? vendorReturn.lines : [];
  const yarnNameByCatalog = await resolveYarnNames(lines);

  const snapshotLines = lines.map((line) => {
    const catalogId = line?.yarnCatalogId?.toString?.() || (typeof line?.yarnCatalogId === 'string' ? line.yarnCatalogId : '');
    return {
      barcode: trimSafe(line.barcode),
      coneId: line.coneId,
      boxId: trimSafe(line.boxId),
      lotNumber: trimSafe(line.lotNumber),
      yarnCatalogId: catalogId || undefined,
      yarnName: yarnNameByCatalog.get(catalogId) || '',
      coneWeight: toNumber(line.coneWeight),
      tearWeight: toNumber(line.tearWeight),
      netWeight: toNumber(line.netWeight),
    };
  });

  const totalNetWeight = snapshotLines.reduce((s, l) => s + l.netWeight, 0);
  const totalGrossWeight = snapshotLines.reduce((s, l) => s + l.coneWeight, 0);

  return {
    supplier: buildSupplierSnapshot(po),
    consignee: buildConsigneeSnapshot(),
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
