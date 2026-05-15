import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { YarnCone, YarnBox, YarnTransaction } from '../../models/index.js';
import { ProductionOrder, Article } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';
import {
  yarnConeIssueStatuses,
  yarnConeReturnStatuses,
  yarnConeUnavailableIssueStatuses,
} from '../../models/yarnReq/yarnCone.model.js';
import { activeYarnConeMatch, activeYarnBoxMatch } from './yarnStockActiveFilters.js';

/** Types that assign a cone to a production order + article (same as article-return-slice). */
const ISSUE_TX_TYPES_FOR_CONE_LINK = ['yarn_issued', 'yarn_issued_linking', 'yarn_issued_sampling'];

/**
 * @param {string} s
 */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Any yarn issue row linking this cone to the given production order + article (legacy `orderno` / `articleNumber` aware).
 *
 * @param {mongoose.Types.ObjectId|string} coneOid
 * @param {string} orderIdStr
 * @param {string} articleIdStr
 */
async function findIssueTxnMatchingOrderArticle(coneOid, orderIdStr, articleIdStr) {
  if (!mongoose.Types.ObjectId.isValid(orderIdStr) || !mongoose.Types.ObjectId.isValid(articleIdStr)) {
    return null;
  }
  const [po, article] = await Promise.all([
    ProductionOrder.findById(orderIdStr).select('orderNumber').lean(),
    Article.findOne({
      _id: new mongoose.Types.ObjectId(articleIdStr),
      orderId: new mongoose.Types.ObjectId(orderIdStr),
    })
      .select('articleNumber')
      .lean(),
  ]);
  if (!po || !article) {
    return null;
  }
  const oid = coneOid instanceof mongoose.Types.ObjectId ? coneOid : new mongoose.Types.ObjectId(String(coneOid));
  const ordRe = new RegExp(`^${escapeRegex(String(po.orderNumber ?? '').trim())}$`, 'i');
  const artRe = new RegExp(`^${escapeRegex(String(article.articleNumber ?? '').trim())}$`, 'i');
  return YarnTransaction.findOne({
    transactionType: { $in: ISSUE_TX_TYPES_FOR_CONE_LINK },
    conesIdsArray: oid,
    $and: [
      { $or: [{ orderId: new mongoose.Types.ObjectId(orderIdStr) }, { orderno: ordRe }] },
      { $or: [{ articleId: new mongoose.Types.ObjectId(articleIdStr) }, { articleNumber: artRe }] },
    ],
  })
    .select('_id transactionDate')
    .lean();
}

/**
 * Latest yarn issue txn involving this cone (for GET barcode: authoritative PO/article vs stale cone fields).
 * Exported for article-return-slice: exclude cones whose true latest issue is another PO/article.
 *
 * @param {mongoose.Types.ObjectId|string|null|undefined} coneId
 */
