import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { istMidnightUtc } from '../../utils/istPeriod.util.js';
import ArticleLog from '../../models/production/articleLog.model.js';
import M4Log from '../../models/production/m4Log.model.js';
import { Article, ProductionOrder } from '../../models/production/index.js';
import Machine from '../../models/machine.model.js';
import { LogAction, M4LogType, ProductionFloor } from '../../models/production/enums.js';
import {
  cachedRead,
  ProductionCacheResource,
  ProductionCacheTtl,
} from './productionCache.helper.js';
import {
  mergeKnittingReportBuckets,
  finalizeKnittingReportRows,
  computeKnittingReportColumnTotals,
  filterKnittingReportRows,
} from './knittingFloorReport.merge.js';

const KNITTING_REMARKS_REGEX = / on Knitting floor/i;
const MAX_LIMIT = 2000;
const DEFAULT_LIMIT = 500;
const MAX_SEARCH_LEN = 80;

/**
 * @param {string} value
 * @returns {string}
 */
const escapeRegexLiteral = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} [search]
 * @returns {string}
 */
export const normalizeKnittingReportSearch = (search) => {
  const term = String(search ?? '').trim();
  if (!term) return '';
  if (term.length > MAX_SEARCH_LEN) {
    throw new ApiError(httpStatus.BAD_REQUEST, `search must be at most ${MAX_SEARCH_LEN} characters`);
  }
  return term;
};

/**
 * Parses YYYY-MM-DD and returns IST inclusive/exclusive bounds.
 * @param {string} startDate
 * @param {string} endDate
 * @returns {{ rangeStart: Date, rangeEndExclusive: Date, startKey: string, endKey: string }}
 */
export const resolveKnittingReportIstRange = (startDate, endDate) => {
  const startKey = String(startDate ?? '').trim();
  const endKey = String(endDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startKey) || !/^\d{4}-\d{2}-\d{2}$/.test(endKey)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'startDate and endDate must be YYYY-MM-DD');
  }

  const [sy, sm, sd] = startKey.split('-').map((n) => Number(n));
  const [ey, em, ed] = endKey.split('-').map((n) => Number(n));

  const rangeStart = istMidnightUtc(sy, sm, sd);
  const endDay = new Date(Date.UTC(ey, em - 1, ed + 1));
  const rangeEndExclusive = istMidnightUtc(
    endDay.getUTCFullYear(),
    endDay.getUTCMonth() + 1,
    endDay.getUTCDate()
  );

  if (rangeEndExclusive <= rangeStart) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'endDate must be on or after startDate');
  }

  return { rangeStart, rangeEndExclusive, startKey, endKey };
};

/**
 * Resolves order/article/machine ids that match a search term for aggregate pre-filtering.
 * @param {string} search
 * @returns {Promise<{ empty: true } | { orderIds: string[], articleIds: string[], machineIds: string[], machineCodes: string[] }>}
 */
const resolveKnittingReportSearchScope = async (search) => {
  const term = normalizeKnittingReportSearch(search);
  if (!term) return null;

  const regex = { $regex: escapeRegexLiteral(term), $options: 'i' };
  const [orders, articles, machines] = await Promise.all([
    ProductionOrder.find({ orderNumber: regex }).select('_id').lean(),
    Article.find({ articleNumber: regex }).select('_id').lean(),
    Machine.find({ $or: [{ machineCode: regex }, { machineNumber: regex }] })
      .select('_id machineCode machineNumber')
      .lean(),
  ]);

  const orderIds = orders.map((o) => String(o._id));
  const articleIds = articles.map((a) => String(a._id));
  const machineIds = machines.map((m) => String(m._id));
  const machineCodes = [
    ...new Set(
      machines
        .flatMap((m) => [m.machineCode, m.machineNumber])
        .map((c) => String(c ?? '').trim())
        .filter(Boolean)
    ),
  ];

  if (!orderIds.length && !articleIds.length && !machineIds.length && !machineCodes.length) {
    return { empty: true };
  }

  return { orderIds, articleIds, machineIds, machineCodes };
};

/**
 * @param {{ orderIds?: string[], articleIds?: string[], machineIds?: string[], machineCodes?: string[] }} scope
 * @returns {object|null}
 */
