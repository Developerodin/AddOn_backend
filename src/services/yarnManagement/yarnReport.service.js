import mongoose from 'mongoose';
import {
  YarnTransaction,
  YarnPurchaseOrder,
  YarnCatalog,
  Supplier,
  YarnBox,
  YarnCone,
} from '../../models/index.js';
import { LT_SECTION_CODES } from '../../models/storageManagement/storageSlot.model.js';

const toNum = (v) => Number(v ?? 0);

/** LT storage pattern: LT-* or B7-02/03/04/05-* */
const LT_REGEX = new RegExp(`^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`, 'i');

/**
 * Get brand and shadeNumber for yarns from PO, YarnCone, YarnBox (any date).
 * Used when yarn has transactions but no PO in the report date range.
 */
const getBrandAndShadeForYarns = async (yarnIds, catalogMap) => {
  const map = new Map();
  if (!yarnIds.length) return map;

  const objectIds = yarnIds.map((id) => new mongoose.Types.ObjectId(id));

  // 1. From YarnPurchaseOrder - most recent PO per yarn (brand + shade)
  const pos = await YarnPurchaseOrder.find({ 'poItems.yarn': { $in: objectIds } })
    .populate('supplier', 'brandName')
    .sort({ createDate: -1 })
    .lean();

  const supplierIds = [...new Set(pos.map((p) => (p.supplier?._id ?? p.supplier)?.toString?.()).filter(Boolean))];
  const suppliers = supplierIds.length
    ? await Supplier.find({ _id: { $in: supplierIds.map((id) => new mongoose.Types.ObjectId(id)) } })
        .select('brandName')
        .lean()
    : [];
  const supplierBrandMap = new Map(suppliers.map((s) => [s._id.toString(), s.brandName ?? '']));

  for (const po of pos) {
    const supplierId = po.supplier?._id?.toString?.() ?? po.supplier?.toString?.() ?? '';
    const brand = supplierBrandMap.get(supplierId) ?? po.supplier?.brandName ?? po.supplierName ?? '';
    for (const item of po.poItems || []) {
      const yarnId = item.yarn?.toString?.();
      if (!yarnId || map.has(yarnId)) continue;
      const rate = toNum(item.rate);
      const qty = toNum(item.quantity);
      map.set(yarnId, {
        brand,
        shadeNumber: (item.shadeCode || '').trim(),
        rate,
        gstRate: toNum(item.gstRate),
        amount: rate * qty,
      });
    }
  }

  // 2. From YarnCone - shadeCode for yarns still missing
  const missingForShade = yarnIds.filter((id) => !map.has(id) || !map.get(id).shadeNumber);
  if (missingForShade.length) {
    const cones = await YarnCone.aggregate([
      { $match: { yarn: { $in: missingForShade.map((id) => new mongoose.Types.ObjectId(id)) } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$yarn', shadeCode: { $first: '$shadeCode' } } },
    ]);
    for (const c of cones) {
      const yarnId = c._id?.toString?.();
      if (!yarnId) continue;
      const shade = (c.shadeCode || '').trim();
      if (!map.has(yarnId)) {
        map.set(yarnId, { brand: '', shadeNumber: shade });
      } else if (!map.get(yarnId).shadeNumber && shade) {
        map.get(yarnId).shadeNumber = shade;
      }
    }
  }

  // 3. From YarnBox - shadeCode by yarnName for yarns still missing shade
  const stillMissing = yarnIds.filter((id) => !map.has(id) || !map.get(id).shadeNumber);
  if (stillMissing.length) {
    const yarnNames = stillMissing
      .map((id) => catalogMap.get(id)?.yarnName)
      .filter(Boolean)
      .map((n) => n.trim());
    if (yarnNames.length) {
      const boxes = await YarnBox.aggregate([
        { $match: { yarnName: { $in: yarnNames } } },
        { $sort: { receivedDate: -1, createdAt: -1 } },
        { $group: { _id: '$yarnName', shadeCode: { $first: '$shadeCode' } } },
      ]);
      const yarnNameToId = new Map();
      stillMissing.forEach((id) => {
        const name = catalogMap.get(id)?.yarnName?.trim?.();
        if (name) yarnNameToId.set(name, id);
      });
      for (const b of boxes) {
        const yarnId = yarnNameToId.get(b._id?.trim?.());
        const shade = (b.shadeCode || '').trim();
        if (!yarnId) continue;
        if (!map.has(yarnId)) {
          map.set(yarnId, { brand: '', shadeNumber: shade });
        } else if (!map.get(yarnId).shadeNumber && shade) {
          map.get(yarnId).shadeNumber = shade;
        }
      }
    }
  }

  return map;
};

/**
 * Discover yarnIds that have physical stock (boxes or cones) but may not be in PO/txn.
 * Returns Set of yarnIds for loading catalog.
 */
const getYarnIdsWithPhysicalStock = async () => {
  const ids = new Set();
  const [boxNames, coneYarns, catalogAll] = await Promise.all([
    YarnBox.distinct('yarnName', { boxWeight: { $gt: 0 } }),
    YarnCone.distinct('yarn', {
      coneStorageId: { $exists: true, $nin: [null, ''] },
      issueStatus: { $ne: 'issued' },
    }),
    YarnCatalog.find({}).select('_id yarnName').lean(),
  ]);
  coneYarns.forEach((id) => id && ids.add(id.toString()));
  const nameToId = new Map();
  catalogAll.forEach((c) => {
    if (c?.yarnName) nameToId.set(c.yarnName.trim().toLowerCase(), c._id.toString());
  });
  (boxNames || []).forEach((n) => {
    const id = nameToId.get((n || '').trim().toLowerCase());
    if (id) ids.add(id);
  });
  return ids;
};

/**
 * Opening from ALL physical stock: stored boxes + unstored boxes + cones.
 * No date filter - uses current stock as opening (what we have in warehouse).
 *
 * Stored: YarnBox in LT, qc approved.
 * Unstored: YarnBox NOT in LT (received but not yet put in LT).
 * Cones: YarnCone in ST (coneStorageId set), not issued.
 */
const getOpeningFromPhysicalStorage = async (yarnIds, catalogMap) => {
  const map = new Map();
  const yarnNameToId = new Map();
  catalogMap.forEach((c, id) => {
    if (c?.yarnName) yarnNameToId.set(c.yarnName.trim().toLowerCase(), id);
  });

  // 1. ALL boxes with weight > 0 - fetch all, filter in memory (avoids MongoDB regex length limit)
  const allBoxes = await YarnBox.find({ boxWeight: { $gt: 0 } })
    .select('yarnName boxWeight tearweight')
    .lean();

  for (const b of allBoxes) {
    const yarnId = yarnNameToId.get((b.yarnName || '').trim().toLowerCase());
    if (!yarnId) continue;
    const net = Math.max(0, toNum(b.boxWeight) - toNum(b.tearweight));
    if (net > 0) map.set(yarnId, (map.get(yarnId) || 0) + net);
  }

  // 2. Cones in ST (not issued) - no date filter
  const objectIds = yarnIds.map((id) => new mongoose.Types.ObjectId(id));
  const cones = await YarnCone.find({
    yarn: { $in: objectIds },
    coneStorageId: { $exists: true, $nin: [null, ''] },
    issueStatus: { $ne: 'issued' },
  })
    .select('yarn coneWeight tearWeight')
    .lean();

  for (const c of cones) {
    const yarnId = c.yarn?.toString?.();
    if (!yarnId) continue;
    const net = Math.max(0, toNum(c.coneWeight) - toNum(c.tearWeight));
    if (net > 0) map.set(yarnId, (map.get(yarnId) || 0) + net);
  }

  return map;
};

/**
 * Compute opening balance (net weight) per yarn at a given date.
 * Primary: sum(yarn_stocked) - sum(yarn_issued) + sum(yarn_returned) for txns before date.
 * Fallback: physical storage (YarnBox + YarnCone) when transaction opening is 0.
 *
 * @param {Date} beforeDate - All transactions before this date
 * @returns {Promise<Map<string, number>>} yarnId -> opening net weight (kg)
 */
const getOpeningBalanceByYarn = async (beforeDate) => {
  const pipeline = [
    { $match: { transactionDate: { $lt: beforeDate } } },
    {
      $group: {
        _id: '$yarn',
        stocked: { $sum: { $cond: [{ $eq: ['$transactionType', 'yarn_stocked'] }, '$transactionNetWeight', 0] } },
        issued: { $sum: { $cond: [{ $eq: ['$transactionType', 'yarn_issued'] }, '$transactionNetWeight', 0] } },
        returned: { $sum: { $cond: [{ $eq: ['$transactionType', 'yarn_returned'] }, '$transactionNetWeight', 0] } },
      },
    },
    {
      $project: {
        opening: { $subtract: [{ $add: ['$stocked', '$returned'] }, '$issued'] },
      },
    },
  ];

  const result = await YarnTransaction.aggregate(pipeline);
  const map = new Map();
  result.forEach((r) => {
    const id = r._id?.toString?.();
    if (id) map.set(id, toNum(r.opening));
  });
  return map;
};

/**
 * Get opening balance: transaction-based, with physical storage fallback for yarns with 0.
 */
const getOpeningWithPhysicalFallback = async (beforeDate, yarnIds, catalogMap) => {
  const [txnMap, physicalMap] = await Promise.all([
    getOpeningBalanceByYarn(beforeDate),
    getOpeningFromPhysicalStorage(yarnIds, catalogMap),
  ]);
  const merged = new Map();
  const allIds = new Set([...txnMap.keys(), ...physicalMap.keys(), ...yarnIds]);
  for (const id of allIds) {
    const txn = txnMap.get(id) ?? 0;
    const phys = physicalMap.get(id) ?? 0;
    merged.set(id, phys > 0 ? phys : txn);
  }
  return merged;
};

/**
 * Aggregate transaction totals per yarn for a date range.
 *
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<Map<string, { store: number, issued: number, returned: number }>>}
 */
const getTransactionTotalsInRange = async (startDate, endDate) => {
  const pipeline = [
    { $match: { transactionDate: { $gte: startDate, $lte: endDate } } },
    {
      $group: {
        _id: '$yarn',
        store: { $sum: { $cond: [{ $eq: ['$transactionType', 'yarn_stocked'] }, '$transactionNetWeight', 0] } },
        issued: { $sum: { $cond: [{ $eq: ['$transactionType', 'yarn_issued'] }, '$transactionNetWeight', 0] } },
        returned: { $sum: { $cond: [{ $eq: ['$transactionType', 'yarn_returned'] }, '$transactionNetWeight', 0] } },
      },
    },
  ];

  const result = await YarnTransaction.aggregate(pipeline);
  const map = new Map();
  result.forEach((r) => {
    const id = r._id?.toString?.();
    if (id) {
      map.set(id, {
        store: toNum(r.store),
        issued: toNum(r.issued),
        returned: toNum(r.returned),
      });
    }
  });
  return map;
};

/**
 * Get Pur (purchase received) and PurRet (purchase return / rejected) per (yarn, shade, supplier)
 * from YarnPurchaseOrder.
 *
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<Array<{ yarnId, shadeCode, supplierId, supplierName, pur, purRet, rate, gstRate, amount }>>}
 */
const getPurchaseDataByYarnShadeSupplier = async (startDate, endDate) => {
  const pos = await YarnPurchaseOrder.find({
    $or: [
      { goodsReceivedDate: { $gte: startDate, $lte: endDate } },
      { currentStatus: 'po_rejected', lastUpdateDate: { $gte: startDate, $lte: endDate } },
      { 'receivedLotDetails.status': 'lot_rejected', lastUpdateDate: { $gte: startDate, $lte: endDate } },
    ],
  })
    .populate('supplier', 'brandName')
    .lean();

  const supplierIds = [
    ...new Set(
      pos
        .map((p) => (p.supplier?._id ?? p.supplier)?.toString?.())
        .filter(Boolean)
    ),
  ];
  const suppliers = supplierIds.length
    ? await Supplier.find({ _id: { $in: supplierIds.map((id) => new mongoose.Types.ObjectId(id)) } })
        .select('brandName')
        .lean()
    : [];
  const supplierBrandMap = new Map(suppliers.map((s) => [s._id.toString(), s.brandName ?? '']));

  const map = new Map();

  for (const po of pos) {
    const supplierId = po.supplier?._id?.toString?.() ?? po.supplier?.toString?.() ?? '';
    const supplierName = supplierBrandMap.get(supplierId) ?? po.supplier?.brandName ?? po.supplierName ?? '';
    const poInRange = po.goodsReceivedDate >= startDate && po.goodsReceivedDate <= endDate;
    const rejectionInRange = po.lastUpdateDate >= startDate && po.lastUpdateDate <= endDate;

    for (const item of po.poItems || []) {
      const yarnId = item.yarn?.toString?.() ?? '';
      const shadeCode = (item.shadeCode || '').trim();
      const key = `${yarnId}|${shadeCode}|${supplierId}`;
      if (!yarnId) continue;

      let pur = 0;
      let purRet = 0;

      for (const lot of po.receivedLotDetails || []) {
        for (const rec of lot.poItems || []) {
          const poItemId = rec.poItem?.toString?.();
          if (poItemId !== item._id?.toString?.()) continue;

          const qty = toNum(rec.receivedQuantity);
          if (lot.status === 'lot_rejected' && rejectionInRange) {
            purRet += qty;
          } else if (lot.status === 'lot_accepted' && poInRange) {
            pur += qty;
          }
        }
      }

      if (po.currentStatus === 'po_rejected' && rejectionInRange) {
        purRet += toNum(item.quantity);
      }

      const rate = toNum(item.rate);
      const gstRate = toNum(item.gstRate);
      const qty = toNum(item.quantity);
      const amount = rate * qty;

      if (!map.has(key)) {
        map.set(key, {
          yarnId,
          shadeCode,
          supplierId,
          supplierName,
          pur: 0,
          purRet: 0,
          rate,
          gstRate,
          amount: 0,
          pantoneName: (item.pantoneName || '').trim(),
        });
      }
      const row = map.get(key);
      row.pur += pur;
      row.purRet += purRet;
      row.amount += amount;
    }
  }

  return Array.from(map.values());
};

/**
 * Yarn report by date range.
 * Rows: per (yarn, shade, supplier). Columns: Store, HSN, Yarn Name, Brand, Shade, etc.
 *
 * @param {Object} params
 * @param {string} params.startDate - ISO date string
 * @param {string} params.endDate - ISO date string
 * @returns {Promise<{ results: Array, summary?: Object }>}
 */
/**
 * Parse date string or Date as local midnight (avoids UTC shift).
 * "2026-01-01" or Date -> 2026-01-01 00:00:00 local
 */
const parseLocalDate = (dateInput) => {
  if (!dateInput) return new Date(NaN);
  if (dateInput instanceof Date && !Number.isNaN(dateInput.getTime())) {
    return new Date(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate());
  }
  const str = String(dateInput);
  const datePart = str.includes('T') ? str.split('T')[0] : str.split(' ')[0];
  const parts = datePart.split(/[-/]/).map(Number);
  if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) return new Date(NaN);
  const [y, m, d] = parts;
  return new Date(y, m - 1, d);
};

export const getYarnReportByDateRange = async ({ startDate, endDate }) => {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid start_date or end_date. Use format YYYY-MM-DD (e.g. 2026-01-01)');
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  const [txnMap, purchaseRows] = await Promise.all([
    getTransactionTotalsInRange(start, end),
    getPurchaseDataByYarnShadeSupplier(start, end),
  ]);

  const purchaseYarnIds = new Set(purchaseRows.map((r) => r.yarnId));
  const txnYarnIds = new Set(txnMap.keys());
  const physicalYarnIds = await getYarnIdsWithPhysicalStock();
  const yarnIds = [...new Set([...purchaseYarnIds, ...txnYarnIds, ...physicalYarnIds])];

  const catalogs = await YarnCatalog.find({ _id: { $in: yarnIds.map((id) => new mongoose.Types.ObjectId(id)) } })
    .select('yarnName hsnCode yarnType yarnSubtype countSize colorFamily pantonName gst')
    .lean();

  const catalogMap = new Map();
  catalogs.forEach((c) => catalogMap.set(c._id.toString(), c));

  const openingMap = await getOpeningWithPhysicalFallback(start, yarnIds, catalogMap);

  // Include yarns with physical stock but no PO/transactions in range
  const yarnIdsWithOpening = [...openingMap.keys()].filter((id) => openingMap.get(id) > 0);
  const missingIds = yarnIdsWithOpening.filter((id) => !purchaseYarnIds.has(id) && !txnYarnIds.has(id));
  if (missingIds.length) {
    yarnIds.push(...missingIds);
    const extraCatalogs = await YarnCatalog.find({ _id: { $in: missingIds.map((id) => new mongoose.Types.ObjectId(id)) } })
      .select('yarnName hsnCode yarnType yarnSubtype countSize colorFamily pantonName gst')
      .lean();
    extraCatalogs.forEach((c) => catalogMap.set(c._id.toString(), c));
  }

  const txnOnlyYarnIds = [...txnYarnIds].filter((id) => !purchaseYarnIds.has(id));
  const brandShadeMap = await getBrandAndShadeForYarns([...txnOnlyYarnIds, ...missingIds], catalogMap);

  const results = [];

  for (const row of purchaseRows) {
    const catalog = catalogMap.get(row.yarnId);
    const txn = txnMap.get(row.yarnId) || { store: 0, issued: 0, returned: 0 };
    const opening = openingMap.get(row.yarnId) ?? 0;

    const pur = row.pur;
    const purRet = row.purRet;
    const store = txn.store;
    const issued = txn.issued;
    const returned = txn.returned;
    const balance = opening + pur - purRet + store + returned - issued;

    const yarnType = catalog?.yarnType;
    const yarnSubtype = catalog?.yarnSubtype;
    const countSize = catalog?.countSize;
    const colorFamily = catalog?.colorFamily;

    results.push({
      store: 'yarn',
      hsnCode: catalog?.hsnCode ?? '',
      yarnName: catalog?.yarnName ?? row.yarnId,
      brand: row.supplierName,
      shadeNumber: row.shadeCode,
      yarnType: yarnType?.name ?? '',
      yarnSubtype: yarnSubtype?.subtype ?? '',
      count: countSize?.name ?? '',
      colorFamily: colorFamily?.name ?? '',
      pantoneColorName: (row.pantoneName || catalog?.pantonName) ?? '',
      opening: Math.round(opening * 1000) / 1000,
      pur: Math.round(pur * 1000) / 1000,
      purRet: Math.round(purRet * 1000) / 1000,
      yarnIssueToKnitting: Math.round(issued * 1000) / 1000,
      yarnReturnedFromKnitting: Math.round(returned * 1000) / 1000,
      balance: Math.round(balance * 1000) / 1000,
      rate: row.rate,
      unit: 'kg',
      gstPercent: (row.gstRate || catalog?.gst) ?? 0,
      amount: Math.round(row.amount * 100) / 100,
    });
  }

  // Include yarns with transactions but no PO in range
  for (const yarnId of txnYarnIds) {
    if (purchaseYarnIds.has(yarnId)) continue;

    const catalog = catalogMap.get(yarnId);
    const txn = txnMap.get(yarnId) || { store: 0, issued: 0, returned: 0 };
    const opening = openingMap.get(yarnId) ?? 0;
    const balance = opening + txn.store - 0 + txn.returned - txn.issued;
    const brandShade = brandShadeMap.get(yarnId) || { brand: '', shadeNumber: '', rate: 0, gstRate: 0, amount: 0 };

    results.push({
      store: 'yarn',
      hsnCode: catalog?.hsnCode ?? '',
      yarnName: catalog?.yarnName ?? yarnId,
      brand: brandShade.brand,
      shadeNumber: brandShade.shadeNumber,
      yarnType: catalog?.yarnType?.name ?? '',
      yarnSubtype: catalog?.yarnSubtype?.subtype ?? '',
      count: catalog?.countSize?.name ?? '',
      colorFamily: catalog?.colorFamily?.name ?? '',
      pantoneColorName: catalog?.pantonName ?? '',
      opening: Math.round(opening * 1000) / 1000,
      pur: 0,
      purRet: 0,
      yarnIssueToKnitting: Math.round(txn.issued * 1000) / 1000,
      yarnReturnedFromKnitting: Math.round(txn.returned * 1000) / 1000,
      balance: Math.round(balance * 1000) / 1000,
      rate: brandShade.rate ?? 0,
      unit: 'kg',
      gstPercent: (brandShade.gstRate ?? catalog?.gst) ?? 0,
      amount: Math.round((brandShade.amount ?? 0) * 100) / 100,
    });
  }

  // Include yarns with physical stock only (no PO, no transactions in range)
  for (const yarnId of missingIds) {
    const catalog = catalogMap.get(yarnId);
    const opening = openingMap.get(yarnId) ?? 0;
    const brandShade = brandShadeMap.get(yarnId) || { brand: '', shadeNumber: '', rate: 0, gstRate: 0, amount: 0 };

    results.push({
      store: 'yarn',
      hsnCode: catalog?.hsnCode ?? '',
      yarnName: catalog?.yarnName ?? yarnId,
      brand: brandShade.brand,
      shadeNumber: brandShade.shadeNumber,
      yarnType: catalog?.yarnType?.name ?? '',
      yarnSubtype: catalog?.yarnSubtype?.subtype ?? '',
      count: catalog?.countSize?.name ?? '',
      colorFamily: catalog?.colorFamily?.name ?? '',
      pantoneColorName: catalog?.pantonName ?? '',
      opening: Math.round(opening * 1000) / 1000,
      pur: 0,
      purRet: 0,
      yarnIssueToKnitting: 0,
      yarnReturnedFromKnitting: 0,
      balance: Math.round(opening * 1000) / 1000,
      rate: brandShade.rate ?? 0,
      unit: 'kg',
      gstPercent: (brandShade.gstRate ?? catalog?.gst) ?? 0,
      amount: Math.round((brandShade.amount ?? 0) * 100) / 100,
    });
  }

  const formatDate = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d);
  return {
    results,
    startDate: formatDate(start),
    endDate: formatDate(end),
  };
};
