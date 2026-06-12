import httpStatus from 'http-status';
import {
  Article,
  ArticleLog,
  M2Log,
  ProductionOrder,
  M2LogType,
  M2EntryStatus,
  LogAction,
} from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';
import { recordM3Entry } from './m3Management.service.js';
import { recordM4Entry } from './m4Management.service.js';
import {
  applyCascadeMergeIncrement,
  getCascadeFloorsForM2Merge,
  getSourceFloorKey,
  recalcQcFloorRemaining,
} from '../../utils/m2Cascade.util.js';
import {
  applyM2MergeBrandingFloorTransferData,
  buildSingleBrandM2MergeItems,
  formatM2MergeBrandRemarks,
  mergeTransferredDataByBrand,
  resolveM2MergeBrandContext,
  validateM2MergeBrandSplit,
} from '../../utils/brandQuantity.util.js';
import { getProductByCode } from '../product.service.js';

const M2_QC_FLOORS = ['Checking', 'Secondary Checking', 'Final Checking'];

/**
 * Resolve article by Mongo _id or custom id string.
 * @param {string} articleId
 * @returns {Promise<Object|null>}
 */
const findArticleById = async (articleId) => {
  const byMongo = await Article.findById(articleId);
  if (byMongo) return byMongo;
  return Article.findOne({ id: articleId });
};

/**
 * Resolve order number for denormalized log fields.
 * @param {Object} article
 * @returns {Promise<string>}
 */
const resolveOrderNumber = async (article) => {
  if (!article?.orderId) return '';
  const order = await ProductionOrder.findById(article.orderId).select('orderNumber').lean();
  return order?.orderNumber || '';
};

/**
 * Build user audit fields from request user.
 * @param {Object} user
 * @returns {Object}
 */
const userAuditFields = (user = {}) => ({
  userId: user?.id || user?.userId || user?._id?.toString?.() || 'system',
  userName: user?.name || user?.userName || '',
  userEmail: user?.email || user?.userEmail || '',
  floorSupervisorId: user?.id || user?.floorSupervisorId || 'system',
});

/**
 * Per-floor M2 open qty from ledger ENTRY rows.
 * @param {string} articleIdStr
 * @returns {Promise<number>}
 */
export const computeOpenM2Quantity = async (articleIdStr) => {
  const entries = await M2Log.find({
    articleId: articleIdStr,
    type: M2LogType.ENTRY,
    status: { $in: [M2EntryStatus.OPEN, M2EntryStatus.PARTIAL] },
  }).lean();
  return entries.reduce((s, e) => s + (e.remainingQuantity || 0), 0);
};

/**
 * Record an M2 ENTRY when QC floor M2 increases.
 * @param {Object} params
 * @returns {Promise<Object|null>}
 */
