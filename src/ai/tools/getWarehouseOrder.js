import { z } from 'zod';
import WarehouseOrder from '../../models/whms/warehouseOrder.model.js';
import { getWarehouseOrderById, queryWarehouseOrders } from '../../services/whms/warehouseOrder.service.js';
import { classifyOrderLookup, SUFFIX_CANDIDATE_LIMIT } from './getProductionOrder.js';
import { integerQty, warehouseFlowStageLabel, warehouseStatusLabel } from './warehouseOrderLabels.js';

export const GET_WAREHOUSE_ORDER = 'getWarehouseOrder';

export const NAV_PATH = 'Warehouse Management.Orders';

/** Same breaks as yarn and warehouse stock. Used only for client-name tokens. */
const TOKEN_SPLIT = /[\s\-/]+/;

/**
 * Dropped before a client-name match. Order numbers are matched before this runs.
 * @type {Set<string>}
 */
const CLIENT_STOPWORDS = new Set([
  'warehouse',
  'order',
  'orders',
  'status',
  'stage',
  'client',
  'for',
  'the',
  'of',
  'what',
  'is',
  'show',
  'me',
  'please',
  'ka',
  'ki',
  'ke',
  'hai',
  'hain',
  'kitna',
]);

/**
 * Case-insensitive exact match. Metacharacters are escaped.
 * @param {string} value
 * @returns {RegExp}
 */
function exactRegex(value) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Lowercase client phrase with stopwords removed.
 * @param {string} value
 * @returns {string}
 */
function orderClientKey(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token && !CLIENT_STOPWORDS.has(token))
    .join(' ');
}

/**
 * Client-name tokens after stopwords. Split on space, hyphen, and slash.
 * @param {string} value
 * @returns {string[]}
 */