export async function loadLatestIssueTransactionContextForCone(coneId) {
  if (coneId == null || coneId === '') return null;
  let oid;
  try {
    oid = coneId instanceof mongoose.Types.ObjectId ? coneId : new mongoose.Types.ObjectId(String(coneId));
  } catch {
    return null;
  }
  const txn = await YarnTransaction.findOne({
    transactionType: { $in: ISSUE_TX_TYPES_FOR_CONE_LINK },
    conesIdsArray: oid,
  })
    .sort({ transactionDate: -1, _id: -1 })
    .populate({ path: 'orderId', select: '_id orderNumber' })
    .populate({ path: 'articleId', select: '_id articleNumber' })
    .lean();
  if (!txn) return null;
  let orderIdStr = null;
  let productionOrder = null;
  if (txn.orderId) {
    const o = txn.orderId;
    if (typeof o === 'object' && o !== null && '_id' in o) {
      orderIdStr = String(/** @type {{ _id?: unknown }} */ (o)._id);
      if ('orderNumber' in o && o.orderNumber != null) {
        productionOrder = String(o.orderNumber);
      }
    } else {
      orderIdStr = String(o);
    }
  }
  if (!orderIdStr && txn.orderno) {
    const p = await ProductionOrder.findOne({
      orderNumber: new RegExp(`^${escapeRegex(String(txn.orderno).trim())}$`, 'i'),
    })
      .select('_id orderNumber')
      .lean();
    if (p) {
      orderIdStr = String(p._id);
      productionOrder = p.orderNumber != null ? String(p.orderNumber) : productionOrder;
    }
  }
  let articleIdStr = null;
  let articleNumber = txn.articleNumber != null && String(txn.articleNumber).trim() !== '' ? String(txn.articleNumber) : null;
  if (txn.articleId) {
    const a = txn.articleId;
    if (typeof a === 'object' && a !== null && '_id' in a) {
      articleIdStr = String(/** @type {{ _id?: unknown }} */ (a)._id);
      if ((!articleNumber || articleNumber.trim() === '') && 'articleNumber' in a && a.articleNumber != null) {
        articleNumber = String(a.articleNumber);
      }
    } else {
      articleIdStr = String(a);
    }
  }
  const transactionDate = txn.transactionDate ? new Date(/** @type {string | Date} */ (txn.transactionDate)) : null;
  return {
    orderId: orderIdStr,
    productionOrder,
    articleId: articleIdStr,
    articleNumber,
    transactionId: String(txn._id),
    transactionDate: transactionDate && !Number.isNaN(transactionDate.getTime()) ? transactionDate.toISOString() : null,
  };
}

