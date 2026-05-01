import MachineOrderAssignment from '../../models/production/machineOrderAssignment.model.js';
import { OrderStatus, YarnIssueStatus } from '../../models/production/enums.js';
import YarnTransaction from '../../models/yarnReq/yarnTransaction.model.js';
import { getProductsByFactoryCodes } from '../product.service.js';
import { getShortTermConeStockByYarnKeys } from '../yarnManagement/yarnInventory.service.js';

const toNumber = (v) => Number(v ?? 0);

/** Item row statuses excluded from active queue (same as top-items). */
const EXCLUDED_ITEM_STATUSES = [OrderStatus.COMPLETED, OrderStatus.ON_HOLD];

/**
 * Whether this assignment line still needs yarn issue work.
 * @param {{ status?: string, yarnIssueStatus?: string }} item
 * @returns {boolean}
 */
const isPendingYarnIssueLine = (item) => {
  const st = String(item?.status ?? '');
  if (EXCLUDED_ITEM_STATUSES.includes(st)) return false;
  const y = String(item?.yarnIssueStatus ?? '');
  if (y === YarnIssueStatus.COMPLETED) return false;
  return true;
};

/**
 * Resolve Mongo id from populated or raw ref.
 * @param {unknown} ref
 * @returns {string}
 */
const refId = (ref) => {
  if (ref == null) return '';
  if (typeof ref === 'object' && (ref._id || ref.id)) {
    return String(ref._id ?? ref.id);
  }
  return String(ref);
};

/**
 * Sum net issued weight in grams for one BOM line (matches yarn-issue UI: yarnName + order + article).
 * @param {Array<Record<string, unknown>>} transactions
 * @param {string} orderId
 * @param {string} orderNumber
 * @param {string} articleId
 * @param {string} articleNumber
 * @param {string} yarnName
 * @returns {number}
 */
const sumIssuedGramsForLine = (
  transactions,
  orderId,
  orderNumber,
  articleId,
  articleNumber,
  yarnName
) => {
  let sumKg = 0;
  for (const t of transactions) {
    if (String(t.transactionType) !== 'yarn_issued') continue;
    if (String(t.yarnName) !== String(yarnName)) continue;
    const hasOrderId = t.orderId != null && String(t.orderId).length > 0;
    const matchesOrder = hasOrderId
      ? String(t.orderId) === String(orderId)
      : Boolean(orderNumber) && String(t.orderno ?? '') === String(orderNumber);
    if (!matchesOrder) continue;
    const aid = t.articleId != null ? String(t.articleId) : '';
    const an = t.articleNumber != null ? String(t.articleNumber) : '';
    const matchesArticle =
      (Boolean(articleId) && aid === String(articleId)) ||
      (Boolean(articleNumber) && an === String(articleNumber));
    if (!matchesArticle) continue;
    sumKg += toNumber(t.transactionNetWeight);
  }
  return sumKg * 1000;
};

/**
 * Yarn still required across all machine-queue PO lines where yarn issue is not Completed:
 * BOM requirement minus yarn_issued (per order/article/yarn), grouped by yarn and by order.
 *
 * @returns {Promise<{
 *   generatedAt: string,
 *   pendingLineCount: number,
 *   byYarn: Array<{ yarnKey: string, yarnCatalogId: string|null, yarnName: string, yarnType: string|null, totalRequiredGrams: number, totalIssuedGrams: number, totalOutstandingGrams: number }>,
 *   byOrder: Array<{ orderId: string, orderNumber: string, lines: Array<{ articleNumber: string, yarnName: string, requiredGrams: number, issuedGrams: number, outstandingGrams: number }> }>,
 *   skippedArticles: Array<{ orderNumber: string, articleNumber: string, reason: string }>
 * }>}
 */
