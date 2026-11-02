import VendorProductionFlow from '../../models/vendorManagement/vendorProductionFlow.model.js';
import VendorDispatchStockTransferNote, {
  VendorDispatchStnStatus,
} from '../../models/vendorManagement/vendorDispatchStockTransferNote.model.js';
import { getPendingDispatchTransferredData } from '../../utils/dispatchWarehousePending.util.js';
import { filterVendorWarehouseHandoffReceivedData } from '../../utils/vendorDispatchWarehousePending.util.js';
import { brandKey } from '../../utils/brandQuantity.util.js';

const PAGE_LIMIT = 20;

/**
 * Start of a calendar day in the server timezone.
 * @param {string|Date} value
 * @returns {Date}
 */
const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

/**
 * End of a calendar day in the server timezone.
 * @param {string|Date} value
 * @returns {Date}
 */
const endOfDay = (value) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

/**
 * Date window for the reprint list. Missing dates default to today so the query never scans all history.
 * @param {Object} [filter]
 * @param {string|Date} [filter.startDate]
 * @param {string|Date} [filter.endDate]
 * @returns {{ start: Date, end: Date }}
 */
const resolveAlreadyPrintedRange = (filter = {}) => {
  const today = new Date();
  const hasStart = Boolean(filter.startDate);
  const hasEnd = Boolean(filter.endDate);
  if (!hasStart && !hasEnd) return { start: startOfDay(today), end: endOfDay(today) };
  if (hasStart && !hasEnd) return { start: startOfDay(filter.startDate), end: endOfDay(filter.startDate) };
  if (!hasStart && hasEnd) return { start: startOfDay(filter.endDate), end: endOfDay(filter.endDate) };
  return { start: startOfDay(filter.startDate), end: endOfDay(filter.endDate) };
};

/**
 * Active notes inside the date window, optionally matched by serial, VPO, or article.
 * @param {Object} [filter]
 * @returns {Object}
 */
const buildAlreadyPrintedFilter = (filter = {}) => {
  const { start, end } = resolveAlreadyPrintedRange(filter);
  const mongoFilter = {
    status: VendorDispatchStnStatus.ACTIVE,
    stnDate: { $gte: start, $lte: end },
  };
  const term = String(filter.search ?? '').trim();
  if (!term) return mongoFilter;

  const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  mongoFilter.$or = [
    { stnSerial: pattern },
    { 'lines.articleNumber': pattern },
    { 'lines.articleName': pattern },
    { 'lines.brand': pattern },
    { 'lines.vpoNumber': pattern },
  ];
  return mongoFilter;
};

/**
 * Warehouse-pending qty by vendor flow and brand for the notes on this page only.
 * @param {string[]} flowIds
 * @returns {Promise<Map<string, Map<string, number>>>}
 */
const loadWarehousePendingByFlowBrand = async (flowIds) => {
  const pendingByFlow = new Map();
  if (!flowIds.length) return pendingByFlow;

  const flows = await VendorProductionFlow.find({ _id: { $in: flowIds } })
    .select('floorQuantities.dispatch.transferredData floorQuantities.dispatch.receivedData')
    .lean();

  for (const flow of flows) {
    const dispatch = flow.floorQuantities?.dispatch || {};
    const handoff = filterVendorWarehouseHandoffReceivedData(dispatch.receivedData);
    const pendingRows = getPendingDispatchTransferredData(dispatch.transferredData, handoff);
    const byBrand = new Map();
    for (const row of pendingRows) {
      const key = brandKey(row.brand);
      if (!key) continue;
      byBrand.set(key, (byBrand.get(key) || 0) + Number(row.transferred || 0));
    }
    pendingByFlow.set(String(flow._id), byBrand);
  }

  return pendingByFlow;
};

/**
 * Drops lines warehouse has already accepted. Newest note on the page consumes pending first.
 * @param {Array<Object>} notes
 * @param {Map<string, Map<string, number>>} pendingByFlow
 * @returns {Array<Object>}
 */
const keepPendingNoteLines = (notes, pendingByFlow) => {
  const results = [];
  for (const note of notes) {
    const lines = [];
    for (const line of note.lines || []) {
      const flowId = String(line.vendorProductionFlowId || '');
      const brand = String(line.brand || line.sapArticleNo || '').trim();
      const key = brandKey(brand === '—' ? '' : brand);
      const brandMap = pendingByFlow.get(flowId);
      const remaining = brandMap?.get(key) || 0;
      const noteQty = Number(line.qtyInPairs || 0);
      if (!key || remaining <= 0 || noteQty <= 0) continue;

      const qty = Math.min(noteQty, remaining);
      brandMap.set(key, remaining - qty);
      lines.push({
        vpoNumber: String(line.vpoNumber || '').trim(),
        articleNumber: String(line.articleNumber || '').trim() || '—',
        sapArticleNo: brand || '—',
        articleName: line.articleName || '—',
        brand: brand || '—',
        qtyInPairs: qty,
      });
    }
    if (!lines.length) continue;
    results.push({
      transferNoteId: String(note._id),
      stnSerial: String(note.stnSerial || ''),
      stnDate: note.stnDate,
      lines,
    });
  }
  return results;
};

/**
 * One page of already-printed vendor notes that still have dispatch qty waiting on warehouse inward.
 * @param {Object} [filter]
 * @param {Object} [options]
 * @returns {Promise<{ results: Array<Object>, page: number, limit: number, totalResults: number, totalPages: number }>}
 */
export const queryAlreadyPrintedVendorNotes = async (filter = {}, options = {}) => {
  const limit = Math.min(PAGE_LIMIT, Math.max(1, Number(options.limit) || PAGE_LIMIT));
  const page = Math.max(1, Number(options.page) || 1);
  const pageResult = await VendorDispatchStockTransferNote.paginate(buildAlreadyPrintedFilter(filter), {
    sortBy: 'stnDate:desc,createdAt:desc',
    limit,
    page,
    select: 'stnSerial stnDate lines',
    lean: true,
  });

  const flowIds = [
    ...new Set(
      (pageResult.results || [])
        .flatMap((note) => (note.lines || []).map((line) => String(line.vendorProductionFlowId || '')))
        .filter(Boolean)
    ),
  ];
  const pendingByFlow = await loadWarehousePendingByFlowBrand(flowIds);

  return {
    results: keepPendingNoteLines(pageResult.results || [], pendingByFlow),
    page: pageResult.page,
    limit: pageResult.limit,
    totalResults: pageResult.totalResults,
    totalPages: pageResult.totalPages,
  };
};
