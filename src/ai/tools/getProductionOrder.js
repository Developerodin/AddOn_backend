import { z } from 'zod';
import Article from '../../models/production/article.model.js';
import ProductionOrder from '../../models/production/productionOrder.model.js';
import { deriveOrderStatus } from './deriveOrderStatus.js';
import { floorsPendingForArticle, PAIRS, roundPairs } from './floorPending.js';
import { summarizeOrder } from './orderStage.js';

export const GET_PRODUCTION_ORDER = 'getProductionOrder';

export const NAV_PATH = 'Production Planning.Production Orders';

/**
 * Loads articles in the order's own id list.
 * @param {import('mongoose').Types.ObjectId[]} ids
 * @returns {Promise<object[]>}
 */
async function loadArticles(ids) {
  if (!ids.length) return [];
  const rows = await Article.find({ _id: { $in: ids } }).lean();
  const byId = new Map(
    rows.map((row) => {
      // lean() documents expose the mongo id on _id, not the toJSON `id` virtual.
      const id = row._id; // eslint-disable-line no-underscore-dangle
      return [String(id), row];
    })
  );
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
}

/**
 * Rounds QC grade counts for the tool payload.
 * @param {{ m1Remaining: number, m2Remaining: number, m3Quantity: number, m4Quantity: number }} grades
 * @returns {{ m1Remaining: number, m2Remaining: number, m3Quantity: number, m4Quantity: number }}
 */
function presentGrades(grades) {
  return {
    m1Remaining: roundPairs(grades.m1Remaining),
    m2Remaining: roundPairs(grades.m2Remaining),
    m3Quantity: roundPairs(grades.m3Quantity),
    m4Quantity: roundPairs(grades.m4Quantity),
  };
}

/**
 * Per-article floors with quantities rounded after the raw pending is known.
 * @param {Record<string, { pending: number, unit: string, grades?: object }>} floors
 * @returns {Record<string, object>}
 */
function presentFloors(floors) {
  return Object.fromEntries(
    Object.entries(floors).map(([key, floor]) => {
      const presented = { pending: roundPairs(floor.pending), unit: PAIRS };
      if (floor.grades) presented.grades = presentGrades(floor.grades);
      return [key, presented];
    })
  );
}

/**
 * One article row for the tool payload.
 * @param {object} article
 * @returns {object}
 */
function presentArticle(article) {
  return {
    articleNumber: article.articleNumber,
    status: article.status,
    plannedQuantity: roundPairs(article.plannedQuantity),
    floorsPending: presentFloors(floorsPendingForArticle(article.floorQuantities)),
  };
}

/** How many order numbers to return when a suffix matches more than one order. */
export const SUFFIX_CANDIDATE_LIMIT = 10;

/**
 * Digits used for a suffix lookup. "123" and "ORD-123" both yield "123".
 * @param {string} orderNumber
 * @returns {string}
 */
function suffixDigits(orderNumber) {
  return orderNumber.replace(/\D/g, '');
}

/**
 * Exact orderNumber wins and does not set matchedFrom.
 * One suffix hit sets matchedFrom to the input. Several become AMBIGUOUS, capped at 10.
 * @param {string} input
 * @param {string|null} exactOrderNumber
 * @param {string[]} suffixOrderNumbers
 * @returns {{ orderNumber: string, matchedFrom?: string } | { error: 'NOT_FOUND' } | { error: 'AMBIGUOUS', candidates: string[] }}
 */
export function classifyOrderLookup(input, exactOrderNumber, suffixOrderNumbers) {
  if (exactOrderNumber) return { orderNumber: exactOrderNumber };
  if (suffixOrderNumbers.length === 1) {
    return { orderNumber: suffixOrderNumbers[0], matchedFrom: input };
  }
  if (suffixOrderNumbers.length > 1) {
    return {
      error: 'AMBIGUOUS',
      candidates: suffixOrderNumbers.slice(0, SUFFIX_CANDIDATE_LIMIT),
    };
  }
  return { error: 'NOT_FOUND' };
}