export const createYarnCone = async (yarnConeBody) => {
  const existingBarcode = await YarnCone.findOne({
    barcode: yarnConeBody.barcode,
    ...activeYarnConeMatch,
  });
  if (existingBarcode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Barcode already exists');
  }

  if (yarnConeBody.issueStatus && !yarnConeIssueStatuses.includes(yarnConeBody.issueStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid issue status');
  }

  if (yarnConeBody.returnStatus && !yarnConeReturnStatuses.includes(yarnConeBody.returnStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid return status');
  }

  const yarnCone = await YarnCone.create(yarnConeBody);
  return yarnCone;
};

export const updateYarnConeById = async (yarnConeId, updateBody) => {
  const yarnCone = await YarnCone.findById(yarnConeId);
  if (!yarnCone) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn cone not found');
  }

  if (yarnCone.returnedToVendorAt) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'This yarn cone is archived (vendor return) and cannot be updated.'
    );
  }

  if (updateBody.barcode && updateBody.barcode !== yarnCone.barcode) {
    const existingBarcode = await YarnCone.findOne({
      barcode: updateBody.barcode,
      _id: { $ne: yarnConeId },
      ...activeYarnConeMatch,
    });
    if (existingBarcode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Barcode already exists');
    }
  }

  if (updateBody.issueStatus && !yarnConeIssueStatuses.includes(updateBody.issueStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid issue status');
  }

  if (updateBody.returnStatus && !yarnConeReturnStatuses.includes(updateBody.returnStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid return status');
  }

  Object.assign(yarnCone, updateBody);
  await yarnCone.save();
  return yarnCone;
};

/**
 * Load a yarn cone by barcode.
 * @param {string} barcode - Cone barcode
 * @param {{ includeInactive?: boolean|string; expectedOrderId?: string; expectedArticleId?: string }} [options] - When true, include vendor-returned (archived) cones; optional expected PO/article for return UI checks.
 * @returns {Promise<Object>}
 */
export const getYarnConeByBarcode = async (barcode, options = {}) => {
  const trimmed = String(barcode || '').trim();
  const includeInactive =
    options.includeInactive === true ||
    options.includeInactive === 'true' ||
    options.includeInactive === '1';
  const activePart = includeInactive ? {} : activeYarnConeMatch;

  let yarnCone = await YarnCone.findOne({ barcode: trimmed, ...activePart })
    .populate({
      path: 'yarnCatalogId',
      select: '_id yarnName yarnType status',
    })
    .lean();

  if (!yarnCone && includeInactive) {
    yarnCone = await YarnCone.findOne({ barcode: trimmed })
      .populate({
        path: 'yarnCatalogId',
        select: '_id yarnName yarnType status',
      })
      .lean();
  }

  if (!yarnCone) {
    throw new ApiError(httpStatus.NOT_FOUND, `Yarn cone with barcode ${trimmed} not found`);
  }

  const expectedOrderId = String(options.expectedOrderId || '').trim();
  const expectedArticleId = String(options.expectedArticleId || '').trim();

  /** @type {boolean|null} */
  let matchesExpectedReturnContext = null;
  if (
    expectedOrderId &&
    expectedArticleId &&
    mongoose.Types.ObjectId.isValid(expectedOrderId) &&
    mongoose.Types.ObjectId.isValid(expectedArticleId)
  ) {
    const hit = await findIssueTxnMatchingOrderArticle(yarnCone._id, expectedOrderId, expectedArticleId);
    matchesExpectedReturnContext = !!hit;
  }

  const issueTransactionContext = await loadLatestIssueTransactionContextForCone(yarnCone._id);
  const coneOrderArticleMatchesLatestIssueTxn =
    issueTransactionContext &&
    issueTransactionContext.orderId &&
    issueTransactionContext.articleId &&
    String(yarnCone.orderId ?? '') === String(issueTransactionContext.orderId) &&
    String(yarnCone.articleId ?? '') === String(issueTransactionContext.articleId);

  return {
    ...yarnCone,
    issueTransactionContext,
    /** `true` / `false` when issue txn exists; `null` when there is no issue history for this cone. */
    coneOrderArticleMatchesLatestIssueTxn:
      issueTransactionContext && issueTransactionContext.orderId && issueTransactionContext.articleId
        ? !!coneOrderArticleMatchesLatestIssueTxn
        : null,
    /**
     * When caller passes `expected_order_id` + `expected_article_id`, `true` iff an issue txn links this cone to that pair.
     * Use this instead of comparing only `orderId` / `articleId` on the cone document (they can be stale).
     */
    matchesExpectedReturnContext,
  };
};

/**
 * Get cones currently in short-term storage for a given boxId.
 * Short-term definition: coneStorageId is set (non-empty) and cone is available
 * (i.e. not issued and not used).
 *
 * @param {string} boxId
 * @returns {Promise<Array>}
 */
export const getShortTermConesByBoxId = async (boxId) => {
  const trimmed = String(boxId || '').trim();
  if (!trimmed) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'boxId is required');
  }

  const cones = await YarnCone.find({
    boxId: trimmed,
    coneStorageId: { $exists: true, $nin: [null, ''] },
    issueStatus: { $nin: yarnConeUnavailableIssueStatuses },
    ...activeYarnConeMatch,
  })
    .populate({ path: 'yarnCatalogId', select: '_id yarnName yarnType status' })
    .sort({ createdAt: -1 })
    .lean();

  return cones;
};

/**
 * Get cones by storage location (coneStorageId). Returns all matching cones (no limit).
 * @param {string} storageLocation - coneStorageId to filter by
 * @returns {Promise<Array>} Cones with the given storage location
 */
export const getConesByStorageLocation = async (storageLocation) => {
  const escaped = String(storageLocation).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cones = await YarnCone.find({
    coneStorageId: { $regex: new RegExp(`^${escaped}$`, 'i') },
    ...activeYarnConeMatch,
  })
    .populate({ path: 'yarnCatalogId', select: '_id yarnName yarnType status' })
    .sort({ createdAt: -1 })
    .lean();
  return cones;
};

/**
 * Get cones without storage location (coneStorageId null, undefined, or empty).
 * Returns all matching cones (no limit).
 * @returns {Promise<Array>} Cones without storage location
 */
export const getConesWithoutStorageLocation = async () => {
  const cones = await YarnCone.find({
    ...activeYarnConeMatch,
    $or: [
      { coneStorageId: { $exists: false } },
      { coneStorageId: null },
      { coneStorageId: '' },
    ],
  })
    .populate({ path: 'yarnCatalogId', select: '_id yarnName yarnType status' })
    .sort({ createdAt: -1 })
    .lean();
  return cones;
};

