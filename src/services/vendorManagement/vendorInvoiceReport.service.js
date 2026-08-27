import VendorPurchaseOrder from '../../models/vendorManagement/vendorPurchaseOrder.model.js';
import VendorProductionFlow from '../../models/vendorManagement/vendorProductionFlow.model.js';
import VendorDispatchStockTransferNote, {
  VendorDispatchStnStatus,
} from '../../models/vendorManagement/vendorDispatchStockTransferNote.model.js';
import { computeM4Snapshot } from './vendorM4Management.service.js';
import {
  buildPoMongoFilter,
  firstPackDispatchDate,
  flowLotKey,
  idStr,
  lotInvoiceQty,
  lotMatchesSearch,
  poMatchesSearchWithoutLot,
  scVm4Qty,
  stnLineKey,
  toNum,
} from './vendorInvoiceReport.helpers.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 10000;

/**
 * Index production flows by PO id + lot/invoice referenceCode.
 * @param {Array<Object>} flows
 * @returns {Map<string, Array<Object>>}
 */
const indexFlowsByLot = (flows) => {
  const map = new Map();
  for (const flow of flows || []) {
    const key = flowLotKey(idStr(flow.vendorPurchaseOrder), flow.referenceCode);
    const list = map.get(key) || [];
    list.push(flow);
    map.set(key, list);
  }
  return map;
};

/**
 * Sum active STN line qty by vpoNumber + invoiceNumber.
 * @param {Array<Object>} stns
 * @returns {Map<string, number>}
 */
const indexStnQty = (stns) => {
  const map = new Map();
  for (const note of stns || []) {
    for (const line of note.lines || []) {
      const key = stnLineKey(line.vpoNumber, line.invoiceNumber);
      map.set(key, (map.get(key) || 0) + toNum(line.qtyInPairs));
    }
  }
  return map;
};

/**
 * Sum secondary-checking M1/M2/M3/VM4 and final-checking M4 on-hand for one lot.
 * @param {Array<Object>} lotFlows
 * @returns {{ m1: number, m2: number, m3: number, vm4: number, m4: number }}
 */
const sumQcQtyFromFlows = (lotFlows) => {
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  let vm4 = 0;
  let m4 = 0;
  for (const flow of lotFlows) {
    const sc = flow.floorQuantities?.secondaryChecking || {};
    m1 += toNum(sc.m1Quantity);
    m2 += toNum(sc.m2Quantity);
    m3 += toNum(sc.m3Quantity);
    vm4 += scVm4Qty(sc);
    m4 += toNum(computeM4Snapshot(flow).onHand);
  }
  return { m1, m2, m3, vm4, m4 };
};

/**
 * Build one report row for a PO lot, joining STN / SC qty / FC M4.
 * @param {Object} po
 * @param {Object} lot
 * @param {Array<Object>} lotFlows
 * @param {Map<string, number>} stnQtyMap
 * @returns {Object}
 */
const buildReportRow = (po, lot, lotFlows, stnQtyMap) => {
  const { m1, m2, m3, vm4, m4 } = sumQcQtyFromFlows(lotFlows);
  const invoiceQty = lotInvoiceQty(lot);
  const stnQty = toNum(stnQtyMap.get(stnLineKey(po.vpoNumber, lot.lotNumber)));
  const shortExc = invoiceQty - stnQty;
  const invDate = po.goodsReceivedDate || firstPackDispatchDate(po);

  return {
    vendorName: po.vendorName || '',
    poNumber: po.vpoNumber || '',
    poDate: po.createDate || null,
    invoiceNo: lot.lotNumber || '',
    invDate: invDate || null,
    recdDt: po.goodsReceivedDate || null,
    invoiceValue: toNum(po.total),
    noOfBox: lot.numberOfBoxes == null ? null : toNum(lot.numberOfBoxes),
    invoiceQty,
    stnQty,
    m1,
    m2,
    m3,
    vm4,
    m4,
    shortExc: shortExc === 0 ? null : shortExc,
    pendingInward: invoiceQty - (stnQty + m4 + vm4),
  };
};

/**
 * Paginated vendor invoice report: one row per received lot/invoice.
 * @param {{ search?: string, from?: Date|string, to?: Date|string }} filter
 * @param {{ page?: number|string, limit?: number|string }} options
 * @returns {Promise<{ results: Array<Object>, page: number, limit: number, totalPages: number, totalResults: number }>}
 */
export const queryVendorInvoiceReport = async (filter = {}, options = {}) => {
  const page = Math.max(1, parseInt(options.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(options.limit, 10) || DEFAULT_LIMIT));

  const pos = await VendorPurchaseOrder.find(buildPoMongoFilter(filter))
    .select('vpoNumber vendorName createDate goodsReceivedDate total receivedLotDetails packListDetails')
    .sort({ createDate: -1 })
    .lean();

  if (!pos.length) {
    return { results: [], page, limit, totalPages: 1, totalResults: 0 };
  }

  const poIds = pos.map((po) => po._id);
  const vpoNumbers = pos.map((po) => po.vpoNumber).filter(Boolean);

  const [flows, stns] = await Promise.all([
    VendorProductionFlow.find({ vendorPurchaseOrder: { $in: poIds } })
      .select('vendorPurchaseOrder referenceCode floorQuantities')
      .lean(),
    vpoNumbers.length
      ? VendorDispatchStockTransferNote.find({
          status: VendorDispatchStnStatus.ACTIVE,
          'lines.vpoNumber': { $in: vpoNumbers },
        })
          .select('lines')
          .lean()
      : Promise.resolve([]),
  ]);

  const flowsByLot = indexFlowsByLot(flows);
  const stnQtyMap = indexStnQty(stns);
  const searchLower = String(filter.search || '').trim().toLowerCase();

  const rows = [];
  for (const po of pos) {
    const poId = idStr(po._id);
    const poMatches = poMatchesSearchWithoutLot(po, searchLower);
    for (const lot of po.receivedLotDetails || []) {
      if (searchLower && !poMatches && !lotMatchesSearch(lot, searchLower)) continue;
      const lotFlows = flowsByLot.get(flowLotKey(poId, lot.lotNumber)) || [];
      rows.push(buildReportRow(po, lot, lotFlows, stnQtyMap));
    }
  }

  const totalResults = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / limit) || 1);
  const start = (page - 1) * limit;

  return {
    results: rows.slice(start, start + limit),
    page,
    limit,
    totalPages,
    totalResults,
  };
};