export const recordM2Entry = async ({
  article,
  sourceFloor,
  deltaQuantity,
  previousFloorTotal,
  newFloorTotal,
  user,
  remarks = '',
}) => {
  if (!article || !deltaQuantity || deltaQuantity <= 0) return null;

  const orderNumber = await resolveOrderNumber(article);
  const articleIdStr = article._id?.toString?.() ?? String(article._id);
  const orderIdStr = article.orderId?.toString?.() ?? String(article.orderId);
  const entryId = `M2ENTRY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const audit = userAuditFields(user);

  return M2Log.createLogEntry({
    type: M2LogType.ENTRY,
    entryId,
    status: M2EntryStatus.OPEN,
    originalQuantity: deltaQuantity,
    remainingQuantity: deltaQuantity,
    articleId: articleIdStr,
    orderId: orderIdStr,
    orderNumber,
    articleNumber: article.articleNumber || '',
    sourceFloor,
    quantity: deltaQuantity,
    remarks:
      remarks ||
      `M2 entry on ${sourceFloor}: +${deltaQuantity} (floor total ${previousFloorTotal} → ${newFloorTotal})`,
    ...audit,
  });
};

/**
 * Find M2 ENTRY log by entryId.
 * @param {string} entryId
 * @returns {Promise<Object|null>}
 */
const findM2EntryById = async (entryId) => {
  return M2Log.findOne({ entryId, type: M2LogType.ENTRY });
};

/**
 * Write per-floor article log for M2 cascade action.
 * @param {Object} params
 */
/**
 * Format QC floor snapshot for merge audit logs.
 * @param {Object} fd - floor data bucket
 * @returns {string}
 */
const formatQcFloorSnapshot = (fd) => {
  const m1 = fd?.m1Quantity || 0;
  const m1Trf = fd?.m1Transferred ?? fd?.transferred ?? 0;
  const m2 = fd?.m2Quantity || 0;
  const rem = fd?.remaining ?? 0;
  return `M1=${m1}, M1Trf=${m1Trf}, M2=${m2}, Rem=${rem}`;
};

const writeCascadeArticleLog = async ({
  article,
  orderIdStr,
  floorLabel,
  quantity,
  action,
  remarks,
  user,
  entryId,
  previousValue = null,
  newValue = null,
}) => {
  const audit = userAuditFields(user);
  await ArticleLog.createLogEntry({
    action,
    quantity,
    fromFloor: floorLabel,
    remarks: `${remarks} | merged=${quantity} | entryId=${entryId}`,
    orderId: orderIdStr,
    articleId: article._id.toString(),
    changeReason: 'M2 cascade resolution',
    previousValue,
    newValue,
    userId: audit.userId,
    floorSupervisorId: audit.floorSupervisorId,
  });
};

/**
 * Merge M2 entry qty to M1 across cascade floors.
 * @param {string} entryId
 * @param {Object} body
 * @param {Object} user
 * @returns {Promise<Object>}
 */
export const markM2MergeToM1 = async (entryId, body, user = {}) => {
  const { quantity, remarks, transferItems } = body;

  if (!remarks || !String(remarks).trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Remarks are required for merge');
  }
  if (!quantity || quantity <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Merge quantity must be greater than 0');
  }

  const entry = await findM2EntryById(entryId);
  if (!entry) {
    throw new ApiError(httpStatus.NOT_FOUND, 'M2 entry not found');
  }
  if (![M2EntryStatus.OPEN, M2EntryStatus.PARTIAL].includes(entry.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'M2 entry is already resolved');
  }
  if (quantity > entry.remainingQuantity) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot merge ${quantity}. Remaining: ${entry.remainingQuantity}`
    );
  }

  const article = await findArticleById(entry.articleId);
  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
  }

  const cascadeFloors = await getCascadeFloorsForM2Merge(article, entry.sourceFloor);
  const floorOrder = await article.getFloorOrder();
  const factoryCode = String(article.articleNumber ?? '').trim();
  const product = factoryCode ? await getProductByCode(factoryCode) : null;
  const productStyleCodes = (product?.styleCodes || []).map((sc) =>
    typeof sc?.toObject === 'function' ? sc.toObject() : sc
  );
  const brandContext = resolveM2MergeBrandContext(
    article,
    cascadeFloors,
    floorOrder,
    productStyleCodes
  );
  const brandRequired = brandContext.required;

  let normalizedTransferItems = [];
  if (brandRequired) {
    const itemsForValidation =
      brandContext.multiBrand
        ? transferItems
        : transferItems?.length
          ? transferItems
          : buildSingleBrandM2MergeItems(quantity, brandContext.autoAssignBrand);

    const validation = validateM2MergeBrandSplit(itemsForValidation, quantity, brandContext);
    if (!validation.valid) {
      throw new ApiError(httpStatus.BAD_REQUEST, validation.error);
    }
    normalizedTransferItems = validation.normalizedItems;
  } else if (Array.isArray(transferItems) && transferItems.length > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'transferItems are not supported for this article merge (article is not a branded process or has no catalog brands)'
    );
  }

  const orderNumber = await resolveOrderNumber(article);
  const orderIdStr = article.orderId.toString();
  const audit = userAuditFields(user);
  const brandRemark = brandRequired ? formatM2MergeBrandRemarks(normalizedTransferItems) : '';
  const trimmedRemarks = brandRemark
    ? `${String(remarks).trim()} | brands=${brandRemark}`
    : String(remarks).trim();

  const sourceFloorKey = getSourceFloorKey(article, entry.sourceFloor);
  const sourceFdBefore = article.floorQuantities?.[sourceFloorKey]
    ? { ...article.floorQuantities[sourceFloorKey] }
    : null;
  const previousValue = sourceFdBefore ? formatQcFloorSnapshot(sourceFdBefore) : null;

  for (const floorLabel of cascadeFloors) {
    applyCascadeMergeIncrement(article, floorLabel, quantity, entry.sourceFloor);
    const isSourceFloor = floorLabel === entry.sourceFloor;
    const newValue = isSourceFloor
      ? formatQcFloorSnapshot(article.floorQuantities?.[sourceFloorKey])
      : null;
    await writeCascadeArticleLog({
      article,
      orderIdStr,
      floorLabel,
      quantity,
      action: LogAction.M2_MERGED_TO_M1_CASCADE,
      remarks: trimmedRemarks,
      user,
      entryId,
      previousValue: isSourceFloor ? previousValue : null,
      newValue,
    });
  }

  if (brandRequired && normalizedTransferItems.length > 0) {
    if (!article.floorQuantities.finalChecking) {
      article.floorQuantities.finalChecking = {};
    }
    article.floorQuantities.finalChecking.transferredData = mergeTransferredDataByBrand(
      article.floorQuantities.finalChecking.transferredData,
      normalizedTransferItems
    );
    article.markModified('floorQuantities.finalChecking');

    applyM2MergeBrandingFloorTransferData(
      article,
      cascadeFloors,
      normalizedTransferItems,
      quantity,
      productStyleCodes
    );
  }

  const newRemaining = Math.max(0, entry.remainingQuantity - quantity);
  entry.remainingQuantity = newRemaining;
  entry.status =
    newRemaining === 0
      ? M2EntryStatus.RESOLVED
      : M2EntryStatus.PARTIAL;
  await entry.save();

  const resolutionLog = await M2Log.createLogEntry({
    type: M2LogType.MERGE_TO_M1,
    entryId,
    articleId: entry.articleId,
    orderId: orderIdStr,
    orderNumber,
    articleNumber: entry.articleNumber,
    sourceFloor: entry.sourceFloor,
    quantity,
    cascadeFloors,
    remarks: trimmedRemarks,
    ...audit,
  });

  await article.save();

  return { entry, resolutionLog, cascadeFloors, articleId: entry.articleId };
};