/**
 * Exact orderNumber, otherwise order numbers that end with the input's digits.
 * @param {string} orderNumber
 * @returns {Promise<{ order: object|null, matchedFrom?: string, ambiguous?: string[] }>}
 */
async function findOrder(orderNumber) {
  const exact = await ProductionOrder.findOne({ orderNumber }).lean();
  const digits = exact ? '' : suffixDigits(orderNumber);
  const suffixRows = digits
    ? await ProductionOrder.find({ orderNumber: { $regex: `${digits}$` } })
        .select('orderNumber')
        .sort({ orderNumber: 1 })
        .limit(SUFFIX_CANDIDATE_LIMIT + 1)
        .lean()
    : [];
  const classified = classifyOrderLookup(
    orderNumber,
    exact ? exact.orderNumber : null,
    suffixRows.map((row) => row.orderNumber)
  );
  if (classified.error === 'AMBIGUOUS') return { order: null, ambiguous: classified.candidates };
  if (classified.error === 'NOT_FOUND') return { order: null };
  if (exact && classified.orderNumber === exact.orderNumber) return { order: exact };
  const matched = await ProductionOrder.findOne({ orderNumber: classified.orderNumber }).lean();
  if (!matched) return { order: null };
  return { order: matched, matchedFrom: classified.matchedFrom };
}

/**
 * One production order: stored status, status derived from articles, floor pending in pairs.
 * An exact orderNumber is returned as-is. Digits, or any other miss, match the orderNumber suffix.
 * One suffix hit includes matchedFrom. Several return AMBIGUOUS. None returns NOT_FOUND.
 * @param {{ orderNumber?: string }} input
 * @returns {Promise<object>}
 */
export async function runGetProductionOrder(input) {
  const orderNumber = String(input?.orderNumber || '').trim();
  const resolved = await findOrder(orderNumber);
  if (resolved.ambiguous) return { error: 'AMBIGUOUS', candidates: resolved.ambiguous };
  if (!resolved.order) return { error: 'NOT_FOUND' };

  const { order } = resolved;
  const articles = await loadArticles(order.articles || []);
  const { orderSummary, orderTotals } = summarizeOrder(articles);
  return {
    ...(resolved.matchedFrom ? { matchedFrom: resolved.matchedFrom } : {}),
    orderNumber: order.orderNumber,
    priority: order.priority,
    derivedStatus: deriveOrderStatus(articles.map((article) => article.status)),
    storedStatus: order.status,
    unit: PAIRS,
    articleCount: articles.length,
    orderSummary,
    orderTotals,
    articles: articles.map(presentArticle),
  };
}

/** Tool definition. Registered by `registerTools`. */
export const getProductionOrderTool = {
  name: GET_PRODUCTION_ORDER,
  description:
    'Read one production order (ORD-). Does not answer yarn stock; that is getYarnLiveStock. Does not answer a warehouse order (WO-); that is getWarehouseOrder. Does not answer warehouse stock; that is getWarehouseStock. Accepts a full or partial production order number. You can answer about production orders: status, pairs pending on each floor, QC grades (M1, M2, M3, M4), order totals and per-article detail. A partial number (digits only, or any value that is not an exact orderNumber) matches orderNumbers that end with those digits. One match includes matchedFrom set to the input. Several matches return error AMBIGUOUS and candidates, at most 10 order numbers. No match returns error NOT_FOUND. Quantities are pairs, rounded to 2 decimals. orderSummary.inProduction is pairs still pending from knitting through final checking. orderSummary.inWarehouse is warehouse pending. orderSummary.readyToDispatch is dispatch pending. orderSummary.dispatched is dispatch.transferred. orderTotals maps each in-production floor to pending pairs and omits floors at 0. articles is the per-article breakdown. Pending pairs are received minus transferred. Checking, secondary checking, and final checking also include grade counts. plannedQuantity is not confirmed and must not be compared with floor counts. Status answers use derivedStatus. storedStatus is not the live status.',
  type: 'READ',
  navPath: NAV_PATH,
  inputSchema: z.object({
    orderNumber: z.string().min(1).describe('Order number or its trailing digits, for example 123 or ORD-000123'),
  }),
  run: runGetProductionOrder,
};