/**
 * Bulk set storage location (coneStorageId) for cones that don't have one.
 * Accepts coneIds (MongoDB ObjectIds) or barcodes.
 * @param {Object} payload - { coneIds: string[], coneStorageId: string }
 * @returns {Promise<Object>} Updated cones and count
 */
export const bulkSetConeStorageLocation = async (payload) => {
  const { coneIds, coneStorageId } = payload;
  if (!coneIds || !Array.isArray(coneIds) || coneIds.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'coneIds array is required with at least one cone ID or barcode');
  }
  if (!coneStorageId || String(coneStorageId).trim() === '') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'coneStorageId is required');
  }

  const isObjectId = (s) => /^[a-fA-F0-9]{24}$/.test(String(s));
  const byId = coneIds.filter((id) => isObjectId(id));
  const byBarcode = coneIds.filter((id) => !isObjectId(id));
  const idFilter = [
    ...(byId.length ? [{ _id: { $in: byId.map((id) => new mongoose.Types.ObjectId(id)) } }] : []),
    ...(byBarcode.length ? [{ barcode: { $in: byBarcode } }] : []),
  ].filter(Boolean);
  if (idFilter.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'coneIds must be valid MongoDB ObjectIds or barcode strings');
  }

  const filter = {
    $and: [
      { $or: idFilter },
      {
        $or: [
          { coneStorageId: { $exists: false } },
          { coneStorageId: null },
          { coneStorageId: '' },
        ],
      },
      activeYarnConeMatch,
    ],
  };

  const result = await YarnCone.updateMany(filter, { $set: { coneStorageId: String(coneStorageId).trim() } });

  const updatedCones = await YarnCone.find({ $or: idFilter })
    .populate({ path: 'yarnCatalogId', select: '_id yarnName yarnType status' })
    .lean();
  return {
    message: `Updated storage location for ${result.modifiedCount} cone(s)`,
    modifiedCount: result.modifiedCount,
    cones: updatedCones,
  };
};

export const queryYarnCones = async (filters = {}) => {
  const includeInactive = filters.include_inactive === true || filters.include_inactive === 'true';
  const mongooseFilter = includeInactive ? {} : { ...activeYarnConeMatch };

  if (filters.po_number) {
    mongooseFilter.poNumber = filters.po_number;
  }

  if (filters.box_id) {
    mongooseFilter.boxId = filters.box_id;
  }

  if (filters.order_id) {
    mongooseFilter.orderId = filters.order_id;
  }

  if (filters.article_id) {
    mongooseFilter.articleId = filters.article_id;
  }

  if (filters.issue_status) {
    mongooseFilter.issueStatus = filters.issue_status;
  }

  if (filters.return_status) {
    mongooseFilter.returnStatus = filters.return_status;
  }

  if (filters.storage_id) {
    mongooseFilter.coneStorageId = filters.storage_id;
  }

  if (filters.yarn_name) {
    mongooseFilter.yarnName = { $regex: filters.yarn_name, $options: 'i' };
  }

  if (filters.yarn_id) {
    mongooseFilter.yarnCatalogId = filters.yarn_id;
  }

  if (filters.shade_code) {
    mongooseFilter.shadeCode = { $regex: filters.shade_code, $options: 'i' };
  }

  if (filters.barcode) {
    mongooseFilter.barcode = filters.barcode;
  }

  const yarnCones = await YarnCone.find(mongooseFilter)
    .populate({
      path: 'yarnCatalogId',
      select: '_id yarnName yarnType status',
    })
    .sort({ createdAt: -1 })
    .lean();

  return yarnCones;
};