/**
 * Transfer M2 entry qty to M3 on source floor only.
 * @param {string} entryId
 * @param {Object} body
 * @param {Object} user
 * @returns {Promise<Object>}
 */
export const markM2TransferToM3 = async (entryId, body, user = {}) => {
  return markM2TransferToDefectCategory(entryId, body, user, 'M3');
};

/**
 * Transfer M2 entry qty to M4 on source floor only.
 * @param {string} entryId
 * @param {Object} body
 * @param {Object} user
 * @returns {Promise<Object>}
 */
export const markM2TransferToM4 = async (entryId, body, user = {}) => {
  return markM2TransferToDefectCategory(entryId, body, user, 'M4');
};

/**
 * Transfer M2 remaining qty to M3 or M4 on source QC floor.
 * @param {string} entryId
 * @param {Object} body
 * @param {Object} user
 * @param {'M3'|'M4'} category
 * @returns {Promise<Object>}
 */
async function markM2TransferToDefectCategory(entryId, body, user, category) {
  const { quantity, remarks } = body;

  if (!remarks || !String(remarks).trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Remarks are required');
  }
  if (!quantity || quantity <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Quantity must be greater than 0');
  }

  const entry = await findM2EntryById(entryId);
  if (!entry) {
    throw new ApiError(httpStatus.NOT_FOUND, 'M2 entry not found');
  }
  if (![M2EntryStatus.OPEN, M2EntryStatus.PARTIAL].includes(entry.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'M2 entry is already resolved');
  }
  if (quantity > entry.remainingQuantity) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot transfer ${quantity}. Remaining: ${entry.remainingQuantity}`
    );
  }

  const article = await findArticleById(entry.articleId);
  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
  }

  const floorKey = getSourceFloorKey(article, entry.sourceFloor);
  const fd = article.floorQuantities?.[floorKey];
  if (!fd) {
    throw new ApiError(httpStatus.BAD_REQUEST, `No floor data for ${entry.sourceFloor}`);
  }

  const prevM2 = fd.m2Quantity || 0;
  const prevCat = category === 'M3' ? fd.m3Quantity || 0 : fd.m4Quantity || 0;

  fd.m2Quantity = Math.max(0, prevM2 - quantity);
  if (category === 'M3') {
    fd.m3Quantity = prevCat + quantity;
  } else {
    fd.m4Quantity = prevCat + quantity;
  }
  recalcQcFloorRemaining(fd);

  const newRemaining = Math.max(0, entry.remainingQuantity - quantity);
  entry.remainingQuantity = newRemaining;
  entry.status = newRemaining === 0 ? M2EntryStatus.RESOLVED : M2EntryStatus.PARTIAL;
  await entry.save();

  const orderNumber = await resolveOrderNumber(article);
  const audit = userAuditFields(user);
  const trimmedRemarks = String(remarks).trim();
  const logType = category === 'M3' ? M2LogType.TRANSFER_TO_M3 : M2LogType.TRANSFER_TO_M4;
  const logAction =
    category === 'M3' ? LogAction.M2_TRANSFERRED_TO_M3 : LogAction.M2_TRANSFERRED_TO_M4;

  if (category === 'M3') {
    await recordM3Entry({
      article,
      sourceFloor: entry.sourceFloor,
      deltaQuantity: quantity,
      previousFloorTotal: prevCat,
      newFloorTotal: fd.m3Quantity,
      user,
      remarks: trimmedRemarks,
    });
  } else {
    await recordM4Entry({
      article,
      sourceFloor: entry.sourceFloor,
      deltaQuantity: quantity,
      previousFloorTotal: prevCat,
      newFloorTotal: fd.m4Quantity,
      user,
      remarks: trimmedRemarks,
    });
  }

  const resolutionLog = await M2Log.createLogEntry({
    type: logType,
    entryId,
    articleId: entry.articleId,
    orderId: article.orderId.toString(),
    orderNumber,
    articleNumber: entry.articleNumber,
    sourceFloor: entry.sourceFloor,
    quantity,
    remarks: trimmedRemarks,
    ...audit,
  });

  await ArticleLog.createLogEntry({
    action: logAction,
    quantity,
    fromFloor: entry.sourceFloor,
    remarks: `${trimmedRemarks} | entryId=${entryId}`,
    orderId: article.orderId.toString(),
    articleId: article._id.toString(),
    userId: audit.userId,
    floorSupervisorId: audit.floorSupervisorId,
  });

  await article.save();

  return { entry, resolutionLog };
}

/**
 * Paginated open M2 entries for management screen.
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getM2Entries = async (filter = {}, options = {}) => {
  const logFilter = {
    type: M2LogType.ENTRY,
  };

  if (filter.status) {
    logFilter.status = filter.status;
  } else if (filter.includeResolved !== 'true') {
    logFilter.status = { $in: [M2EntryStatus.OPEN, M2EntryStatus.PARTIAL] };
  }

  if (filter.articleId) logFilter.articleId = filter.articleId;
  if (filter.orderId) logFilter.orderId = filter.orderId;
  if (filter.sourceFloor) logFilter.sourceFloor = filter.sourceFloor;

  if (filter.search) {
    const q = filter.search.trim();
    logFilter.$or = [
      { orderNumber: { $regex: q, $options: 'i' } },
      { articleNumber: { $regex: q, $options: 'i' } },
      { entryId: { $regex: q, $options: 'i' } },
      { userName: { $regex: q, $options: 'i' } },
      { userEmail: { $regex: q, $options: 'i' } },
    ];
  }

  return M2Log.paginate(logFilter, {
    ...options,
    sortBy: options.sortBy || 'timestamp:desc',
  });
};

/**
 * Paginated M2 ledger logs.
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getM2Logs = async (filter = {}, options = {}) => {
  const logFilter = {};
  if (filter.articleId) logFilter.articleId = filter.articleId;
  if (filter.orderId) logFilter.orderId = filter.orderId;
  if (filter.type) logFilter.type = filter.type;
  if (filter.sourceFloor) logFilter.sourceFloor = filter.sourceFloor;
  if (filter.entryId) logFilter.entryId = filter.entryId;
  if (filter.dateFrom || filter.dateTo) {
    logFilter.timestamp = {};
    if (filter.dateFrom) logFilter.timestamp.$gte = new Date(filter.dateFrom);
    if (filter.dateTo) {
      const end = new Date(filter.dateTo);
      end.setHours(23, 59, 59, 999);
      logFilter.timestamp.$lte = end;
    }
  }
  if (filter.search) {
    const q = filter.search.trim();
    logFilter.$or = [
      { orderNumber: { $regex: q, $options: 'i' } },
      { articleNumber: { $regex: q, $options: 'i' } },
      { remarks: { $regex: q, $options: 'i' } },
      { entryId: { $regex: q, $options: 'i' } },
    ];
  }
  return M2Log.paginate(logFilter, {
    ...options,
    sortBy: options.sortBy || 'timestamp:desc',
  });
};

/**
 * M2 summary for one article.
 * @param {string} articleId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getM2ArticleSummary = async (articleId, options = {}) => {
  const article = await findArticleById(articleId);
  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
  }
  const orderNumber = await resolveOrderNumber(article);
  const articleIdStr = article._id.toString();
  const logLimit = options.logLimit || 30;

  const [entries, recentLogs, openQty] = await Promise.all([
    M2Log.find({ articleId: articleIdStr, type: M2LogType.ENTRY })
      .sort({ timestamp: -1 })
      .limit(logLimit)
      .lean(),
    M2Log.find({ articleId: articleIdStr }).sort({ timestamp: -1 }).limit(logLimit).lean(),
    computeOpenM2Quantity(articleIdStr),
  ]);

  return {
    id: article.id,
    _id: article._id,
    articleNumber: article.articleNumber,
    orderId: article.orderId,
    orderNumber,
    openM2Quantity: openQty,
    entries,
    recentLogs,
  };
};

/**
 * KPI stats for M2 Management dashboard.
 * @returns {Promise<Object>}
 */
export const getM2Statistics = async () => {
  const [openEntries, partialEntries, resolvedCount, totalOpenQty] = await Promise.all([
    M2Log.countDocuments({ type: M2LogType.ENTRY, status: M2EntryStatus.OPEN }),
    M2Log.countDocuments({ type: M2LogType.ENTRY, status: M2EntryStatus.PARTIAL }),
    M2Log.countDocuments({ type: M2LogType.ENTRY, status: M2EntryStatus.RESOLVED }),
    M2Log.aggregate([
      { $match: { type: M2LogType.ENTRY, status: { $in: [M2EntryStatus.OPEN, M2EntryStatus.PARTIAL] } } },
      { $group: { _id: null, total: { $sum: '$remainingQuantity' } } },
    ]),
  ]);

  return {
    openEntryCount: openEntries,
    partialEntryCount: partialEntries,
    resolvedEntryCount: resolvedCount,
    totalOpenQuantity: totalOpenQty[0]?.total || 0,
  };
};

export { M2_QC_FLOORS };
