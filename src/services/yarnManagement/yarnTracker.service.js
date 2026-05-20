import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnBox, YarnCone, YarnTransaction } from '../../models/index.js';
import { ProductionOrder, Article } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';
import { getYarnBoxByBarcode } from './yarnBox.service.js';
import { getYarnConeByBarcode } from './yarnCone.service.js';
import { activeYarnConeMatch } from './yarnStockActiveFilters.js';

const ORDER_SELECT = 'orderNumber orderNote status currentFloor priority';
const ARTICLE_SELECT = 'articleNumber knittingCode linkingType status plannedQuantity';

const ISSUE_TX_TYPES = ['yarn_issued', 'yarn_issued_linking', 'yarn_issued_sampling'];
const RETURN_TX_TYPES = ['yarn_returned'];
const TRANSFER_TX_TYPES = ['internal_transfer', 'yarn_stocked'];

/**
 * @param {Date|string|number|null|undefined} value
 * @returns {number}
 */
function toTime(value) {
  if (value == null) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * @param {Array<{ at: Date|string, sortKey?: number }>} events
 * @returns {Array<Object>}
 */
function sortTimeline(events) {
  return [...events].sort((a, b) => {
    const ta = toTime(a.at);
    const tb = toTime(b.at);
    if (tb !== ta) return tb - ta;
    return (b.sortKey ?? 0) - (a.sortKey ?? 0);
  });
}

/**
 * @param {string} boxId
 * @returns {Promise<Array>}
 */
async function fetchTransactionsForBox(boxId) {
  const trimmed = String(boxId || '').trim();
  if (!trimmed) return [];
  const boxIdRe = new RegExp(`(^|,)\\s*${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(,|$)`, 'i');
  return YarnTransaction.find({
    $or: [
      { boxIds: trimmed },
      { boxIds: { $in: [trimmed] } },
      { orderno: trimmed },
      { orderno: boxIdRe },
    ],
  })
    .populate({ path: 'orderId', select: ORDER_SELECT })
    .populate({ path: 'articleId', select: ARTICLE_SELECT })
    .sort({ transactionDate: -1, _id: -1 })
    .limit(100)
    .lean();
}

/**
 * @param {mongoose.Types.ObjectId|string} coneId
 * @returns {Promise<Array>}
 */
async function fetchTransactionsForCone(coneId) {
  let oid;
  try {
    oid = coneId instanceof mongoose.Types.ObjectId ? coneId : new mongoose.Types.ObjectId(String(coneId));
  } catch {
    return [];
  }
  return YarnTransaction.find({
    $or: [
      { conesIdsArray: oid },
      { conesIdsArray: { $in: [oid] } },
    ],
  })
    .populate({ path: 'orderId', select: ORDER_SELECT })
    .populate({ path: 'articleId', select: ARTICLE_SELECT })
    .sort({ transactionDate: -1, _id: -1 })
    .limit(100)
    .lean();
}

/**
 * @param {unknown} id
 * @returns {boolean}
 */
function isObjectIdString(id) {
  if (id == null || id === '') return false;
  const s = String(id);
  return mongoose.Types.ObjectId.isValid(s) && String(new mongoose.Types.ObjectId(s)) === s;
}

/**
 * @param {Object|null|undefined} order
 * @returns {string|null}
 */
function formatOrderLabel(order) {
  if (!order || typeof order !== 'object') return null;
  const num = order.orderNumber != null ? String(order.orderNumber).trim() : '';
  const note = order.orderNote != null ? String(order.orderNote).trim() : '';
  if (num && note) return `${num} — ${note}`;
  return num || note || null;
}

/**
 * @param {Object|null|undefined} article
 * @returns {string|null}
 */
function formatArticleLabel(article) {
  if (!article || typeof article !== 'object') return null;
  const code = article.articleNumber != null ? String(article.articleNumber).trim() : '';
  const knit = article.knittingCode != null ? String(article.knittingCode).trim() : '';
  const parts = [];
  if (code) parts.push(code);
  if (knit) parts.push(`Knitting: ${knit}`);
  if (article.linkingType) parts.push(String(article.linkingType));
  return parts.length ? parts.join(' · ') : null;
}

/**
 * @param {Object|null|undefined} ref
 * @returns {Object|null}
 */
function populatedDoc(ref) {
  if (ref && typeof ref === 'object' && '_id' in ref) return ref;
  return null;
}

/**
 * @param {Set<string>} orderIds
 * @param {Set<string>} articleIds
 * @returns {Promise<{ orderMap: Map<string, Object>, articleMap: Map<string, Object> }>}
 */
async function loadOrderArticleMaps(orderIds, articleIds) {
  const orderMap = new Map();
  const articleMap = new Map();
  const orderOids = [...orderIds].filter(isObjectIdString).map((id) => new mongoose.Types.ObjectId(id));
  const articleOids = [...articleIds].filter(isObjectIdString).map((id) => new mongoose.Types.ObjectId(id));

  const [orders, articles] = await Promise.all([
    orderOids.length
      ? ProductionOrder.find({ _id: { $in: orderOids } }).select(ORDER_SELECT).lean()
      : [],
    articleOids.length
      ? Article.find({ _id: { $in: articleOids } }).select(ARTICLE_SELECT).lean()
      : [],
  ]);

  for (const o of orders) orderMap.set(String(o._id), o);
  for (const a of articles) articleMap.set(String(a._id), a);
  return { orderMap, articleMap };
}

/**
 * @param {Record<string, unknown>|undefined|null} details
 * @param {Map<string, Object>} orderMap
 * @param {Map<string, Object>} articleMap
 * @returns {Record<string, unknown>|undefined}
 */
function enrichEventDetails(details, orderMap, articleMap) {
  if (!details || typeof details !== 'object') return details;
  const next = { ...details };
  const rawOrderId = next.orderId;
  const rawArticleId = next.articleId;
  delete next.orderId;
  delete next.articleId;

  let order =
    populatedDoc(rawOrderId) ||
    (rawOrderId != null ? orderMap.get(String(rawOrderId)) : null);
  let article =
    populatedDoc(rawArticleId) ||
    (rawArticleId != null ? articleMap.get(String(rawArticleId)) : null);

  const orderLabel = formatOrderLabel(order) || (next.orderno != null ? String(next.orderno) : null);
  const articleLabel =
    formatArticleLabel(article) ||
    (next.articleNumber != null ? String(next.articleNumber) : null);

  if (orderLabel) next.productionOrder = orderLabel;
  if (articleLabel) next.articleCode = articleLabel;

  if (order && order.status) next.orderStatus = order.status;
  if (order && order.currentFloor) next.currentFloor = order.currentFloor;
  if (article && article.status) next.articleStatus = article.status;
  if (article && article.plannedQuantity != null) next.plannedQty = article.plannedQuantity;

  if (next.productionOrder) delete next.orderno;
  if (next.articleCode) delete next.articleNumber;

  return next;
}

/**
 * @param {Array<Object>} events
 * @returns {Promise<Array<Object>>}
 */
async function enrichTimeline(events) {
  const orderIds = new Set();
  const articleIds = new Set();
  for (const ev of events) {
    const d = ev.details;
    if (!d || typeof d !== 'object') continue;
    if (d.orderId != null) orderIds.add(String(d.orderId));
    if (d.articleId != null) articleIds.add(String(d.articleId));
    const popOrder = populatedDoc(d.orderId);
    const popArticle = populatedDoc(d.articleId);
    if (popOrder?._id) orderIds.add(String(popOrder._id));
    if (popArticle?._id) articleIds.add(String(popArticle._id));
  }
  const { orderMap, articleMap } = await loadOrderArticleMaps(orderIds, articleIds);
  return events.map((ev) => ({
    ...ev,
    details: enrichEventDetails(ev.details, orderMap, articleMap),
  }));
}

/**
 * @param {Object} tx
 * @returns {Object}
 */
function mapTransactionEvent(tx) {
  const type = tx.transactionType;
  let title = type.replace(/_/g, ' ');
  if (type === 'yarn_stocked') title = 'Stocked in storage';
  if (type === 'internal_transfer') title = 'Internal transfer';
  if (ISSUE_TX_TYPES.includes(type)) title = 'Yarn issued to floor';
  if (RETURN_TX_TYPES.includes(type)) title = 'Yarn returned from floor';

  const order = populatedDoc(tx.orderId);
  const article = populatedDoc(tx.articleId);
  const details = {
    yarnName: tx.yarnName,
    netWeight: tx.transactionNetWeight,
    totalWeight: tx.transactionTotalWeight,
    tearWeight: tx.transactionTearWeight,
    coneCount: tx.transactionConeCount,
    fromStorageLocation: tx.fromStorageLocation,
    toStorageLocation: tx.toStorageLocation,
    boxIds: tx.boxIds || [],
    issuedByEmail: tx.issuedByEmail,
    issueBatchId: tx.issueBatchId,
  };

  const orderLabel = formatOrderLabel(order) || (tx.orderno != null ? String(tx.orderno) : null);
  const articleLabel =
    formatArticleLabel(article) || (tx.articleNumber != null ? String(tx.articleNumber) : null);
  if (orderLabel) details.productionOrder = orderLabel;
  if (articleLabel) details.articleCode = articleLabel;
  if (order?.status) details.orderStatus = order.status;
  if (order?.currentFloor) details.currentFloor = order.currentFloor;
  if (article?.status) details.articleStatus = article.status;

  return {
    id: String(tx._id),
    kind: 'transaction',
    at: tx.transactionDate || tx.createdAt,
    title,
    transactionType: type,
    details,
  };
}

/**
 * Build timeline events for a yarn box.
 * @param {Object} box
 * @param {Array} cones
 * @param {Array} transactions
 * @returns {Array<Object>}
 */
function buildBoxTimeline(box, cones, transactions) {
  const events = [];

  if (box.createdAt) {
    events.push({
      id: `box-created-${box._id}`,
      kind: 'box_created',
      at: box.createdAt,
      title: 'Box created',
      details: {
        boxId: box.boxId,
        poNumber: box.poNumber,
        yarnName: box.yarnName,
        numberOfCones: box.numberOfCones,
      },
    });
  }

  if (box.receivedDate) {
    events.push({
      id: `box-received-${box._id}`,
      kind: 'box_received',
      at: box.receivedDate,
      title: 'PO received',
      details: { poNumber: box.poNumber, receivedDate: box.receivedDate },
    });
  }

  if (box.qcData?.date || box.qcData?.status) {
    events.push({
      id: `box-qc-${box._id}`,
      kind: 'qc',
      at: box.qcData.date || box.updatedAt,
      title: `QC ${box.qcData.status || 'updated'}`,
      details: {
        status: box.qcData.status,
        username: box.qcData.username,
        remarks: box.qcData.remarks,
      },
    });
  }

  if (box.storedStatus && box.storageLocation) {
    events.push({
      id: `box-stored-${box._id}`,
      kind: 'storage',
      at: box.updatedAt || box.createdAt,
      title: 'Stored in rack',
      details: {
        storageLocation: box.storageLocation,
        boxWeight: box.boxWeight,
        storedStatus: box.storedStatus,
      },
    });
  }

  if (box.coneData?.conesIssued) {
    events.push({
      id: `box-cones-issued-${box._id}`,
      kind: 'cones_issued',
      at: box.coneData.coneIssueDate || box.updatedAt,
      title: 'Cones issued from box',
      details: {
        numberOfCones: box.coneData.numberOfCones,
        issuedBy: box.coneData.coneIssueBy?.username,
      },
    });
  }

  if (box.returnedToVendorAt) {
    events.push({
      id: `box-vendor-return-${box._id}`,
      kind: 'vendor_return',
      at: box.returnedToVendorAt,
      title: 'Returned to vendor',
      details: { vendorReturnId: box.vendorReturnId },
    });
  }

  for (const tx of transactions) {
    events.push(mapTransactionEvent(tx));
  }

  for (const cone of cones) {
    if (cone.issueStatus === 'issued' && cone.issueDate) {
      events.push({
        id: `cone-issue-${cone._id}`,
        kind: 'cone_issue',
        at: cone.issueDate,
        title: `Cone issued (${cone.barcode})`,
        details: {
          barcode: cone.barcode,
          issueWeight: cone.issueWeight,
          issuedBy: cone.issuedBy?.username,
          issueStatus: cone.issueStatus,
        },
        sortKey: 1,
      });
    }
    if (cone.issueStatus === 'used') {
      events.push({
        id: `cone-used-${cone._id}`,
        kind: 'cone_used',
        at: cone.updatedAt || cone.issueDate,
        title: `Cone used / empty (${cone.barcode})`,
        details: { barcode: cone.barcode, coneWeight: cone.coneWeight },
        sortKey: 1,
      });
    }
    if (cone.coneStorageId && cone.createdAt) {
      events.push({
        id: `cone-st-${cone._id}`,
        kind: 'cone_storage',
        at: cone.updatedAt || cone.createdAt,
        title: `Cone in short-term (${cone.barcode})`,
        details: {
          barcode: cone.barcode,
          coneStorageId: cone.coneStorageId,
          coneWeight: cone.coneWeight,
          tearWeight: cone.tearWeight,
        },
        sortKey: 0,
      });
    }
  }

  return sortTimeline(events);
}

/**
 * Build timeline events for a yarn cone.
 * @param {Object} cone
 * @param {Array} transactions
 * @returns {Array<Object>}
 */
function buildConeTimeline(cone, transactions) {
  const events = [];

  if (cone.createdAt) {
    events.push({
      id: `cone-created-${cone._id}`,
      kind: 'cone_created',
      at: cone.createdAt,
      title: 'Cone created',
      details: {
        barcode: cone.barcode,
        boxId: cone.boxId,
        poNumber: cone.poNumber,
        yarnName: cone.yarnName,
        coneWeight: cone.coneWeight,
        tearWeight: cone.tearWeight,
      },
    });
  }

  if (cone.coneStorageId) {
    events.push({
      id: `cone-storage-${cone._id}`,
      kind: 'cone_storage',
      at: cone.updatedAt || cone.createdAt,
      title: 'Assigned to short-term storage',
      details: { coneStorageId: cone.coneStorageId, coneWeight: cone.coneWeight },
    });
  }

  if (cone.issueDate || cone.issueStatus === 'issued') {
    events.push({
      id: `cone-issued-${cone._id}`,
      kind: 'cone_issue',
      at: cone.issueDate || cone.updatedAt,
      title: 'Cone issued to production',
      details: {
        issueStatus: cone.issueStatus,
        issueWeight: cone.issueWeight,
        issuedBy: cone.issuedBy?.username,
        orderId: cone.orderId,
        articleId: cone.articleId,
      },
    });
  }

  if (cone.returnDate) {
    events.push({
      id: `cone-return-${cone._id}`,
      kind: 'cone_return',
      at: cone.returnDate,
      title: 'Cone returned from floor',
      details: {
        returnWeight: cone.returnWeight,
        returnBy: cone.returnBy?.username,
        returnStatus: cone.returnStatus,
        remainingWeight: cone.coneWeight,
      },
    });
  }

  if (cone.issueStatus === 'used') {
    events.push({
      id: `cone-used-${cone._id}`,
      kind: 'cone_used',
      at: cone.updatedAt,
      title: 'Cone fully used',
      details: { coneWeight: cone.coneWeight },
    });
  }

  if (cone.returnedToVendorAt) {
    events.push({
      id: `cone-vendor-return-${cone._id}`,
      kind: 'vendor_return',
      at: cone.returnedToVendorAt,
      title: 'Returned to vendor',
      details: { vendorReturnId: cone.vendorReturnId },
    });
  }

  for (const tx of transactions) {
    events.push(mapTransactionEvent(tx));
  }

  if (cone.issueTransactionContext) {
    const ctx = cone.issueTransactionContext;
    const ctxDetails = {
      transactionType: ctx.transactionType,
    };
    if (ctx.productionOrder) ctxDetails.productionOrder = String(ctx.productionOrder);
    if (ctx.articleNumber) ctxDetails.articleCode = String(ctx.articleNumber);
    if (ctx.orderId) ctxDetails.orderId = ctx.orderId;
    if (ctx.articleId) ctxDetails.articleId = ctx.articleId;
    events.push({
      id: `cone-issue-txn-${cone._id}`,
      kind: 'issue_context',
      at: ctx.transactionDate,
      title: 'Latest issue transaction',
      details: ctxDetails,
      sortKey: 2,
    });
  }

  return sortTimeline(events);
}

/**
 * @param {string} barcode
 * @param {{ includeInactive?: boolean|string }} [options]
 * @returns {Promise<Object>}
 */
export const getBoxTrackerByBarcode = async (barcode, options = {}) => {
  const includeInactive =
    options.includeInactive === true ||
    options.includeInactive === 'true' ||
    options.includeInactive === '1';

  const box = await getYarnBoxByBarcode(barcode, { includeInactive });

  const cones = await YarnCone.find({
    boxId: box.boxId,
    ...(includeInactive ? {} : activeYarnConeMatch),
  })
    .sort({ createdAt: -1 })
    .lean();

  const transactions = await fetchTransactionsForBox(box.boxId);
  const timeline = await enrichTimeline(buildBoxTimeline(box, cones, transactions));

  const currentNetWeight = (box.boxWeight ?? 0) - (box.tearweight ?? 0);
  const initialWeight = box.initialBoxWeight ?? box.grossWeight ?? box.boxWeight ?? 0;

  return {
    entityType: 'box',
    box: {
      ...box,
      currentNetWeight,
      initialWeight,
      conesInBox: cones.length,
      conesIssuedCount: cones.filter((c) =>
        ['issued', 'used', 'returned_to_vendor'].includes(c.issueStatus)
      ).length,
      conesInStorageCount: cones.filter((c) => c.coneStorageId && c.issueStatus === 'not_issued').length,
    },
    cones: cones.map((c) => ({
      _id: c._id,
      barcode: c.barcode,
      coneWeight: c.coneWeight,
      tearWeight: c.tearWeight,
      netWeight: (c.coneWeight ?? 0) - (c.tearWeight ?? 0),
      issueStatus: c.issueStatus,
      returnStatus: c.returnStatus,
      coneStorageId: c.coneStorageId,
      issueDate: c.issueDate,
      issueWeight: c.issueWeight,
      returnDate: c.returnDate,
      returnWeight: c.returnWeight,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
    timeline,
    transactionCount: transactions.length,
  };
};

/**
 * @param {string} barcode
 * @param {{ includeInactive?: boolean|string }} [options]
 * @returns {Promise<Object>}
 */
export const getConeTrackerByBarcode = async (barcode, options = {}) => {
  const includeInactive =
    options.includeInactive === true ||
    options.includeInactive === 'true' ||
    options.includeInactive === '1';

  const cone = await getYarnConeByBarcode(barcode, { includeInactive });
  if (!cone?._id) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn cone not found');
  }

  let parentBox = null;
  if (cone.boxId) {
    try {
      parentBox = await getYarnBoxByBarcode(cone.boxId, { includeInactive });
    } catch {
      parentBox = await YarnBox.findOne({ boxId: cone.boxId }).lean();
    }
  }

  const transactions = await fetchTransactionsForCone(cone._id);
  const timeline = await enrichTimeline(buildConeTimeline(cone, transactions));

  const gross = cone.coneWeight ?? 0;
  const tear = cone.tearWeight ?? 0;

  let productionOrderLabel = null;
  let articleLabel = null;
  if (cone.orderId || cone.articleId) {
    const { orderMap, articleMap } = await loadOrderArticleMaps(
      new Set(cone.orderId ? [String(cone.orderId)] : []),
      new Set(cone.articleId ? [String(cone.articleId)] : [])
    );
    productionOrderLabel =
      formatOrderLabel(orderMap.get(String(cone.orderId))) ||
      cone.issueTransactionContext?.productionOrder ||
      null;
    articleLabel =
      formatArticleLabel(articleMap.get(String(cone.articleId))) ||
      cone.issueTransactionContext?.articleNumber ||
      null;
  } else if (cone.issueTransactionContext) {
    productionOrderLabel = cone.issueTransactionContext.productionOrder || null;
    articleLabel = cone.issueTransactionContext.articleNumber || null;
  }

  return {
    entityType: 'cone',
    cone: {
      ...cone,
      netWeight: gross - tear,
      parentBoxId: parentBox?.boxId ?? cone.boxId,
      parentBoxBarcode: parentBox?.barcode,
      parentPoNumber: parentBox?.poNumber ?? cone.poNumber,
      productionOrderLabel,
      articleLabel,
    },
    parentBox: parentBox
      ? {
          boxId: parentBox.boxId,
          barcode: parentBox.barcode,
          poNumber: parentBox.poNumber,
          yarnName: parentBox.yarnName,
          storageLocation: parentBox.storageLocation,
          boxWeight: parentBox.boxWeight,
          initialBoxWeight: parentBox.initialBoxWeight,
        }
      : null,
    timeline,
    transactionCount: transactions.length,
  };
};
