import mongoose from 'mongoose';
import {
  YarnPurchaseOrder,
  YarnDailyClosingSnapshot,
  YarnTransaction,
  YarnCatalog,
} from '../../models/index.js';

const toNum = (v) => Number(v ?? 0);

/**
 * Parse date string as local calendar day (avoids UTC shift). Same rules as yarnReport.service.
 * @param {string|Date} dateInput
 * @returns {Date}
 */
export function parseLocalDateForReport(dateInput) {
  if (!dateInput) return new Date(NaN);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateInput).trim())) {
    const [y, m, d] = String(dateInput).trim().split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  if (dateInput instanceof Date && !Number.isNaN(dateInput.getTime())) {
    return new Date(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate());
  }
  const str = String(dateInput);
  const datePart = str.includes('T') ? str.split('T')[0] : str.split(' ')[0];
  const parts = datePart.split(/[-/]/).map(Number);
  if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) return new Date(NaN);
  const [y, m, d] = parts;
  return new Date(y, m - 1, d);
}

/**
 * @param {Date} d
 * @returns {string} YYYY-MM-DD
 */
const formatYmd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Mongo match for POs in analytics range by created vs receipt activity (mirrors yarnReport PUR window for `received`).
 * @param {Date} start
 * @param {Date} end
 * @param {'created'|'received'} dateMode
 * @returns {object}
 */
const buildDateModeMatch = (start, end, dateMode) => {
  if (dateMode === 'created') {
    return { createDate: { $gte: start, $lte: end } };
  }
  return {
    $or: [
      { goodsReceivedDate: { $gte: start, $lte: end } },
      { currentStatus: 'po_rejected', lastUpdateDate: { $gte: start, $lte: end } },
      { receivedLotDetails: { $elemMatch: { status: 'lot_rejected' } }, lastUpdateDate: { $gte: start, $lte: end } },
    ],
  };
};

/**
 * Line-level receipt rollups for one PO item.
 * @param {object} po
 * @param {string} poItemIdStr
 * @param {object} ctx
 * @param {Date} ctx.start
 * @param {Date} ctx.end
 * @param {'created'|'received'} ctx.dateMode
 * @returns {{ accepted: number, pending: number, qcPending: number, rejected: number }}
 */
const lineReceiptsByLotStatus = (po, poItemIdStr, { start, end, dateMode }) => {
  let accepted = 0;
  let pending = 0;
  let qcPending = 0;
  let rejected = 0;

  const poInRange =
    po.goodsReceivedDate && po.goodsReceivedDate >= start && po.goodsReceivedDate <= end;
  const rejectionInRange =
    po.lastUpdateDate && po.lastUpdateDate >= start && po.lastUpdateDate <= end;

  for (const lot of po.receivedLotDetails || []) {
    for (const rec of lot.poItems || []) {
      const linkId = rec.poItem?.toString?.() ?? String(rec.poItem ?? '');
      if (linkId !== poItemIdStr) continue;
      const qty = toNum(rec.receivedQuantity);
      if (lot.status === 'lot_accepted') {
        if (dateMode === 'created' || poInRange) accepted += qty;
      } else if (lot.status === 'lot_rejected') {
        if (dateMode === 'received' && rejectionInRange) rejected += qty;
        if (dateMode === 'created') rejected += qty;
      } else if (lot.status === 'lot_pending') {
        pending += qty;
      } else if (lot.status === 'lot_qc_pending') {
        qcPending += qty;
      }
    }
  }

  return { accepted, pending, qcPending, rejected };
};

/**
 * Aggregate metrics for one PO (optionally only lines matching yarnCatalogId).
 * @param {object} po Mongoose lean doc
 * @param {{ start: Date, end: Date, dateMode: 'created'|'received', yarnCatalogId?: string|null }} ctx
 */