export const generateConesByBox = async (boxId, options = {}) => {
  const yarnBox = await YarnBox.findOne({ boxId, ...activeYarnBoxMatch });

  if (!yarnBox) {
    throw new ApiError(httpStatus.NOT_FOUND, `Yarn box not found for boxId: ${boxId}`);
  }

  const existingConeCount = await YarnCone.countDocuments({ boxId: yarnBox.boxId, ...activeYarnConeMatch });
  const force = Boolean(options.force);

  if (existingConeCount > 0 && !force) {
    const existingCones = await YarnCone.find({ boxId: yarnBox.boxId, ...activeYarnConeMatch }).lean();
    const boxData = yarnBox.toObject();

    return {
      message: `Yarn cones already exist for box ${boxId}`,
      created: false,
      box: boxData,
      cones: existingCones,
    };
  }

  if (existingConeCount > 0 && force) {
    await YarnCone.deleteMany({ boxId: yarnBox.boxId, ...activeYarnConeMatch });
  }

  const numberOfCones =
    options.numberOfCones ??
    yarnBox.numberOfCones ??
    yarnBox?.coneData?.numberOfCones;

  if (!numberOfCones || numberOfCones <= 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Number of cones must be provided and greater than zero'
    );
  }

  const issueStatus = options.issueStatus ?? 'not_issued';
  if (!yarnConeIssueStatuses.includes(issueStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid issue status');
  }

  const returnStatus = options.returnStatus ?? 'not_returned';
  if (!yarnConeReturnStatuses.includes(returnStatus)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid return status');
  }

  const toDate = (value) => (value ? new Date(value) : undefined);
  const safeNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const derivedConeWeight = options.coneWeight ?? 0;

  const derivedTearWeight = options.tearWeight ?? 0;

  const derivedIssueWeight =
    options.issueWeight ?? derivedConeWeight ?? null;

  const derivedReturnWeight =
    options.returnWeight ?? derivedConeWeight ?? null;

  const derivedStorageId = options.coneStorageId ?? null;

  const basePayload = {
    poNumber: yarnBox.poNumber,
    boxId: yarnBox.boxId,
    coneWeight: derivedConeWeight,
    tearWeight: derivedTearWeight,
    yarnName: options.yarnName ?? yarnBox.yarnName ?? null,
    shadeCode: options.shadeCode ?? yarnBox.shadeCode ?? null,
    issueStatus,
    issueWeight: derivedIssueWeight,
    returnStatus,
    returnWeight: derivedReturnWeight,
    coneStorageId: derivedStorageId,
  };

  if (options.issuedBy) {
    basePayload.issuedBy = options.issuedBy;
  }

  if (options.issueDate) {
    basePayload.issueDate = toDate(options.issueDate);
  }

  if (options.returnBy) {
    basePayload.returnBy = options.returnBy;
  }

  if (options.returnDate) {
    basePayload.returnDate = toDate(options.returnDate);
  }

  if (options.yarnCatalogId ?? options.yarn) {
    basePayload.yarnCatalogId = options.yarnCatalogId ?? options.yarn;
  } else if (yarnBox.yarnCatalogId) {
    basePayload.yarnCatalogId = yarnBox.yarnCatalogId;
  }

  const conesToCreate = Array.from({ length: numberOfCones }, () => ({
    ...basePayload,
    barcode: new mongoose.Types.ObjectId().toString(),
  }));

  const createdCones = await YarnCone.insertMany(conesToCreate);

  // Only set numberOfCones when generating cone records. Do NOT set conesIssued/coneIssueDate
  // here — those mean "cones have been issued to production/ST"; they are set when cones
  // are actually moved to short-term storage (yarnCone post-save / storageSlot).
  yarnBox.set('numberOfCones', numberOfCones);
  yarnBox.set('coneData.numberOfCones', numberOfCones);

  await yarnBox.save();

  const updatedBox = await YarnBox.findById(yarnBox._id).lean();

  return {
    message: `Successfully created ${createdCones.length} cones for box ${boxId}`,
    created: true,
    box: updatedBox,
    cones: createdCones.map((cone) => cone.toObject()),
  };
};

/**
 * Return a yarn cone - handles two cases:
 * 1. Empty cone (no yarn left): updates weight to 0
 * 2. Cone with remaining yarn: updates weight and storage location
 * @param {String} barcode - Cone barcode
 * @param {Object} returnData - Return data (returnWeight, returnBy, returnDate, coneStorageId, orderId, articleId)
 * @returns {Promise<Object>} Updated cone
 */
