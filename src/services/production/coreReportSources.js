import StyleCode from '../../models/styleCode.model.js';
import WarehouseInventory from '../../models/whms/warehouseInventory.model.js';
import InwardReceive, {
  InwardReceiveSource,
  InwardReceiveStatus,
} from '../../models/whms/inwardReceive.model.js';
import VendorPurchaseOrder from '../../models/vendorManagement/vendorPurchaseOrder.model.js';
import { Article, ProductionOrder } from '../../models/production/index.js';
import { OrderStatus } from '../../models/production/enums.js';
import {
  addArticleToOrderSummaryMetrics,
  createEmptyOrderSummaryMetrics,
  finalizeOrderSummaryMetrics,
} from './orderSummaryReport.service.js';
import {
  collectListedArticleIds,
  indexQueueByArticle,
  KNIT_PENDING_ARTICLE_SELECT,
  loadQueueAssignments,
} from './knittingPendingBuckets.service.js';
import { resolveArticleKnittingPendingQuantity } from './machinePendingQuantity.service.js';
import { normalizeQueueStatus } from './knittingQueueStatus.js';
import {
  EXCLUDED_PO_STATUSES,
  factoryKey,
  itemDataFactoryKey,
  receivedByPoLine,
  refId,
  styleIdsFromProduct,
  toNumber,
  vendorNameOf,
} from './coreReportHelpers.js';

/**
 * Warehouse on-hand (totalQuantity) keyed by product id.
 * Scans every inventory row so style-only stock (null itemId) is not dropped.
 * Match order: itemId, then Product.styleCodes, then itemData.factoryCode.
 * @param {Array<Record<string, unknown>>} products
 * @returns {Promise<Map<string, number>>}
 */
export const loadWarehouseStockByProduct = async (products) => {
  /** @type {Map<string, number>} */
  const sapByProduct = new Map();
  if (!products.length) return sapByProduct;

  const productIdSet = new Set(products.map((p) => refId(p._id)));
  /** @type {Map<string, string>} */
  const styleToProduct = new Map();
  /** @type {Map<string, string>} */
  const factoryToProduct = new Map();
  for (const product of products) {
    const pid = refId(product._id);
    for (const sid of styleIdsFromProduct(product)) {
      if (!styleToProduct.has(sid)) styleToProduct.set(sid, pid);
    }
    const key = factoryKey(product.factoryCode);
    if (key && !factoryToProduct.has(key)) factoryToProduct.set(key, pid);
  }

  const stocks = await WarehouseInventory.find({})
    .select('itemId styleCodeId totalQuantity itemData')
    .lean();

  /**
   * @param {string} pid
   * @param {number} qty
   */
  const add = (pid, qty) => {
    if (!pid) return;
    sapByProduct.set(pid, (sapByProduct.get(pid) ?? 0) + qty);
  };

  for (const row of stocks) {
    const qty = toNumber(row.totalQuantity);
    const itemId = refId(row.itemId);
    if (itemId && productIdSet.has(itemId)) {
      add(itemId, qty);
      continue;
    }
    const byStyle = styleToProduct.get(refId(row.styleCodeId));
    if (byStyle) {
      add(byStyle, qty);
      continue;
    }
    add(factoryToProduct.get(itemDataFactoryKey(row.itemData)) ?? '', qty);
  }

  return sapByProduct;
};

/**
 * Vendor inward confirm gap keyed by factory-code join key.
 * @returns {Promise<Map<string, number>>}
 */
export const loadInwardPendingByFactory = async () => {
  const rows = await InwardReceive.aggregate([
    {
      $match: {
        inwardSource: InwardReceiveSource.VENDOR,
        status: { $in: [InwardReceiveStatus.PENDING, InwardReceiveStatus.ON_HOLD] },
      },
    },
    {
      $project: {
        articleNumber: 1,
        gap: {
          $max: [0, { $subtract: [{ $ifNull: ['$QuantityFromFactory', 0] }, { $ifNull: ['$receivedQuantity', 0] }] }],
        },
      },
    },
    { $group: { _id: '$articleNumber', qty: { $sum: '$gap' } } },
  ]);

  /** @type {Map<string, number>} */
  const map = new Map();
  for (const row of rows) {
    const key = factoryKey(row._id);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + toNumber(row.qty));
  }
  return map;
};

/**
 * Open vendor-PO pending (ordered − received) by product id + vendor, plus in-transit bucket.
 * @returns {Promise<{
 *   pendingByProductVendor: Map<string, Map<string, number>>,
 *   inTransitByProduct: Map<string, number>
 * }>}
 */
export const loadVendorPoPending = async () => {
  /** @type {Map<string, Map<string, number>>} */
  const pendingByProductVendor = new Map();
  /** @type {Map<string, number>} */
  const inTransitByProduct = new Map();

  const pos = await VendorPurchaseOrder.find({
    currentStatus: { $nin: EXCLUDED_PO_STATUSES },
  })
    .select('poItems receivedLotDetails vendorName vendorSnapshot currentStatus')
    .lean();

  const addPending = (productId, vendor, qty) => {
    if (!productId || qty <= 0) return;
    if (!pendingByProductVendor.has(productId)) pendingByProductVendor.set(productId, new Map());
    const byVendor = pendingByProductVendor.get(productId);
    byVendor.set(vendor, (byVendor.get(vendor) ?? 0) + qty);
  };

  for (const po of pos) {
    const vendor = vendorNameOf(po);
    const receivedMap = receivedByPoLine(po);
    const isInTransit = po.currentStatus === 'in_transit';

    for (const item of po.poItems ?? []) {
      const productId = refId(item.productId);
      const ordered = toNumber(item.quantity);
      const received = receivedMap.get(refId(item._id ?? item.id)) ?? 0;
      const pending = Math.max(0, ordered - received);
      addPending(productId, vendor, pending);
      if (isInTransit && productId) {
        inTransitByProduct.set(productId, (inTransitByProduct.get(productId) ?? 0) + pending);
      }
    }
  }

  return { pendingByProductVendor, inTransitByProduct };
};