const summarizeOnePo = (po, ctx) => {
  const { start, end, dateMode, yarnCatalogId } = ctx;

  let orderedKg = 0;
  let receivedAcceptedKg = 0;
  let receivedPendingKg = 0;
  let receivedQcPendingKg = 0;
  let receivedRejectedKg = 0;
  let outstandingKg = 0;
  const yarnIdsOnPo = new Set();

  const items = po.poItems || [];
  for (const item of items) {
    const yid = item.yarnCatalogId?.toString?.() ?? '';
    if (yarnCatalogId && yid !== yarnCatalogId) continue;

    const itemIdStr = item._id?.toString?.() ?? '';
    const ord = toNum(item.quantity);
    orderedKg += ord;
    if (yid) yarnIdsOnPo.add(yid);

    const line = lineReceiptsByLotStatus(po, itemIdStr, { start, end, dateMode });
    receivedAcceptedKg += line.accepted;
    receivedPendingKg += line.pending;
    receivedQcPendingKg += line.qcPending;
    receivedRejectedKg += line.rejected;

    const lineOutstanding = Math.max(0, ord - line.accepted);
    outstandingKg += lineOutstanding;
  }

  const lots = po.receivedLotDetails || [];
  const lotCount = lots.length;
  const lotsByStatus = { lot_pending: 0, lot_qc_pending: 0, lot_rejected: 0, lot_accepted: 0 };
  for (const lot of lots) {
    if (lotsByStatus[lot.status] !== undefined) lotsByStatus[lot.status] += 1;
  }

  return {
    orderedKg,
    receivedAcceptedKg,
    receivedPendingKg,
    receivedQcPendingKg,
    receivedRejectedKg,
    outstandingKg,
    lotCount,
    lotsByStatus,
    yarnCatalogIds: [...yarnIdsOnPo],
  };
};

/**
 * Build Mongo filter for PO analytics queries.
 * @param {object} params
 * @returns {{ match: object, start: Date, end: Date, yarnCatalogId: string|null }}
 */