export const returnYarnCone = async (barcode, returnData = {}) => {
  // Find cone by barcode
  const yarnCone = await YarnCone.findOne({ barcode, ...activeYarnConeMatch });
  
  if (!yarnCone) {
    throw new ApiError(httpStatus.NOT_FOUND, `Yarn cone with barcode ${barcode} not found`);
  }

  const ctxOrder = String(returnData.orderId ?? returnData.productionOrderId ?? '').trim();
  const ctxArticle = String(returnData.articleId ?? '').trim();
  if (ctxOrder || ctxArticle) {
    if (
      !ctxOrder ||
      !ctxArticle ||
      !mongoose.Types.ObjectId.isValid(ctxOrder) ||
      !mongoose.Types.ObjectId.isValid(ctxArticle)
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Return requires both orderId and articleId when validating production order/article (cone document fields may be stale).'
      );
    }
    const orderMatches = String(yarnCone.orderId || '') === ctxOrder;
    const articleMatches = String(yarnCone.articleId || '') === ctxArticle;
    if (!orderMatches || !articleMatches) {
      const hit = await findIssueTxnMatchingOrderArticle(yarnCone._id, ctxOrder, ctxArticle);
      if (!hit) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'This cone is not linked to the selected production order/article in yarn issue history.'
        );
      }
      yarnCone.orderId = new mongoose.Types.ObjectId(ctxOrder);
      yarnCone.articleId = new mongoose.Types.ObjectId(ctxArticle);
    }
  }

  // Validate that cone is issued
  if (yarnCone.issueStatus !== 'issued') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cone ${barcode} is not issued. Current status: ${yarnCone.issueStatus}`
    );
  }

  // Validate that cone is not already returned
  if (yarnCone.returnStatus === 'returned') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cone ${barcode} is already returned`
    );
  }

  // Get return weight (remaining weight after use)
  // If returnWeight is provided, use it; otherwise calculate from coneWeight and tearWeight
  const returnWeight = returnData.returnWeight !== undefined 
    ? returnData.returnWeight 
    : (yarnCone.coneWeight || 0) - (yarnCone.tearWeight || 0);

  if (returnWeight < 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Return weight cannot be negative. Calculated: ${returnWeight}`
    );
  }

  // Determine if cone is empty (no yarn left)
  const isEmpty = returnWeight === 0 || returnWeight < 0.01; // Consider < 0.01kg as empty

  // Update cone return information
  yarnCone.returnStatus = 'returned';
  yarnCone.returnDate = returnData.returnDate ? new Date(returnData.returnDate) : new Date();
  yarnCone.returnWeight = returnWeight;
  
  if (returnData.returnBy) {
    yarnCone.returnBy = returnData.returnBy;
  }

  // Handle two cases:
  if (isEmpty) {
    yarnCone.coneWeight = 0;
    yarnCone.tearWeight = 0;
    // Mark as used so UI / inventory can distinguish "consumed" from "fresh".
    // Pre-save hook will also enforce this, but we set it explicitly for clarity.
    yarnCone.issueStatus = 'used';
    // Pre-save hook clears coneStorageId when coneWeight is 0; no need to set it here.
  } else {
    yarnCone.coneWeight = returnWeight;
    yarnCone.tearWeight = 0;

    const coneStorageId = returnData.coneStorageId;
    if (coneStorageId && String(coneStorageId).trim() !== '') {
      yarnCone.coneStorageId = coneStorageId.trim();
    } else if (!yarnCone.coneStorageId || String(yarnCone.coneStorageId).trim() === '') {
      yarnCone.coneStorageId = `RETURNED-${yarnCone.barcode}`;
    }
  }

  // Save cone (post-save hook will automatically sync to inventory)
  await yarnCone.save();

  // Populate yarn info before returning
  await yarnCone.populate({
    path: 'yarnCatalogId',
    select: '_id yarnName yarnType status',
  });

  const message = isEmpty 
    ? `Cone ${barcode} returned empty (weight set to 0)`
    : `Cone ${barcode} returned with ${returnWeight}kg remaining yarn and stored in short-term storage`;

  return {
    cone: yarnCone.toObject(),
    isEmpty,
    message
  };
};