function clientTokens(value) {
  return orderClientKey(value)
    .split(TOKEN_SPLIT)
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * True when every query token appears in the client name.
 * @param {string} query
 * @param {string} clientName
 * @returns {boolean}
 */
function clientNameMatches(query, clientName) {
  const needed = clientTokens(query);
  if (needed.length === 0) return false;
  const have = new Set(clientTokens(clientName));
  return needed.every((token) => have.has(token));
}

/**
 * Slim line. Quantity is an integer. The sum is computed by the caller.
 * @param {object[]|undefined} rows
 * @returns {{ styleCode: string, pack: string, quantity: number }[]}
 */
function presentLines(rows) {
  return (rows || []).map((row) => ({
    styleCode: row && row.styleCode ? String(row.styleCode) : '',
    pack: row && row.pack ? String(row.pack) : '',
    quantity: integerQty(row && row.quantity),
  }));
}

/**
 * One warehouse order. flowStatus is the stored value. The label is the UI map.
 * totalQty is the sum of single and multi line quantities.
 * @param {object} order
 * @returns {object}
 */
function presentOrder(order) {
  const singleRows = presentLines(order.styleCodeSinglePair);
  const multiRows = presentLines(order.styleCodeMultiPair);
  const totalQty = [...singleRows, ...multiRows].reduce((sum, row) => sum + row.quantity, 0);
  const createdAt = order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt || null;
  const flowStatus = order.flowStatus == null || String(order.flowStatus).trim() === '' ? null : String(order.flowStatus);
  return {
    orderNumber: order.orderNumber ? String(order.orderNumber) : '',
    addonOrderId: order.addonOrderId ? String(order.addonOrderId) : null,
    client: order.clientName ? String(order.clientName) : '',
    clientType: order.clientType ? String(order.clientType) : '',
    createdAt,
    status: order.status ? String(order.status) : '',
    statusLabel: warehouseStatusLabel(order.status),
    flowStatus,
    flowStageLabel: warehouseFlowStageLabel(flowStatus),
    totalQty,
    singleRows,
    multiRows,
  };
}

/**
 * flowStatus as stored. Null when the field is absent.
 * A hydrated doc applies the schema default, which is not a stored stage.
 * @param {import('mongoose').Types.ObjectId|string} id
 * @returns {Promise<string|null>}
 */
async function storedFlowStatus(id) {
  const raw = await WarehouseOrder.collection.findOne({ _id: id }, { projection: { flowStatus: 1 } });
  if (!raw || raw.flowStatus == null || String(raw.flowStatus).trim() === '') return null;
  return String(raw.flowStatus);
}

/**
 * Loads one order through the orders service. Null when the id is gone.
 * @param {import('mongoose').Types.ObjectId|string} id
 * @returns {Promise<object|null>}
 */
async function loadOrder(id) {
  const doc = await getWarehouseOrderById(id);
  if (!doc) return null;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  plain.flowStatus = await storedFlowStatus(doc._id); // eslint-disable-line no-underscore-dangle
  return presentOrder(plain);
}

/**
 * 2–10 names, or TOO_MANY above that.
 * @param {string[]} names
 * @returns {{ error: 'AMBIGUOUS', candidates: string[] } | { error: 'TOO_MANY', count: number }}
 */
function capNames(names) {
  const sorted = [...names].sort((left, right) => left.localeCompare(right));
  if (sorted.length > SUFFIX_CANDIDATE_LIMIT) return { error: 'TOO_MANY', count: sorted.length };
  return { error: 'AMBIGUOUS', candidates: sorted };
}

/**
 * One client name: the order itself. Several: the 10 most recent plus totalCount.
 * @param {string} clientName
 * @returns {Promise<object>}
 */
async function ordersForClient(clientName) {
  const page = await queryWarehouseOrders(
    { clientName: exactRegex(clientName) },
    { limit: 10, page: 1, sortBy: 'createdAt:desc', lean: true }
  );
  if (!page.totalResults || !page.results.length) return { error: 'NOT_FOUND' };
  const orders = page.results.map((row) => presentOrder(row));
  if (page.totalResults === 1) return orders[0];
  return {
    client: orders[0].client,
    orders,
    totalCount: page.totalResults,
    returnedCount: orders.length,
  };
}

/**
 * Exact client name, otherwise name tokens. Distinct names come from the order collection.
 * The rows themselves come from queryWarehouseOrders.
 * @param {string} raw
 * @returns {Promise<object>}
 */
async function matchClient(raw) {
  const key = orderClientKey(raw);
  if (!key) return { error: 'NOT_FOUND' };
  const names = (await WarehouseOrder.distinct('clientName'))
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  const exact = names.filter((name) => orderClientKey(name) === key);
  if (exact.length === 1) return ordersForClient(exact[0]);
  if (exact.length > 1) return capNames(exact);
  const matched = names.filter((name) => clientNameMatches(raw, name));
  if (matched.length === 1) return ordersForClient(matched[0]);
  if (matched.length > 1) return capNames(matched);
  return { error: 'NOT_FOUND' };
}

/**
 * Exact order number, else suffix digits, else addonOrderId, else client name.
 * @param {string} raw
 * @returns {Promise<object>}
 */
async function findWarehouseOrder(raw) {
  const exactPage = await queryWarehouseOrders(
    { orderNumber: exactRegex(raw) },
    { limit: 1, page: 1, lean: true }
  );
  if (exactPage.totalResults > 0 && exactPage.results[0]) {
    const order = await loadOrder(exactPage.results[0]._id); // eslint-disable-line no-underscore-dangle
    if (!order) return { error: 'NOT_FOUND' };
    return order;
  }

  const digits = raw.replace(/\D/g, '');
  if (digits) {
    const suffixPage = await queryWarehouseOrders(
      { orderNumber: { $regex: `${digits}$` } },
      {
        limit: SUFFIX_CANDIDATE_LIMIT + 1,
        page: 1,
        sortBy: 'orderNumber:asc',
        select: 'orderNumber',
        lean: true,
      }
    );
    const numbers = suffixPage.results.map((row) => row.orderNumber).filter(Boolean);
    const classified = classifyOrderLookup(raw, null, numbers);
    if (classified.error === 'AMBIGUOUS') return { error: 'AMBIGUOUS', candidates: classified.candidates };
    if (classified.orderNumber) {
      const row = suffixPage.results.find((item) => item.orderNumber === classified.orderNumber);
      const order = row ? await loadOrder(row._id) : null; // eslint-disable-line no-underscore-dangle
      if (!order) return { error: 'NOT_FOUND' };
      return classified.matchedFrom ? { matchedFrom: classified.matchedFrom, ...order } : order;
    }
  }

  const addonPage = await queryWarehouseOrders(
    { addonOrderId: exactRegex(raw) },
    {
      limit: SUFFIX_CANDIDATE_LIMIT + 1,
      page: 1,
      sortBy: 'orderNumber:asc',
      select: 'orderNumber',
      lean: true,
    }
  );
  if (addonPage.totalResults === 1 && addonPage.results[0]) {
    const order = await loadOrder(addonPage.results[0]._id); // eslint-disable-line no-underscore-dangle
    if (!order) return { error: 'NOT_FOUND' };
    return order;
  }
  if (addonPage.totalResults > 1) {
    return {
      error: 'AMBIGUOUS',
      candidates: addonPage.results
        .map((row) => row.orderNumber)
        .filter(Boolean)
        .slice(0, SUFFIX_CANDIDATE_LIMIT),
    };
  }

  return matchClient(raw);
}

/**
 * One warehouse order, a suffix ambiguity, or a client's most recent orders.
 * Does not derive flowStatus from the coarse status.
 * @param {{ query?: string }} input
 * @returns {Promise<object>}
 */
export async function runGetWarehouseOrder(input) {
  const raw = String(input?.query || '').trim();
  if (!raw) return { error: 'NOT_FOUND' };
  return findWarehouseOrder(raw);
}

/** Tool definition. Registered by `registerTools`. */
export const getWarehouseOrderTool = {
  name: GET_WAREHOUSE_ORDER,
  description:
    'Read warehouse orders (WO-). Not a production order (ORD-); that is getProductionOrder. Not warehouse stock; that is getWarehouseStock. Pass query as an order number (WO-2026-00064), trailing digits (64), an addon order id, or a client name. Match order is exact orderNumber, then a suffix on the digits (one match includes matchedFrom; several return error AMBIGUOUS and at most 10 order numbers), then exact addonOrderId (several is AMBIGUOUS), then client name. A client with one order returns that order. A client with more returns orders (the 10 most recent), totalCount, and returnedCount. No match returns error NOT_FOUND. Each order has orderNumber, addonOrderId, client, clientType, createdAt, status, statusLabel, flowStatus, flowStageLabel, totalQty, singleRows, and multiRows. flowStatus is the stored value. flowStageLabel is the UI label for that stored value. Do not derive a stage from status. totalQty is the sum of the line quantities. Quantities are integers. Stage answers use flowStageLabel.',
  type: 'READ',
  navPath: NAV_PATH,
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe('Warehouse order number, trailing digits, addon order id, or client name'),
  }),
  run: runGetWarehouseOrder,
};