const buildAnalyticsContext = (params) => {
  const {
    startDate,
    endDate,
    dateMode,
    supplierId,
    yarnCatalogId,
    statuses,
    includeDraft,
  } = params;

  const start = parseLocalDateForReport(startDate);
  const end = parseLocalDateForReport(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid start_date or end_date. Use YYYY-MM-DD');
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  const clauses = [buildDateModeMatch(start, end, dateMode)];

  if (!includeDraft) {
    clauses.push({ currentStatus: { $ne: 'draft' } });
  }
  if (supplierId) {
    clauses.push({ supplier: new mongoose.Types.ObjectId(supplierId) });
  }
  if (yarnCatalogId) {
    clauses.push({ 'poItems.yarnCatalogId': new mongoose.Types.ObjectId(yarnCatalogId) });
  }
  if (Array.isArray(statuses) && statuses.length > 0) {
    clauses.push({ currentStatus: { $in: statuses } });
  }

  return {
    match: clauses.length === 1 ? clauses[0] : { $and: clauses },
    start,
    end,
    yarnCatalogId: yarnCatalogId ?? null,
  };
};

/**
 * GET /yarn-report/po-analytics — aggregated cards + chart series.
 * @param {object} params
 * @param {string} params.startDate
 * @param {string} params.endDate
 * @param {'created'|'received'} params.dateMode
 * @param {string} [params.supplierId]
 * @param {string} [params.yarnCatalogId]
 * @param {string[]} [params.statuses]
 * @param {boolean} [params.includeDraft]
 * @returns {Promise<object>}
 */
export const getPoAnalytics = async (params) => {
  const ctx = buildAnalyticsContext(params);
  const { match, start, end, yarnCatalogId } = ctx;

  const pos = await YarnPurchaseOrder.find(match)
    .select(
      'poNumber supplier supplierName createDate goodsReceivedDate lastUpdateDate currentStatus poItems receivedLotDetails'
    )
    .lean();

  const supplierMap = new Map();
  const statusMap = new Map();
  const yarnKgMap = new Map();

  let totalOrderedKg = 0;
  let totalReceivedAcceptedKg = 0;
  let totalOutstandingKg = 0;
  let totalRejectedKg = 0;
  let poCount = 0;
  let draftCount = 0;
  let qcPendingPoCount = 0;

  const lotsSummary = {
    totalLots: 0,
    lot_pending: 0,
    lot_qc_pending: 0,
    lot_rejected: 0,
    lot_accepted: 0,
  };

  const summCtx = { start, end, dateMode: params.dateMode, yarnCatalogId };

  for (const po of pos) {
    poCount += 1;
    if (po.currentStatus === 'draft') draftCount += 1;
    if (po.currentStatus === 'qc_pending') qcPendingPoCount += 1;

    const m = summarizeOnePo(po, summCtx);
    totalOrderedKg += m.orderedKg;
    totalReceivedAcceptedKg += m.receivedAcceptedKg;
    totalOutstandingKg += m.outstandingKg;
    totalRejectedKg += m.receivedRejectedKg;

    lotsSummary.totalLots += m.lotCount;
    lotsSummary.lot_pending += m.lotsByStatus.lot_pending;
    lotsSummary.lot_qc_pending += m.lotsByStatus.lot_qc_pending;
    lotsSummary.lot_rejected += m.lotsByStatus.lot_rejected;
    lotsSummary.lot_accepted += m.lotsByStatus.lot_accepted;

    const supId = po.supplier?.toString?.() ?? '';
    const supName = (po.supplierName || '').trim() || 'Unknown';
    if (!supplierMap.has(supId)) {
      supplierMap.set(supId, {
        supplierId: supId || null,
        supplierName: supName,
        poCount: 0,
        orderedKg: 0,
        receivedAcceptedKg: 0,
        outstandingKg: 0,
      });
    }
    const srow = supplierMap.get(supId);
    srow.poCount += 1;
    srow.orderedKg += m.orderedKg;
    srow.receivedAcceptedKg += m.receivedAcceptedKg;
    srow.outstandingKg += m.outstandingKg;

    const st = po.currentStatus || 'unknown';
    statusMap.set(st, (statusMap.get(st) || 0) + 1);

    for (const yid of m.yarnCatalogIds) {
      yarnKgMap.set(yid, (yarnKgMap.get(yid) || 0) + m.orderedKg);
    }
  }

  const yarnIds = [...yarnKgMap.keys()].filter(Boolean);
  const yarnMeta =
    yarnIds.length > 0
      ? await YarnCatalog.find({ _id: { $in: yarnIds.map((id) => new mongoose.Types.ObjectId(id)) } })
          .select('yarnName')
          .lean()
      : [];

  const idToName = new Map(yarnMeta.map((y) => [y._id.toString(), y.yarnName || '']));

  const byYarn = [...yarnKgMap.entries()]
    .map(([yarnCatalogIdKey, orderedKg]) => ({
      yarnCatalogId: yarnCatalogIdKey,
      yarnName: idToName.get(yarnCatalogIdKey) || yarnCatalogIdKey,
      orderedKg,
    }))
    .sort((a, b) => b.orderedKg - a.orderedKg)
    .slice(0, 25);

  const round3 = (n) => Math.round(toNum(n) * 1000) / 1000;

  return {
    startDate: formatYmd(start),
    endDate: formatYmd(end),
    dateMode: params.dateMode,
    cards: {
      poCount,
      draftCount,
      qcPendingPoCount,
      orderedKg: round3(totalOrderedKg),
      receivedAcceptedKg: round3(totalReceivedAcceptedKg),
      outstandingKg: round3(totalOutstandingKg),
      rejectedKg: round3(totalRejectedKg),
    },
    bySupplier: [...supplierMap.values()].map((r) => ({
      ...r,
      orderedKg: round3(r.orderedKg),
      receivedAcceptedKg: round3(r.receivedAcceptedKg),
      outstandingKg: round3(r.outstandingKg),
    })),
    byStatus: [...statusMap.entries()].map(([status, count]) => ({ status, count })),
    byYarn: byYarn.map((r) => ({ ...r, orderedKg: round3(r.orderedKg) })),
    lotsSummary,
  };
};

/**
 * Paginated PO rows for drill-down.
 * @param {object} params — same as getPoAnalytics plus page, limit, groupBy, groupId
 */
export const getPoAnalyticsLines = async (params) => {
  const ctx = buildAnalyticsContext(params);
  const { match, start, end, yarnCatalogId } = ctx;
  const page = Math.max(1, toNum(params.page) || 1);
  const limit = Math.min(100, Math.max(1, toNum(params.limit) || 25));
  const skip = (page - 1) * limit;
  const { groupBy, groupId } = params;

  let extra = {};
  if (groupBy === 'supplier' && groupId) {
    extra = { supplier: new mongoose.Types.ObjectId(groupId) };
  } else if (groupBy === 'status' && groupId) {
    extra = { currentStatus: groupId };
  } else if (groupBy === 'yarn' && groupId) {
    extra = { 'poItems.yarnCatalogId': new mongoose.Types.ObjectId(groupId) };
  }

  const finalMatch =
    Object.keys(extra).length === 0 ? match : { $and: [match, extra] };

  const totalResults = await YarnPurchaseOrder.countDocuments(finalMatch);

  const pos = await YarnPurchaseOrder.find(finalMatch)
    .select(
      'poNumber supplier supplierName createDate goodsReceivedDate lastUpdateDate currentStatus poItems receivedLotDetails'
    )
    .sort({ createDate: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const summCtx = { start, end, dateMode: params.dateMode, yarnCatalogId };

  const rows = pos.map((po) => {
    const m = summarizeOnePo(po, summCtx);
    const round3 = (n) => Math.round(toNum(n) * 1000) / 1000;
    return {
      purchaseOrderId: po._id.toString(),
      poNumber: po.poNumber,
      supplierName: (po.supplierName || '').trim(),
      supplierId: po.supplier?.toString?.() ?? null,
      currentStatus: po.currentStatus,
      createDate: po.createDate,
      goodsReceivedDate: po.goodsReceivedDate ?? null,
      lastUpdateDate: po.lastUpdateDate ?? null,
      orderedKg: round3(m.orderedKg),
      receivedAcceptedKg: round3(m.receivedAcceptedKg),
      outstandingKg: round3(m.outstandingKg),
      lotCount: m.lotCount,
    };
  });

  return {
    results: rows,
    page,
    limit,
    totalResults,
    totalPages: Math.max(1, Math.ceil(totalResults / limit)),
  };
};

/**
 * Daily closing kg for one yarn across snapshot keys.
 * @param {{ yarnCatalogId: string, startDate: string, endDate: string }} params
 */
export const getYarnClosingTrend = async (params) => {
  const { yarnCatalogId, startDate, endDate } = params;
  const start = parseLocalDateForReport(startDate);
  const end = parseLocalDateForReport(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid start_date or end_date. Use YYYY-MM-DD');
  }

  const startKey = formatYmd(start);
  const endKey = formatYmd(end);

  const rows = await YarnDailyClosingSnapshot.find({
    yarnCatalogId: new mongoose.Types.ObjectId(yarnCatalogId),
    snapshotDate: { $gte: startKey, $lte: endKey },
  })
    .select('snapshotDate closingKg')
    .sort({ snapshotDate: 1 })
    .lean();

  return {
    yarnCatalogId,
    startDate: startKey,
    endDate: endKey,
    series: rows.map((r) => ({
      date: r.snapshotDate,
      closingKg: Math.round(toNum(r.closingKg) * 1000) / 1000,
    })),
  };
};

/**
 * YarnTransaction totals by type in range.
 * @param {{ startDate: string, endDate: string, yarnCatalogId?: string }} params
 */
export const getTransactionAnalytics = async (params) => {
  const start = parseLocalDateForReport(params.startDate);
  const end = parseLocalDateForReport(params.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid start_date or end_date. Use YYYY-MM-DD');
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  const match = {
    transactionDate: { $gte: start, $lte: end },
  };
  if (params.yarnCatalogId) {
    match.yarnCatalogId = new mongoose.Types.ObjectId(params.yarnCatalogId);
  }

  const agg = await YarnTransaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$transactionType',
        kg: { $sum: { $ifNull: ['$transactionNetWeight', 0] } },
        txCount: { $sum: 1 },
      },
    },
  ]);

  const round3 = (n) => Math.round(toNum(n) * 1000) / 1000;

  return {
    startDate: formatYmd(start),
    endDate: formatYmd(end),
    byType: agg.map((r) => ({
      transactionType: r._id,
      kg: round3(r.kg),
      count: r.txCount,
    })),
  };
};