const buildAggregateIdScope = (scope) => {
  if (!scope) return null;
  const or = [];
  if (scope.orderIds?.length) or.push({ orderId: { $in: scope.orderIds } });
  if (scope.articleIds?.length) or.push({ articleId: { $in: scope.articleIds } });
  if (scope.machineIds?.length) or.push({ machineId: { $in: scope.machineIds } });
  if (scope.machineCodes?.length) or.push({ machineCode: { $in: scope.machineCodes } });
  return or.length ? { $or: or } : null;
};

/**
 * @param {Date} rangeStart
 * @param {Date} rangeEndExclusive
 * @param {object|null} idScope
 * @returns {Promise<[Array, Array]>}
 */
const loadAggregates = async (rangeStart, rangeEndExclusive, idScope = null) => {
  const timeMatch = { $gte: rangeStart, $lt: rangeEndExclusive };
  const knitMatch = {
    action: LogAction.QUANTITY_UPDATED,
    timestamp: timeMatch,
    articleId: { $exists: true, $ne: null },
    remarks: KNITTING_REMARKS_REGEX,
    ...(idScope ? idScope : {}),
  };
  const m4Match = {
    type: M4LogType.ENTRY,
    sourceFloor: ProductionFloor.KNITTING,
    timestamp: timeMatch,
    ...(idScope ? idScope : {}),
  };

  const [knitAgg, m4Agg] = await Promise.all([
    ArticleLog.aggregate([
      { $match: knitMatch },
      {
        $group: {
          _id: {
            orderId: '$orderId',
            articleId: '$articleId',
            machineId: { $ifNull: ['$machineId', ''] },
          },
          knittingOutput: { $sum: '$quantity' },
        },
      },
    ]).allowDiskUse(true),
    M4Log.aggregate([
      { $match: m4Match },
      {
        $group: {
          _id: {
            orderId: '$orderId',
            articleId: '$articleId',
            machineId: { $ifNull: ['$machineId', ''] },
          },
          m4Qty: { $sum: '$quantity' },
          machineCode: { $max: '$machineCode' },
        },
      },
    ]).allowDiskUse(true),
  ]);

  return [knitAgg, m4Agg];
};

/**
 * Enriches bucket rows with article, order, and machine display fields.
 * @param {Map<string, object>} buckets
 * @returns {Promise<void>}
 */
const enrichBuckets = async (buckets) => {
  const articleIds = [...new Set([...buckets.values()].map((r) => r.articleId).filter(Boolean))];
  const orderIds = [...new Set([...buckets.values()].map((r) => r.orderId).filter(Boolean))];

  const [articles, orders] = await Promise.all([
    articleIds.length
      ? Article.find({ _id: { $in: articleIds } })
          .select('_id articleNumber plannedQuantity orderId machineId')
          .lean()
      : [],
    orderIds.length
      ? ProductionOrder.find({ _id: { $in: orderIds } }).select('_id orderNumber').lean()
      : [],
  ]);

  const articleById = new Map(articles.map((a) => [String(a._id), a]));
  const orderById = new Map(orders.map((o) => [String(o._id), o]));

  const machineIdsToResolve = new Set();
  for (const row of buckets.values()) {
    const article = articleById.get(row.articleId);
    const order = orderById.get(row.orderId);
    row.articleNumber = article?.articleNumber ?? '';
    row.plannedQuantity = Number(article?.plannedQuantity ?? 0);
    row.orderNumber = order?.orderNumber ?? '';

    if (!row.machineCode?.trim() && row.machineId) {
      machineIdsToResolve.add(row.machineId);
    }
    if (!row.machineId && article?.machineId) {
      machineIdsToResolve.add(String(article.machineId));
      row._fallbackMachineId = String(article.machineId);
    }
  }

  const machineCodeById = new Map();
  if (machineIdsToResolve.size > 0) {
    const ids = [...machineIdsToResolve];
    const machines = await Machine.find({ _id: { $in: ids } })
      .select('_id machineCode machineNumber model')
      .lean();
    for (const m of machines) {
      const id = String(m._id);
      machineCodeById.set(id, m.machineCode || m.machineNumber || '');
    }
  }

  for (const row of buckets.values()) {
    if (!row.machineCode?.trim() && row.machineId) {
      row.machineCode = machineCodeById.get(row.machineId) || '';
    }
    if (!row.machineCode?.trim() && row._fallbackMachineId) {
      row.machineCode = machineCodeById.get(row._fallbackMachineId) || '';
    }
    delete row._fallbackMachineId;
    if (!row.machineCode?.trim()) row.machineCode = '—';
  }
};