export const getYarnIssuePendingSummary = async () => {
  const assignments = await MachineOrderAssignment.find({
    isActive: true,
    'productionOrderItems.0': { $exists: true },
  })
    .populate('productionOrderItems.productionOrder')
    .populate('productionOrderItems.article')
    .lean();

  /** @type {Map<string, { orderId: string, orderNumber: string, articleId: string, articleNumber: string, plannedQty: number }>} */
  const uniqueLines = new Map();

  for (const doc of assignments) {
    const items = doc.productionOrderItems || [];
    for (const item of items) {
      if (!isPendingYarnIssueLine(item)) continue;
      const po = item.productionOrder;
      const art = item.article;
      const orderId = refId(typeof po === 'object' && po ? po : item.productionOrder);
      const articleId = refId(typeof art === 'object' && art ? art : item.article);
      if (!orderId || !articleId) continue;
      const orderNumber =
        (typeof po === 'object' && po && po.orderNumber) ? String(po.orderNumber) : String(item.orderNumber || '');
      const articleNumber =
        (typeof art === 'object' && art && art.articleNumber)
          ? String(art.articleNumber)
          : String(item.articleNumber || '');
      const plannedQty = toNumber(
        typeof art === 'object' && art && art.plannedQuantity != null ? art.plannedQuantity : undefined
      );
      const key = `${orderId}_${articleId}`;
      if (!uniqueLines.has(key)) {
        uniqueLines.set(key, {
          orderId,
          orderNumber,
          articleId,
          articleNumber,
          plannedQty: plannedQty > 0 ? plannedQty : 0,
        });
      }
    }
  }

  const lines = [...uniqueLines.values()];

  if (lines.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      pendingLineCount: 0,
      byYarn: [],
      byOrder: [],
      skippedArticles: [],
    };
  }

  const factoryCodes = [...new Set(lines.map((l) => l.articleNumber).filter(Boolean))];
  const products = await getProductsByFactoryCodes(factoryCodes);
  /** @type {Map<string, Record<string, unknown>>} */
  const productByFactory = new Map();
  for (const p of products) {
    if (p?.factoryCode != null) {
      productByFactory.set(String(p.factoryCode).trim().toLowerCase(), p);
    }
  }

  const orderIds = [...new Set(lines.map((l) => l.orderId))];
  const orderNumbers = [...new Set(lines.map((l) => l.orderNumber).filter(Boolean))];

  const orTxn = [
    ...(orderIds.length ? [{ orderId: { $in: orderIds } }] : []),
    ...(orderNumbers.length ? [{ orderno: { $in: orderNumbers } }] : []),
  ];
  const transactions = await YarnTransaction.find({
    transactionType: 'yarn_issued',
    ...(orTxn.length ? { $or: orTxn } : {}),
  })
    .select('transactionType transactionNetWeight yarnName orderId orderno articleId articleNumber')
    .lean();

  /** @type {Array<{ orderId: string, orderNumber: string, articleNumber: string, yarnCatalogId: string|null, yarnName: string, yarnType: string|null, requiredGrams: number, issuedGrams: number, outstandingGrams: number }>} */
  const detailLines = [];
  /** @type {Array<{ orderNumber: string, articleNumber: string, reason: string }>} */
  const skippedArticles = [];

  for (const row of lines) {
    const lookupKey = String(row.articleNumber || '').trim().toLowerCase();
    const product = productByFactory.get(lookupKey);
    if (!product?.bom?.length) {
      skippedArticles.push({
        orderNumber: row.orderNumber || row.orderId,
        articleNumber: row.articleNumber || '—',
        reason: 'No product BOM for this factory code',
      });
      continue;
    }

    const planned = row.plannedQty > 0 ? row.plannedQty : 0;
    for (const bom of product.bom) {
      const cat = bom.yarnCatalogId;
      const yarnCatalogId =
        cat && typeof cat === 'object' && (cat._id || cat.id) ? String(cat._id ?? cat.id) : cat ? String(cat) : null;
      const yarnName = (cat && typeof cat === 'object' && cat.yarnName) || bom.yarnName || '';
      if (!yarnName) continue;
      const yarnType =
        cat && typeof cat === 'object' && cat.yarnType != null
          ? typeof cat.yarnType === 'object' && cat.yarnType?.name
            ? String(cat.yarnType.name)
            : String(cat.yarnType)
          : null;
      const perUnit = toNumber(bom.quantity);
      const requiredGrams = perUnit * planned;
      const issuedGrams = sumIssuedGramsForLine(
        transactions,
        row.orderId,
        row.orderNumber,
        row.articleId,
        row.articleNumber,
        yarnName
      );
      const outstandingGrams = Math.max(0, requiredGrams - issuedGrams);
      if (outstandingGrams < 0.0001) continue;

      detailLines.push({
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        articleNumber: row.articleNumber,
        yarnCatalogId,
        yarnName,
        yarnType,
        requiredGrams,
        issuedGrams,
        outstandingGrams,
      });
    }
  }

  /** @type {Map<string, { yarnKey: string, yarnCatalogId: string|null, yarnName: string, yarnType: string|null, totalRequiredGrams: number, totalIssuedGrams: number, totalOutstandingGrams: number }>} */
  const byYarnMap = new Map();
  for (const d of detailLines) {
    const yarnKey = d.yarnCatalogId || `name:${d.yarnName}`;
    if (!byYarnMap.has(yarnKey)) {
      byYarnMap.set(yarnKey, {
        yarnKey,
        yarnCatalogId: d.yarnCatalogId,
        yarnName: d.yarnName,
        yarnType: d.yarnType,
        totalRequiredGrams: 0,
        totalIssuedGrams: 0,
        totalOutstandingGrams: 0,
      });
    }
    const agg = byYarnMap.get(yarnKey);
    agg.totalRequiredGrams += d.requiredGrams;
    agg.totalIssuedGrams += d.issuedGrams;
    agg.totalOutstandingGrams += d.outstandingGrams;
  }

  const byYarnSorted = [...byYarnMap.values()].sort(
    (a, b) => b.totalOutstandingGrams - a.totalOutstandingGrams
  );

  /** @type {{ byCatalogId: Record<string, { totalNetWeightKg: number; numberOfCones: number }>, byYarnName: Record<string, { totalNetWeightKg: number; numberOfCones: number }> }} */
  let stMaps = { byCatalogId: {}, byYarnName: {} };
  try {
    stMaps = await getShortTermConeStockByYarnKeys();
  } catch (err) {
    console.error('[getYarnIssuePendingSummary] short-term stock:', err?.message || err);
  }

  /**
   * Net cone weight in short-term racks for this yarn (prefers catalog id, else normalized name).
   * @param {string|null} yarnCatalogId
   * @param {string} yarnName
   * @returns {{ shortTermNetGrams: number, shortTermConeCount: number }}
   */
  const resolveShortTermStock = (yarnCatalogId, yarnName) => {
    if (yarnCatalogId) {
      const row = stMaps.byCatalogId[String(yarnCatalogId)];
      if (row) {
        return {
          shortTermNetGrams: Math.max(0, row.totalNetWeightKg * 1000),
          shortTermConeCount: row.numberOfCones,
        };
      }
    }
    const k = String(yarnName || '').trim().toLowerCase();
    const row = k ? stMaps.byYarnName[k] : null;
    if (row) {
      return {
        shortTermNetGrams: Math.max(0, row.totalNetWeightKg * 1000),
        shortTermConeCount: row.numberOfCones,
      };
    }
    return { shortTermNetGrams: 0, shortTermConeCount: 0 };
  };

  const byYarn = byYarnSorted.map((row) => ({
    ...row,
    ...resolveShortTermStock(row.yarnCatalogId, row.yarnName),
  }));

  /** @type {Map<string, { orderId: string, orderNumber: string, lines: typeof detailLines }>} */
  const orderMap = new Map();
  for (const d of detailLines) {
    const k = d.orderId;
    if (!orderMap.has(k)) {
      orderMap.set(k, { orderId: d.orderId, orderNumber: d.orderNumber, lines: [] });
    }
    orderMap.get(k).lines.push({
      articleNumber: d.articleNumber,
      yarnName: d.yarnName,
      requiredGrams: d.requiredGrams,
      issuedGrams: d.issuedGrams,
      outstandingGrams: d.outstandingGrams,
    });
  }

  const byOrder = [...orderMap.values()].sort((a, b) =>
    String(a.orderNumber).localeCompare(String(b.orderNumber))
  );

  return {
    generatedAt: new Date().toISOString(),
    pendingLineCount: lines.length,
    byYarn,
    byOrder,
    skippedArticles,
  };
};
