/**
 * Pure snapshot builder for Vendor PO return challans.
 */

const ADDON_CONSIGNOR = Object.freeze({
  name: 'ADDON HOLDINGS PRIVATE LIMITED',
  vendorCode: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  gstin: '27AAACA8827A1ZZ',
});

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
 * Build vendor party snapshot from populated VPO / VendorManagement.
 * @param {Object} vpo
 */
const buildVendorParty = (vpo) => {
  const vm = vpo?.vendor && typeof vpo.vendor === 'object' ? vpo.vendor : {};
  const header = vm?.header || {};
  return {
    vendorId: vm?._id || vpo?.vendor || null,
    name: trimSafe(vpo?.vendorName || header.vendorName),
    vendorCode: trimSafe(header.vendorCode),
    address: trimSafe(header.address),
    city: trimSafe(header.city),
    state: trimSafe(header.state),
    pincode: trimSafe(header.pincode),
    gstin: trimSafe(header.gstin || header.gstNo),
    contactNumber: trimSafe(header.contactNumber),
    email: trimSafe(header.email),
  };
};

/**
 * Build immutable challan snapshot from a completed vendor return + VPO.
 * @param {Object} vendorReturn - completed VendorPoVendorReturn lean doc
 * @param {Object} vpo - populated VendorPurchaseOrder
 * @returns {Object}
 */
export const buildVendorReturnChallanSnapshot = (vendorReturn, vpo) => {
  const lines = [];

  (vendorReturn.boxLines || []).forEach((box) => {
    lines.push({
      lineType: 'box',
      barcode: box.barcode,
      boxId: box.boxId,
      lotNumber: trimSafe(box.lotNumber),
      productId: box.productId,
      productName: trimSafe(box.productName),
      vendorCode: trimSafe(box.vendorCode),
      numberOfUnits: toNumber(box.numberOfUnits),
      m4Quantity: 0,
      articleQuantity: 0,
    });
  });

  (vendorReturn.m4Lines || []).forEach((row) => {
    lines.push({
      lineType: 'm4',
      barcode: '',
      boxId: '',
      lotNumber: trimSafe(row.lotNumber),
      productId: row.productId,
      productName: trimSafe(row.productName),
      vendorCode: trimSafe(row.vendorCode),
      numberOfUnits: 0,
      m4Quantity: toNumber(row.m4Quantity),
      articleQuantity: 0,
      vendorProductionFlowId: row.vendorProductionFlowId,
    });
  });

  (vendorReturn.articleQtyLines || []).forEach((row) => {
    lines.push({
      lineType: 'article',
      barcode: '',
      boxId: '',
      lotNumber: trimSafe(row.lotNumber),
      productId: row.productId,
      productName: trimSafe(row.productName),
      vendorCode: trimSafe(row.vendorCode),
      numberOfUnits: 0,
      m4Quantity: 0,
      articleQuantity: toNumber(row.quantity),
      vendorProductionFlowId: row.vendorProductionFlowId,
    });
  });

  const boxCount = (vendorReturn.boxLines || []).length;
  const totalUnits = lines.reduce((s, l) => s + toNumber(l.numberOfUnits), 0);
  const m4UnitCount = lines.reduce((s, l) => s + toNumber(l.m4Quantity), 0);
  const articleQtyCount =
    toNumber(vendorReturn.articleQtyCount) ||
    lines.reduce((s, l) => s + toNumber(l.articleQuantity), 0);

  return {
    vpoNumber: trimSafe(vendorReturn.vpoNumber),
    vendorPurchaseOrder: vpo?._id || vendorReturn.vendorPurchaseOrder,
    vpoDate: vpo?.createDate || vpo?.createdAt || null,
    consignor: { ...ADDON_CONSIGNOR },
    vendor: buildVendorParty(vpo),
    lines,
    totals: { boxCount, totalUnits, m4UnitCount, articleQtyCount },
    cancellationIntent: vendorReturn.cancellationIntent,
    remark: trimSafe(vendorReturn.remark),
    completedAt: vendorReturn.completedAt || new Date(),
  };
};