/**
 * Builds enriched, sorted rows for a date range (optional aggregate scope when searching).
 * @param {{ startDate: string, endDate: string, search?: string }} query
 * @returns {Promise<{ startKey: string, endKey: string, allRows: Array<object> }>}
 */
const loadKnittingFloorReportRows = async (query) => {
  const { rangeStart, rangeEndExclusive, startKey, endKey } = resolveKnittingReportIstRange(
    query.startDate,
    query.endDate
  );
  const search = normalizeKnittingReportSearch(query.search);
  const scope = search ? await resolveKnittingReportSearchScope(search) : null;

  if (scope?.empty) {
    return { startKey, endKey, allRows: [] };
  }

  const idScope = buildAggregateIdScope(scope);
  const [knitAgg, m4Agg] = await loadAggregates(rangeStart, rangeEndExclusive, idScope);
  const buckets = mergeKnittingReportBuckets(knitAgg, m4Agg);
  await enrichBuckets(buckets);

  let allRows = finalizeKnittingReportRows(buckets).map((r) => ({
    orderId: r.orderId,
    orderNumber: r.orderNumber ?? '',
    articleId: r.articleId,
    articleNumber: r.articleNumber ?? '',
    machineId: r.machineId || '',
    machineCode: r.machineCode ?? '—',
    plannedQuantity: r.plannedQuantity ?? 0,
    knittingOutput: r.knittingOutput ?? 0,
    m4Qty: r.m4Qty ?? 0,
  }));

  if (search) {
    allRows = filterKnittingReportRows(allRows, search);
  }

  return { startKey, endKey, allRows };
};

/**
 * @param {{ startKey: string, endKey: string, allRows: Array<object> }} payload
 * @param {{ page?: number, limit?: number }} paging
 * @returns {object}
 */
const formatKnittingFloorReportResponse = (payload, paging) => {
  const page = Math.max(1, Number(paging.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(paging.limit) || DEFAULT_LIMIT));
  const { startKey, endKey, allRows } = payload;

  const total = allRows.length;
  const totalPages = total === 0 ? 1 : Math.ceil(total / limit);
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * limit;
  const results = allRows.slice(startIdx, startIdx + limit);
  const columnTotals = computeKnittingReportColumnTotals(allRows);

  return {
    success: true,
    data: {
      results,
      total,
      page: safePage,
      limit,
      totalPages,
      startDate: startKey,
      endDate: endKey,
      columnTotals,
    },
  };
};

/**
 * @param {object} query
 * @returns {Promise<object>}
 */
export const getKnittingFloorReport = async (query = {}) => {
  const search = normalizeKnittingReportSearch(query.search);
  const { startKey, endKey } = resolveKnittingReportIstRange(query.startDate, query.endDate);
  const page = query.page;
  const limit = query.limit;

  const cacheInput = search
    ? { startDate: startKey, endDate: endKey, search }
    : { startDate: startKey, endDate: endKey };

  const operation = search ? 'getKnittingFloorReport' : 'getKnittingFloorReportBase';

  const payload = await cachedRead({
    resource: ProductionCacheResource.REPORTS,
    operation,
    input: cacheInput,
    ttlSeconds: ProductionCacheTtl.REPORT,
    loader: () =>
      loadKnittingFloorReportRows({
        startDate: startKey,
        endDate: endKey,
        search: search || undefined,
      }),
  });

  return formatKnittingFloorReportResponse(payload, { page, limit });
};

/**
 * Uncached loader for tests and diagnostics.
 * @param {{ startDate: string, endDate: string, page?: number, limit?: number, search?: string }} query
 * @returns {Promise<object>}
 */
export const loadKnittingFloorReport = async (query) => {
  const payload = await loadKnittingFloorReportRows(query);
  return formatKnittingFloorReportResponse(payload, query);
};