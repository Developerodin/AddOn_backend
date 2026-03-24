import VendorPurchaseOrder from '../models/vendorManagement/vendorPurchaseOrder.model.js';

/**
 * Next serial for Vendor PO numbers: VPO-YYYY-0001, VPO-YYYY-0002, …
 * Year segment resets sequence (2027 starts at VPO-2027-0001).
 * @param {number} year - Full calendar year (e.g. 2026)
 * @returns {Promise<string>}
 */
async function getNextVendorPoNumberForYear(year) {
  const prefix = `VPO-${year}-`;
  const result = await VendorPurchaseOrder.aggregate([
    { $match: { vpoNumber: { $regex: `^VPO-${year}-[0-9]+$` } } },
    {
      $addFields: {
        seq: { $toInt: { $arrayElemAt: [{ $split: ['$vpoNumber', '-'] }, 2] } },
      },
    },
    { $match: { seq: { $ne: null, $gte: 0 } } },
    { $group: { _id: null, maxSeq: { $max: '$seq' } } },
  ]);
  const maxSeq = result[0]?.maxSeq;
  const nextSeq = typeof maxSeq === 'number' && Number.isInteger(maxSeq) ? maxSeq + 1 : 1;
  const suffix = nextSeq < 10000 ? String(nextSeq).padStart(4, '0') : String(nextSeq);
  return `${prefix}${suffix}`;
}

export default getNextVendorPoNumberForYear;