/**
 * WIP (order-summary formula), running-plan qty, and planned qty keyed by factory code.
 * @returns {Promise<{
 *   wipByFactory: Map<string, number>,
 *   runningByFactory: Map<string, number>,
 *   planningByFactory: Map<string, number>
 * }>}
 */
export const loadProductionByFactory = async () => {
  /** @type {Map<string, number>} */
  const wipByFactory = new Map();
  /** @type {Map<string, number>} */
  const runningByFactory = new Map();
  /** @type {Map<string, number>} */
  const planningByFactory = new Map();

  const orders = await ProductionOrder.find({}).select('_id articles').lean();
  const listedIds = [...collectListedArticleIds(orders)];
  const [articles, assignments] = await Promise.all([
    listedIds.length
      ? Article.find({ _id: { $in: listedIds } }).select(KNIT_PENDING_ARTICLE_SELECT).lean()
      : Promise.resolve([]),
    loadQueueAssignments(),
  ]);

  const { statusesByArticle } = indexQueueByArticle(assignments);
  /** @type {Map<string, Array<Record<string, unknown>>>} */
  const articlesByFactory = new Map();
  /** @type {Map<string, Record<string, unknown>>} */
  const articleById = new Map();

  for (const article of articles) {
    articleById.set(refId(article._id), article);
    const key = factoryKey(article.articleNumber);
    if (!key) continue;
    if (!articlesByFactory.has(key)) articlesByFactory.set(key, []);
    articlesByFactory.get(key).push(article);
  }

  for (const [key, list] of articlesByFactory) {
    const metrics = createEmptyOrderSummaryMetrics();
    for (const article of list) {
      addArticleToOrderSummaryMetrics(metrics, article, statusesByArticle);
    }
    finalizeOrderSummaryMetrics(metrics);
    wipByFactory.set(key, metrics.wipQty);
    planningByFactory.set(key, metrics.totalQty);
  }

  /** Count each In Progress article once (remaining is article-level, not per machine). */
  const inProgressIds = new Set();
  for (const assignment of assignments) {
    for (const item of assignment.productionOrderItems ?? []) {
      if (normalizeQueueStatus(item.status) !== OrderStatus.IN_PROGRESS) continue;
      const id = refId(item.article);
      if (id) inProgressIds.add(id);
    }
  }

  for (const id of inProgressIds) {
    const article = articleById.get(id);
    if (!article) continue;
    const key = factoryKey(article.articleNumber);
    if (!key) continue;
    runningByFactory.set(
      key,
      (runningByFactory.get(key) ?? 0) + resolveArticleKnittingPendingQuantity(article)
    );
  }

  return { wipByFactory, runningByFactory, planningByFactory };
};

/**
 * Unique StyleCode.brand values for the given products, keyed by product id.
 * Loads StyleCode docs by id so we never populate legacy embedded styleCodes.
 * @param {Array<Record<string, unknown>>} products
 * @returns {Promise<Map<string, string>>}
 */
export const loadBrandsByProduct = async (products) => {
  /** @type {Map<string, string>} */
  const brandsByProduct = new Map();
  const allIds = [...new Set(products.flatMap((p) => styleIdsFromProduct(p)))];
  if (!allIds.length) return brandsByProduct;

  const styles = await StyleCode.find({ _id: { $in: allIds } }).select('brand').lean();
  /** @type {Map<string, string>} */
  const brandByStyle = new Map();
  for (const style of styles) {
    const brand = String(style.brand ?? '').trim();
    if (brand) brandByStyle.set(refId(style._id), brand);
  }

  for (const product of products) {
    const seen = new Set();
    const brands = [];
    for (const sid of styleIdsFromProduct(product)) {
      const brand = brandByStyle.get(sid);
      if (!brand || seen.has(brand)) continue;
      seen.add(brand);
      brands.push(brand);
    }
    brands.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    brandsByProduct.set(refId(product._id), brands.join(', '));
  }
  return brandsByProduct;
};

/**
 * StyleCode ids whose brand (or style code) matches search, for product $or.
 * @param {RegExp} searchRegex
 * @returns {Promise<import('mongoose').Types.ObjectId[]>}
 */
export const styleIdsMatchingSearch = async (searchRegex) => {
  const docs = await StyleCode.find({
    $or: [{ brand: searchRegex }, { styleCode: searchRegex }],
  })
    .select('_id')
    .lean();
  return docs.map((doc) => doc._id);
};

/**
 * Active catalog items that have a factory code.
 * @returns {Record<string, unknown>}
 */
export const baseProductFilter = () => ({
  status: 'active',
  factoryCode: { $exists: true, $nin: [null, ''] },
});

/**
 * Product fields the Core Report identity columns need.
 * @type {string}
 */
export const CORE_REPORT_PRODUCT_SELECT =
  'name factoryCode vendorCode internalCode attributes styleCodes status';
