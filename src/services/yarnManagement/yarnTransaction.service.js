import mongoose from 'mongoose';
import httpStatus from 'http-status';
import { YarnTransaction, YarnInventory, YarnCatalog, YarnRequisition, YarnCone } from '../../models/index.js';
import {
  ProductionOrder,
  Article,
  MachineOrderAssignment,
  ArticleLog,
  LogAction,
} from '../../models/production/index.js';
import Product from '../../models/product.model.js';
import ApiError from '../../utils/ApiError.js';
import { pickYarnCatalogId } from '../../utils/yarnCatalogRef.js';
import { loadLatestIssueTransactionContextForCone } from './yarnCone.service.js';

/**
 * Produces an inventory bucket with all numeric values initialised to zero.
 */
const ZERO_BUCKET = () => ({
  totalWeight: 0,
  numberOfCones: 0,
  totalTearWeight: 0,
  netWeight: 0,
});

const toNumber = (value) => Number(value ?? 0);

/**
 * Makes sure the requested inventory bucket exists and contains numeric values.
 */
const ensureBucket = (inventory, key) => {
  if (!inventory[key]) {
    inventory[key] = ZERO_BUCKET();
  }
  inventory[key].totalWeight = toNumber(inventory[key].totalWeight);
  inventory[key].numberOfCones = toNumber(inventory[key].numberOfCones);
  inventory[key].totalTearWeight = toNumber(inventory[key].totalTearWeight);
  inventory[key].netWeight = toNumber(inventory[key].netWeight);
  return inventory[key];
};

/**
 * Adds the provided delta to the bucket. Ensures values don't go negative.
 */
const applyDelta = (bucket, delta, bucketName) => {
  bucket.totalWeight += toNumber(delta.totalWeight);
  bucket.totalTearWeight += toNumber(delta.totalTearWeight);
  bucket.netWeight += toNumber(delta.totalNetWeight);
  bucket.numberOfCones += toNumber(delta.numberOfCones);
  
  // Ensure values don't go negative
  bucket.totalWeight = Math.max(0, bucket.totalWeight);
  bucket.totalTearWeight = Math.max(0, bucket.totalTearWeight);
  bucket.netWeight = Math.max(0, bucket.netWeight);
  bucket.numberOfCones = Math.max(0, bucket.numberOfCones);
};

/**
 * Rebuilds the total inventory bucket based on short- and long-term buckets.
 */
const recalcTotalInventory = (inventory) => {
  const longTerm = ensureBucket(inventory, 'longTermInventory');
  const shortTerm = ensureBucket(inventory, 'shortTermInventory');
  const total = ensureBucket(inventory, 'totalInventory');

  total.totalWeight = toNumber(longTerm.totalWeight) + toNumber(shortTerm.totalWeight);
  total.totalTearWeight = toNumber(longTerm.totalTearWeight) + toNumber(shortTerm.totalTearWeight);
  total.netWeight = toNumber(longTerm.netWeight) + toNumber(shortTerm.netWeight);
  total.numberOfCones = toNumber(longTerm.numberOfCones) + toNumber(shortTerm.numberOfCones);
};

/**
 * Normalises client payload into the fields stored on the transaction document.
 * The API accepts camelCase convenience fields (e.g. totalWeight) and maps them
 * into the schema-specific properties. Block transactions rely on totalBlockedWeight.
 */
export const normaliseTransactionPayload = (inputBody) => {
  const body = { ...inputBody };
  const isBlocked = body.transactionType === 'yarn_blocked';

  const totalWeight = body.totalWeight ?? body.transactionTotalWeight;
  const totalNetWeight = body.totalNetWeight ?? body.transactionNetWeight;
  const totalTearWeight =
    body.totalTearWeight ?? body.transactionTearWeight ?? (totalWeight != null && totalNetWeight != null
      ? Math.max(toNumber(totalWeight) - toNumber(totalNetWeight), 0)
      : undefined);
  const numberOfCones = body.numberOfCones ?? body.transactionConeCount;

  const catalogId = pickYarnCatalogId(body);
  const rawBatchId = body.issueBatchId;
  const issueBatchId =
    typeof rawBatchId === 'string' && rawBatchId.trim() ? rawBatchId.trim() : undefined;

  const payload = {
    yarnCatalogId: catalogId,
    yarnName: body.yarnName,
    transactionType: body.transactionType,
    transactionDate: body.transactionDate,
    transactionNetWeight: 0,
    transactionTotalWeight: 0,
    transactionTearWeight: 0,
    transactionConeCount: 0,
    orderId: body.orderId || undefined,
    orderno: body.orderno,
    articleId: body.articleId || undefined,
    articleNumber: body.articleNumber,
    machineId: body.machineId || undefined,
    // Transfer tracking fields
    boxIds: body.boxIds || [],
    conesIdsArray: body.conesIdsArray || [],
    fromStorageLocation: body.fromStorageLocation,
    toStorageLocation: body.toStorageLocation,
    ...(issueBatchId ? { issueBatchId } : {}),
  };

  if (isBlocked) {
    const blockedWeight = body.totalBlockedWeight ?? body.transactionNetWeight ?? 0;
    payload.transactionNetWeight = toNumber(blockedWeight);
    payload.transactionTotalWeight = toNumber(blockedWeight);
    payload.transactionTearWeight = 0;
    payload.transactionConeCount = 0;
  } else {
    payload.transactionNetWeight = toNumber(totalNetWeight);
    payload.transactionTotalWeight = toNumber(totalWeight);
    payload.transactionTearWeight = toNumber(totalTearWeight);
    payload.transactionConeCount = toNumber(numberOfCones);
  }

  return payload;
};

/**
 * Loads or creates the YarnInventory document for the provided yarn reference.
 * @param {mongoose.ClientSession | null} session - Optional session for transaction support.
 */
const ensureInventoryDocument = async (session, transactionPayload) => {
  let query = YarnInventory.findOne({ yarnCatalogId: transactionPayload.yarnCatalogId });
  if (session) query = query.session(session);
  let inventory = await query;

  if (!inventory) {
    inventory = new YarnInventory({
      yarnCatalogId: transactionPayload.yarnCatalogId,
      yarnName: transactionPayload.yarnName,
      totalInventory: ZERO_BUCKET(),
      longTermInventory: ZERO_BUCKET(),
      shortTermInventory: ZERO_BUCKET(),
      blockedNetWeight: 0,
      inventoryStatus: 'in_stock',
    });
  } else if (!inventory.yarnName) {
    inventory.yarnName = transactionPayload.yarnName;
  }

  ensureBucket(inventory, 'longTermInventory');
  ensureBucket(inventory, 'shortTermInventory');
  ensureBucket(inventory, 'totalInventory');

  inventory.blockedNetWeight = toNumber(inventory.blockedNetWeight);

  return inventory;
};

/**
 * Applies the transaction delta to inventory buckets. Negative values are allowed.
 */
const updateInventoryBuckets = (inventory, transaction) => {
  const delta = {
    totalWeight: transaction.transactionTotalWeight,
    totalTearWeight: transaction.transactionTearWeight,
    totalNetWeight: transaction.transactionNetWeight,
    numberOfCones: transaction.transactionConeCount,
  };

  switch (transaction.transactionType) {
    case 'yarn_issued':
    case 'yarn_issued_linking':
    case 'yarn_issued_sampling': {
      // Physical yarn leaves short-term storage; blocked reservations are released.
      applyDelta(
        inventory.shortTermInventory,
        {
          totalWeight: -delta.totalWeight,
          totalTearWeight: -delta.totalTearWeight,
          totalNetWeight: -delta.totalNetWeight,
          numberOfCones: -delta.numberOfCones,
        },
        'short-term inventory'
      );
      // Ensure blockedNetWeight never goes negative
      inventory.blockedNetWeight = Math.max(0, toNumber(inventory.blockedNetWeight) - toNumber(delta.totalNetWeight));
      break;
    }
    case 'yarn_blocked': {
      // Blocked yarn stays in place; we only track the reservation weight.
      inventory.blockedNetWeight = toNumber(inventory.blockedNetWeight) + toNumber(delta.totalNetWeight);
      break;
    }
    case 'yarn_stocked': {
      // Newly stocked yarn is assumed to land in long-term storage.
      // Long-term storage: Only weight (boxes), NO cones (cones are created when boxes are opened/transferred to ST)
      applyDelta(
        inventory.longTermInventory,
        {
          totalWeight: delta.totalWeight,
          totalTearWeight: delta.totalTearWeight,
          totalNetWeight: delta.totalNetWeight,
          numberOfCones: 0, // Boxes in LT storage don't have individual cones
        },
        'long-term inventory'
      );
      break;
    }
    case 'internal_transfer': {
      // Inventory moves from long-term to short-term staging areas.
      applyDelta(
        inventory.longTermInventory,
        {
          totalWeight: -delta.totalWeight,
          totalTearWeight: -delta.totalTearWeight,
          totalNetWeight: -delta.totalNetWeight,
          numberOfCones: -delta.numberOfCones,
        },
        'long-term inventory'
      );
      applyDelta(inventory.shortTermInventory, delta, 'short-term inventory');
      break;
    }
    case 'yarn_returned': {
      // Returned yarn is restaged into short-term storage for inspection/use.
      applyDelta(inventory.shortTermInventory, delta, 'short-term inventory');
      break;
    }
    default:
      break;
  }

  recalcTotalInventory(inventory);
};

/**
 * Adjusts the inventory status (in_stock / low / soon) and raises/updates a yarn requisition
 * whenever we breach thresholds or block more yarn than is available.
 */
const updateInventoryStatusAndMaybeRaiseRequisition = async (
  session,
  inventory,
  yarnDoc,
  trigger
) => {
  const totalNet = toNumber(inventory.totalInventory?.totalNetWeight || 0);
  const blockedNet = Math.max(0, toNumber(inventory.blockedNetWeight || 0)); // Ensure non-negative
  const availableNet = Math.max(totalNet - blockedNet, 0);
  const minQty = toNumber(yarnDoc?.minQuantity || 0);

  let newStatus = 'in_stock';
  if (minQty > 0) {
    if (totalNet <= minQty) {
      newStatus = 'low_stock';
    } else if (totalNet <= minQty * 1.2) {
      newStatus = 'soon_to_be_low';
    }
  }
  inventory.inventoryStatus = newStatus;
  inventory.overbooked = blockedNet > totalNet;

  const shouldRaiseRequisition =
    inventory.overbooked ||
    newStatus === 'low_stock' ||
    newStatus === 'soon_to_be_low' ||
    trigger === 'overbooked';

  if (!shouldRaiseRequisition) {
    return;
  }

  const alertStatus = inventory.overbooked ? 'overbooked' : 'below_minimum';

  const updateOptions = {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  };
  if (session) updateOptions.session = session;

  await YarnRequisition.findOneAndUpdate(
    { yarnCatalogId: inventory.yarnCatalogId, poSent: false, dismissed: { $ne: true } },
    {
      yarnCatalogId: inventory.yarnCatalogId,
      yarnName: inventory.yarnName,
      minQty,
      availableQty: availableNet,
      blockedQty: blockedNet,
      alertStatus,
      poSent: false,
    },
    updateOptions
  );
};

/**
 * When a block is requested we flag the inventory so downstream logic can mark it overbooked.
 */
const validateBlockedDoesNotExceedInventory = (inventory, transaction) => {
  if (transaction.transactionType !== 'yarn_blocked') {
    return;
  }
  const totalNet = toNumber(inventory.totalInventory?.totalNetWeight || 0);
  const blockedWeight = transaction.transactionNetWeight;

  if (blockedWeight > totalNet) {
    // Flag as overbooked; handled downstream by status updater.
    inventory.overbooked = true;
  }
};

/**
 * Runs the transaction-creation logic either inside a MongoDB transaction (replica set / mongos)
 * or without a session (standalone MongoDB). On standalone, we run the same steps so the feature
 * works; writes are not atomic, so a mid-failure can leave partial state.
 */
export const runCreateTransactionLogic = async (session, normalisedPayload) => {
  const opts = session ? { session } : {};
  const withSession = (q) => (session ? q.session(session) : q);

  const yarnDoc = await withSession(YarnCatalog.findById(normalisedPayload.yarnCatalogId)).exec();
  if (!yarnDoc) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Referenced yarn catalog entry does not exist');
  }

  const inventory = await ensureInventoryDocument(session, normalisedPayload);

  const [transaction] = await YarnTransaction.create([normalisedPayload], opts);
  const transactionRecord = transaction;

  validateBlockedDoesNotExceedInventory(inventory, transaction);
  updateInventoryBuckets(inventory, transaction);

  await updateInventoryStatusAndMaybeRaiseRequisition(
    session,
    inventory,
    yarnDoc,
    inventory.overbooked ? 'overbooked' : undefined
  );

  await inventory.save(opts);
  return transactionRecord;
};

/**
 * Creates a yarn transaction and atomically updates inventory, status, and requisition data.
 * Uses a MongoDB transaction when connected to a replica set or mongos; otherwise runs
 * the same logic without a session (standalone MongoDB).
 */
export const createYarnTransaction = async (transactionBody) => {
  const normalisedPayload = normaliseTransactionPayload(transactionBody);
  if (!normalisedPayload.yarnCatalogId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'yarnCatalogId (or legacy yarn) is required');
  }

  const session = await mongoose.startSession();
  let transactionRecord;

  try {
    await session.withTransaction(async () => {
      transactionRecord = await runCreateTransactionLogic(session, normalisedPayload);
    });
  } catch (err) {
    const isStandaloneTransactionError =
      err.message && err.message.includes('Transaction numbers are only allowed on a replica set member or mongos');
    if (isStandaloneTransactionError) {
      await session.endSession();
      transactionRecord = await runCreateTransactionLogic(null, normalisedPayload);
      return transactionRecord;
    }
    await session.endSession();
    throw err;
  }

  await session.endSession();
  return transactionRecord;
};

/**
 * Loads a single yarn transaction by MongoDB _id with populated refs (same shape as list endpoints).
 */
export const getYarnTransactionById = async (transactionId) => {
  if (!mongoose.Types.ObjectId.isValid(transactionId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid yarn transaction id');
  }

  const transaction = await YarnTransaction.findById(transactionId)
    .populate({
      path: 'yarnCatalogId',
      select: '_id yarnName yarnType status',
    })
    .populate({ path: 'orderId', select: 'orderNumber' })
    .populate({ path: 'articleId', select: 'articleNumber orderId machineId' })
    .populate({ path: 'machineId', select: 'machineCode machineNumber model floor' })
    .lean();

  if (!transaction) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Yarn transaction not found');
  }

  return transaction;
};

/**
 * Escapes user input for safe use inside MongoDB `$regex`.
 * @param {string} str
 * @returns {string}
 */
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const queryYarnTransactions = async (filters = {}) => {
  const mongooseFilter = {};

  if (filters.transaction_type) {
    const parts = String(filters.transaction_type)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 1) {
      mongooseFilter.transactionType = parts[0];
    } else if (parts.length > 1) {
      mongooseFilter.transactionType = { $in: parts };
    }
  }

  if (filters.yarn_id) {
    mongooseFilter.yarnCatalogId = filters.yarn_id;
  }

  if (filters.yarn_name) {
    const trimmed = String(filters.yarn_name).trim();
    if (trimmed) {
      mongooseFilter.yarnName = { $regex: escapeRegex(trimmed), $options: 'i' };
    }
  }

  if (filters.order_id) {
    mongooseFilter.orderId = filters.order_id;
  }

  if (filters.orderno) {
    mongooseFilter.orderno = { $regex: filters.orderno, $options: 'i' };
  }

  if (filters.article_id) {
    mongooseFilter.articleId = filters.article_id;
  }

  if (filters.article_number) {
    mongooseFilter.articleNumber = { $regex: filters.article_number, $options: 'i' };
  }

  if (filters.start_date || filters.end_date) {
    mongooseFilter.transactionDate = {};
    if (filters.start_date) {
      const start = new Date(filters.start_date);
      start.setHours(0, 0, 0, 0);
      mongooseFilter.transactionDate.$gte = start;
    }
    if (filters.end_date) {
      const end = new Date(filters.end_date);
      end.setHours(23, 59, 59, 999);
      mongooseFilter.transactionDate.$lte = end;
    }
  }

  if (filters.issue_batch_id) {
    const ib = String(filters.issue_batch_id).trim();
    if (ib) {
      mongooseFilter.issueBatchId = ib;
    }
  }

  const light =
    filters.light === true ||
    filters.light === 'true' ||
    filters.light === '1' ||
    filters.light === 1;

  /** Fields needed for floor-issue history / exports (skip heavy joins). */
  const LIGHT_SELECT =
    '_id transactionType transactionDate yarnName transactionNetWeight transactionTotalWeight transactionTearWeight transactionConeCount conesIdsArray issuedByEmail issueBatchId createdAt';

  const applyPopulateAndSort = (q) => {
    let chain = light ? q.select(LIGHT_SELECT) : q;
    chain = chain.sort({ transactionDate: -1 });
    if (light) {
      return chain.populate({ path: 'conesIdsArray', select: 'barcode boxId yarnName' });
    }
    return chain
      .populate({
        path: 'yarnCatalogId',
        select: '_id yarnName yarnType status',
      })
      .populate({ path: 'orderId', select: 'orderNumber' })
      .populate({ path: 'articleId', select: 'articleNumber orderId machineId' })
      .populate({ path: 'machineId', select: 'machineCode machineNumber model floor' })
      .populate({ path: 'conesIdsArray', select: 'barcode boxId yarnName' });
  };

  const paged =
    filters.paged === true ||
    filters.paged === 'true' ||
    filters.paged === '1' ||
    filters.paged === 1;

  if (paged) {
    const page = Math.max(1, parseInt(String(filters.page), 10) || 1);
    const limitRaw = parseInt(String(filters.limit), 10) || 20;
    const limit = Math.min(Math.max(limitRaw, 1), 100);
    const skip = (page - 1) * limit;

    const [results, totalResults] = await Promise.all([
      applyPopulateAndSort(YarnTransaction.find(mongooseFilter)).skip(skip).limit(limit).lean(),
      YarnTransaction.countDocuments(mongooseFilter),
    ]);

    return {
      results,
      page,
      limit,
      totalResults,
      totalPages: Math.max(1, Math.ceil(totalResults / limit)),
    };
  }

  const transactions = await applyPopulateAndSort(YarnTransaction.find(mongooseFilter)).lean();
  return transactions;
};

const ARTICLE_SLICE_ISSUE_TYPES = ['yarn_issued', 'yarn_issued_linking', 'yarn_issued_sampling'];

/**
 * @param {unknown} coneRef
 * @returns {string|null}
 */
const coneDocIdFromRef = (coneRef) => {
  if (coneRef == null || coneRef === '') return null;
  if (typeof coneRef === 'object' && coneRef !== null && '_id' in coneRef) {
    const id = /** @type {{ _id?: unknown }} */ (coneRef)._id;
    return mongoose.Types.ObjectId.isValid(id) ? String(id) : null;
  }
  return mongoose.Types.ObjectId.isValid(coneRef) ? String(coneRef) : null;
};

/** @param {unknown} value */
const toIsoStringOrNull = (value) => {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(/** @type {string | number | Date} */ (value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
};

/**
 * When knitting output is transferred to linking, creation of this log equals “knitting done” timing for BI/UI.
 *
 * @param {string} articleIdStr
 * @returns {Promise<string|null>}
 */
const resolveKnittingCompletedAtIso = async (articleIdStr) => {
  const fromKnit = [{ fromFloor: { $regex: /^knitting$/i } }];
  /** @type {Record<string, unknown>|null} */
  const transferOut = await ArticleLog.findOne({
    articleId: articleIdStr,
    action: LogAction.TRANSFERRED_TO_LINKING,
    $or: fromKnit,
  })
    .sort({ timestamp: -1, date: -1, createdAt: -1 })
    .select('timestamp date createdAt')
    .lean();

  if (transferOut) {
    const ts =
      /** @type {Date | undefined} */ (transferOut.timestamp) ??
      /** @type {Date | undefined} */ (transferOut.date) ??
      /** @type {Date | undefined} */ (transferOut.createdAt);
    const iso = toIsoStringOrNull(ts);
    if (iso) return iso;
  }

  return null;
};

/**
 * Read path: issued + returned yarn transactions for one PO + article, merged to cone-level status.
 * Matches legacy `orderno` rows the same way as `getYarnIssuedByOrder` / `queryYarnTransactions` + `order_id`.
 *
 * Cones still `Awaiting` after txn merge are checked against YarnCone: `issueStatus: used` +
 * `returnStatus: not_returned` means yarn was fully consumed / zero-weight bypass — treat as `Consumed`
 * (not pending return), consistent with shop floor when no `yarn_returned` row exists.
 *
 * Cones still listed after txn grouping are filtered by **latest yarn issue txn** per cone: if that txn
 * resolves to a different PO/article than this slice, the cone is dropped (fixes wrong `conesIdsArray`
 * or BOM routing attaching another order’s cone to this article).
 *
 * **YarnCone reconciliation:** pending return (`Awaiting`) requires `issueStatus === 'issued'`. Cones with
 * `issueStatus: used` + `returnStatus: not_returned` are `Consumed` (zero-weight / bypass without txn). Cones
 * with any other non-issued state (e.g. `not_issued` after return/bypass when no `yarn_returned` row) are
 * `Closed` so they are not counted as pending even though issue history exists.
 *
 * @param {{ orderId: string; articleId?: string; articleNumber?: string }} params
 */
export const getArticleReturnSlice = async ({ orderId, articleId, articleNumber }) => {
  const poIdStr = String(orderId ?? '').trim();
  if (!mongoose.Types.ObjectId.isValid(poIdStr)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid order_id');
  }
  const poOid = new mongoose.Types.ObjectId(poIdStr);

  const po = await ProductionOrder.findById(poOid).select('_id orderNumber currentFloor').lean();
  if (!po) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  }

  const ordRe = new RegExp(`^${escapeRegex(String(po.orderNumber ?? '').trim())}$`, 'i');
  const orderScope = { $or: [{ orderId: po._id }, { orderno: ordRe }] };

  const sliceTypes = [...ARTICLE_SLICE_ISSUE_TYPES, 'yarn_returned'];
  const mongooseFilter = {
    $and: [{ ...orderScope }, { transactionType: { $in: sliceTypes } }],
  };

  const transactions = await YarnTransaction.find(mongooseFilter)
    .populate({
      path: 'yarnCatalogId',
      select: '_id yarnName yarnType status',
    })
    .populate({ path: 'orderId', select: 'orderNumber' })
    .populate({ path: 'articleId', select: 'articleNumber orderId machineId' })
    .populate({ path: 'machineId', select: 'machineCode machineNumber model floor' })
    .populate({
      path: 'conesIdsArray',
      select: 'barcode boxId yarnName _id articleId',
      populate: { path: 'articleId', select: 'articleNumber' },
    })
    .sort({ transactionDate: -1 })
    .lean();

  let articleDoc = null;
  const aidTrim = articleId ? String(articleId).trim() : '';
  if (aidTrim && mongoose.Types.ObjectId.isValid(aidTrim)) {
    articleDoc = await Article.findOne({
      _id: new mongoose.Types.ObjectId(aidTrim),
      orderId: po._id,
    })
      .select('articleNumber knittingCode completedAt machineId _id')
      .lean();
  }

  const numTrim = articleNumber ? String(articleNumber).trim() : '';
  if (!articleDoc && numTrim) {
    const numRe = new RegExp(`^${escapeRegex(numTrim)}$`, 'i');
    articleDoc = await Article.findOne({
      orderId: po._id,
      articleNumber: numRe,
    })
      .select('articleNumber knittingCode completedAt machineId _id')
      .lean();
  }

  if (!articleDoc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found for this production order');
  }

  const groups = await groupTransactionsByArticle(transactions, { orderId: po._id });

  const targetKey = String(articleDoc.articleNumber ?? '').trim().toLowerCase();
  /** @type {Record<string, unknown>[]|undefined} */
  const matchingGroupTx = groups.find((g) => String(g.articleNumber ?? '').trim().toLowerCase() === targetKey)
    ?.transactions;

  const articleTxList = Array.isArray(matchingGroupTx) ? matchingGroupTx : [];

  /** @type {Map<string, { id: string; barcode: string; yarnName: string; status: 'Awaiting' | 'Returned' | 'Consumed' | 'Closed' }>} */
  const coneById = new Map();

  const issueTypesSet = new Set(ARTICLE_SLICE_ISSUE_TYPES);
  /** Oldest-first so the first barcode/yarn captured matches typical “issued” snapshots */
  const chronIssue = [...articleTxList].filter((t) => issueTypesSet.has(t.transactionType));
  chronIssue.sort((a, b) => {
    const da = new Date(a.transactionDate || 0).getTime();
    const db = new Date(b.transactionDate || 0).getTime();
    return da - db;
  });

  for (const tx of chronIssue) {
    const arr = tx.conesIdsArray;
    if (!Array.isArray(arr)) continue;
    for (const cref of arr) {
      const id = coneDocIdFromRef(cref);
      if (!id || coneById.has(id)) continue;
      const obj = typeof cref === 'object' && cref !== null ? cref : {};
      const yarnFromCone =
        'yarnName' in obj && obj.yarnName != null && String(obj.yarnName).trim() !== ''
          ? String(obj.yarnName)
          : '';
      const barcode = 'barcode' in obj && obj.barcode != null ? String(obj.barcode) : '';
      coneById.set(id, {
        id,
        barcode,
        yarnName: yarnFromCone || String(tx.yarnName || ''),
        status: /** @type {const} */ ('Awaiting'),
      });
    }
  }

  /** Remove cones whose authoritative latest issue txn is a different PO/article than this slice. */
  const sliceOrderIdStr = String(po._id);
  const sliceArticleIdStr = String(articleDoc._id);
  const candidateIds = [...coneById.keys()];
  const latestCtxList = await Promise.all(candidateIds.map((coneKey) => loadLatestIssueTransactionContextForCone(coneKey)));
  for (let i = 0; i < candidateIds.length; i += 1) {
    const coneKey = candidateIds[i];
    const ctx = latestCtxList[i];
    if (!ctx?.orderId || !ctx?.articleId) continue;
    if (String(ctx.orderId) !== sliceOrderIdStr || String(ctx.articleId) !== sliceArticleIdStr) {
      coneById.delete(coneKey);
    }
  }

  /** Newest-first returns win if a cone appears in multiple returns */
  const chronReturn = [...articleTxList].filter((t) => t.transactionType === 'yarn_returned');
  chronReturn.sort((a, b) => {
    const da = new Date(a.transactionDate || 0).getTime();
    const db = new Date(b.transactionDate || 0).getTime();
    return db - da;
  });

  for (const tx of chronReturn) {
    const arr = tx.conesIdsArray;
    if (!Array.isArray(arr)) continue;
    for (const cref of arr) {
      const id = coneDocIdFromRef(cref);
      if (!id || !coneById.has(id)) continue;
      const row = coneById.get(id);
      if (!row) continue;
      row.status = /** @type {const} */ ('Returned');
      const obj = typeof cref === 'object' && cref !== null ? cref : {};
      const yarnFromCone =
        'yarnName' in obj && obj.yarnName != null && String(obj.yarnName).trim() !== ''
          ? String(obj.yarnName)
          : '';
      const barcode = 'barcode' in obj && obj.barcode != null ? String(obj.barcode) : '';
      if (yarnFromCone && !row.yarnName) row.yarnName = yarnFromCone;
      if (barcode && !row.barcode) row.barcode = barcode;
    }
  }

  /**
   * Align with live YarnCone: only `issueStatus: issued` can be pending return. Bypass / return flows that
   * reset the cone without a `yarn_returned` txn leave `not_issued` (or `used` + not_returned); do not count
   * those as Awaiting.
   */
  const awaitingConeIds = [...coneById.entries()]
    .filter(([, row]) => row.status === 'Awaiting')
    .map(([id]) => id)
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (awaitingConeIds.length) {
    const coneDocs = await YarnCone.find({
      _id: { $in: awaitingConeIds.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select('issueStatus returnStatus')
      .lean();
    const docById = new Map(coneDocs.map((d) => [String(d._id), d]));
    for (const id of awaitingConeIds) {
      const row = coneById.get(id);
      if (!row || row.status !== 'Awaiting') continue;
      const doc = docById.get(id);
      if (!doc) continue;
      if (doc.issueStatus === 'used' && doc.returnStatus === 'not_returned') {
        row.status = /** @type {const} */ ('Consumed');
      } else if (doc.issueStatus !== 'issued') {
        row.status = /** @type {const} */ ('Closed');
      }
    }
  }

  const cones = [...coneById.values()].sort((a, b) =>
    String(a.yarnName || '').localeCompare(String(b.yarnName || ''))
  );

  let pendingConeCount = 0;
  let returnedConeCount = 0;
  let consumedConeCount = 0;
  let clearedConeCount = 0;
  /** @type {Set<string>} */
  const yarnNameSet = new Set();
  for (const c of cones) {
    if (c.status === 'Returned') returnedConeCount += 1;
    else if (c.status === 'Consumed') consumedConeCount += 1;
    else if (c.status === 'Closed') clearedConeCount += 1;
    else pendingConeCount += 1;
    const yn = String(c.yarnName || '').trim();
    if (yn) yarnNameSet.add(yn);
  }
  const yarnNames = [...yarnNameSet].sort((a, b) => a.localeCompare(b)).join(', ');

  const closedConeCount = returnedConeCount + consumedConeCount + clearedConeCount;
  let statusSummary = /** @type {'None'|'Awaiting'|'Partial'|'Returned'} */ ('None');
  if (pendingConeCount > 0 && closedConeCount > 0) statusSummary = 'Partial';
  else if (pendingConeCount > 0 && closedConeCount === 0) statusSummary = 'Awaiting';
  else if (pendingConeCount === 0 && closedConeCount > 0) statusSummary = 'Returned';

  let assignment =
    /** @type {import('mongoose').LeanDocument<{ machine?: Record<string, unknown> }>|null} */ (
      await MachineOrderAssignment.findOne({
        isActive: true,
        productionOrderItems: {
          $elemMatch: { productionOrder: po._id, article: articleDoc._id },
        },
      })
        .populate({
          path: 'machine',
          select: 'floor assignedSupervisor',
          populate: { path: 'assignedSupervisor', select: 'name email' },
        })
        .select('machine')
        .sort({ updatedAt: -1 })
        .lean()
    );

  if (!assignment?.machine) {
    assignment =
      /** @type {typeof assignment} */
      (
        await MachineOrderAssignment.findOne({
          productionOrderItems: {
            $elemMatch: { productionOrder: po._id, article: articleDoc._id },
          },
        })
          .populate({
            path: 'machine',
            select: 'floor assignedSupervisor',
            populate: { path: 'assignedSupervisor', select: 'name email' },
          })
          .select('machine')
          .sort({ updatedAt: -1 })
          .lean()
      );
  }

  /** @type {Record<string, unknown>|undefined} */
  const mach = assignment && typeof assignment.machine === 'object' ? assignment.machine : undefined;
  const floor =
    (mach?.floor != null && String(mach.floor).trim() !== '' && String(mach.floor)) ||
    (po.currentFloor != null ? String(po.currentFloor) : '');

  /** @type {Record<string, unknown>|undefined} */
  const supervisor =
    mach && typeof mach.assignedSupervisor === 'object' && mach.assignedSupervisor !== null
      ? /** @type {Record<string, unknown>} */ (mach.assignedSupervisor)
      : undefined;
  const knittingSupervisor =
    (supervisor?.name != null && String(supervisor.name).trim()) ||
    (supervisor?.email != null && String(supervisor.email).trim()) ||
    'N/A';

  const knittingCompletedFromLog = await resolveKnittingCompletedAtIso(String(articleDoc._id));
  const knittingCompletedAt =
    knittingCompletedFromLog ??
    toIsoStringOrNull(articleDoc.completedAt);

  const conesOut = cones.map((c) => ({
    id: c.id,
    barcode: c.barcode,
    yarnName: c.yarnName || '',
    status: c.status,
    articleId: String(articleDoc._id),
    articleNumber: articleDoc.articleNumber,
  }));

  return {
    orderId: String(po._id),
    /** Visible production order number (e.g. ORD-…), not article `knittingCode`. */
    productionOrder: String(po.orderNumber ?? '').trim(),
    floor,
    knittingCompletedAt,
    knittingSupervisor,
    articleId: String(articleDoc._id),
    articleNumber: articleDoc.articleNumber,
    yarnNames,
    status: statusSummary,
    pendingConeCount,
    returnedConeCount,
    consumedConeCount,
    clearedConeCount,
    cones: conesOut,
  };
};

/**
 * Enriches yarn transactions with article information by matching yarns to articles via BOM
 * @param {Array} transactions - Array of yarn transactions
 * @param {Object} orderRef - { orderno?: string, orderId?: ObjectId } - Order number or MongoDB ObjectId
 * @returns {Array} Transactions grouped by article with article details
 */
export const groupTransactionsByArticle = async (transactions, orderRef) => {
  if (!transactions || transactions.length === 0) {
    return [];
  }

  const { orderno, orderId } = typeof orderRef === 'string' ? { orderno: orderRef, orderId: null } : (orderRef || {});

  // Resolve production order: by ObjectId or by orderNumber
  let productionOrder = null;
  if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
    productionOrder = await ProductionOrder.findById(orderId).lean();
  }
  if (!productionOrder && orderno) {
    productionOrder = await ProductionOrder.findOne({ orderNumber: orderno }).lean();
  }

  if (!productionOrder) {
    // If order not found, group by articleNumber from transactions (if available)
    return groupTransactionsByArticleNumber(transactions);
  }

  // Get all articles for this order
  const articles = await Article.find({ 
    orderId: productionOrder._id 
  })
    .select('articleNumber plannedQuantity status progress')
    .lean();

  if (!articles || articles.length === 0) {
    // If no articles found, group by articleNumber from transactions (if available)
    return groupTransactionsByArticleNumber(transactions);
  }

  // Build a map of articleNumber -> yarnNames from BOM
  const articleYarnMap = new Map(); // articleNumber -> Set of yarnNames
  
  for (const article of articles) {
    try {
      // Find product by factoryCode (articleNumber = factoryCode)
      const product = await Product.findOne({ 
        factoryCode: article.articleNumber 
      })
        .populate({
          path: 'bom.yarnCatalogId',
          select: 'yarnName'
        })
        .select('bom')
        .lean();

      if (product && product.bom && product.bom.length > 0) {
        const yarnNames = new Set();
        product.bom.forEach(bomItem => {
          const yarnName = bomItem.yarnName || (bomItem.yarnCatalogId?.yarnName);
          if (yarnName) {
            yarnNames.add(yarnName);
          }
        });
        if (yarnNames.size > 0) {
          articleYarnMap.set(article.articleNumber, {
            yarnNames,
            articleInfo: article
          });
        }
      }
    } catch (error) {
      console.error(`Error fetching BOM for article ${article.articleNumber}:`, error.message);
    }
  }

  /**
   * When BOM match fails: use embedded articleNumber or articleId (populate or plain ObjectId) on this PO.
   * @param {object} transaction
   * @param {{ _id: unknown; articleNumber?: string | null }[]} orderArticles
   * @returns {string|null}
   */
  const resolveArticleNumberFromTransaction = (transaction, orderArticles) => {
    const top = transaction?.articleNumber != null ? String(transaction.articleNumber).trim() : '';
    if (top) return top;

    const aid = transaction.articleId;
    if (aid && typeof aid === 'object') {
      const fromPop = aid.articleNumber != null ? String(aid.articleNumber).trim() : '';
      if (fromPop) return fromPop;
      const id = '_id' in aid ? aid._id : null;
      if (id != null) {
        const hit = orderArticles.find((a) => String(a._id) === String(id));
        if (hit?.articleNumber) return String(hit.articleNumber).trim();
      }
    } else if (aid != null) {
      const hit = orderArticles.find((a) => String(a._id) === String(aid));
      if (hit?.articleNumber) return String(hit.articleNumber).trim();
    }
    return null;
  };

  /** Map YarnCone._id → article factory code for articles on this order (fallback when txn has no article). */
  const coneIdToArticleNumber = new Map();
  const coneOidHex = new Set();
  for (const t of transactions) {
    const arr = t.conesIdsArray;
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const id =
        item && typeof item === 'object' && item !== null && '_id' in item ? item._id : item;
      if (id != null && mongoose.Types.ObjectId.isValid(id)) {
        coneOidHex.add(String(id));
      }
    }
  }
  if (coneOidHex.size > 0) {
    const cones = await YarnCone.find({
      _id: { $in: [...coneOidHex].map((h) => new mongoose.Types.ObjectId(h)) },
    })
      .select('articleId')
      .lean();
    for (const c of cones) {
      if (!c?._id || !c?.articleId) continue;
      const hit = articles.find((a) => String(a._id) === String(c.articleId));
      if (hit?.articleNumber) {
        coneIdToArticleNumber.set(String(c._id), String(hit.articleNumber).trim());
      }
    }
  }

  /**
   * @param {object} transaction
   * @returns {string|null}
   */
  const articleNumberFromConeIds = (transaction) => {
    const arr = transaction.conesIdsArray;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const first = arr[0];
    const id =
      first && typeof first === 'object' && first !== null && '_id' in first ? first._id : first;
    if (id == null) return null;
    return coneIdToArticleNumber.get(String(id)) ?? null;
  };

  // Group transactions by article
  const groupedByArticle = {};
  const unmatchedTransactions = [];

  transactions.forEach(transaction => {
    const transactionYarnName = transaction.yarnName;
    let matched = false;

    /**
     * Prefer explicit order/article on the transaction before BOM yarn-name routing.
     * Otherwise two articles on the same PO with overlapping BOM yarn names can steal
     * each other's rows, and the UI shows wrong pending counts per article.
     */
    const explicitArticleNumber = resolveArticleNumberFromTransaction(transaction, articles);
    const canonicalArticle = explicitArticleNumber
      ? articles.find(
          (a) =>
            String(a.articleNumber).trim().toLowerCase() === String(explicitArticleNumber).trim().toLowerCase()
        )
      : null;
    if (explicitArticleNumber && canonicalArticle) {
      const key = canonicalArticle.articleNumber;

      if (!groupedByArticle[key]) {
        groupedByArticle[key] = {
          articleNumber: key,
          articleInfo: {
            plannedQuantity: canonicalArticle.plannedQuantity,
            status: canonicalArticle.status,
            progress: canonicalArticle.progress,
          },
          transactions: [],
          totals: {
            transactionNetWeight: 0,
            transactionTotalWeight: 0,
            transactionTearWeight: 0,
            transactionConeCount: 0,
          },
        };
      }

      groupedByArticle[key].transactions.push(transaction);
      groupedByArticle[key].totals.transactionNetWeight += transaction.transactionNetWeight || 0;
      groupedByArticle[key].totals.transactionTotalWeight += transaction.transactionTotalWeight || 0;
      groupedByArticle[key].totals.transactionTearWeight += transaction.transactionTearWeight || 0;
      groupedByArticle[key].totals.transactionConeCount += transaction.transactionConeCount || 0;
      matched = true;
    }

    if (!matched) {
      const coneArticle = articleNumberFromConeIds(transaction);
      const canonicalFromCone = coneArticle
        ? articles.find(
            (a) =>
              String(a.articleNumber).trim().toLowerCase() === String(coneArticle).trim().toLowerCase()
          )
        : null;
      if (coneArticle && canonicalFromCone) {
        const key = canonicalFromCone.articleNumber;
        if (!groupedByArticle[key]) {
          groupedByArticle[key] = {
            articleNumber: key,
            articleInfo: {
              plannedQuantity: canonicalFromCone.plannedQuantity,
              status: canonicalFromCone.status,
              progress: canonicalFromCone.progress,
            },
            transactions: [],
            totals: {
              transactionNetWeight: 0,
              transactionTotalWeight: 0,
              transactionTearWeight: 0,
              transactionConeCount: 0,
            },
          };
        }
        groupedByArticle[key].transactions.push(transaction);
        groupedByArticle[key].totals.transactionNetWeight += transaction.transactionNetWeight || 0;
        groupedByArticle[key].totals.transactionTotalWeight += transaction.transactionTotalWeight || 0;
        groupedByArticle[key].totals.transactionTearWeight += transaction.transactionTearWeight || 0;
        groupedByArticle[key].totals.transactionConeCount += transaction.transactionConeCount || 0;
        matched = true;
      }
    }

    // Try to match transaction to article via BOM (when not already attributed explicitly)
    if (!matched) {
      for (const [articleNumber, { yarnNames, articleInfo }] of articleYarnMap.entries()) {
        if (yarnNames.has(transactionYarnName)) {
          if (!groupedByArticle[articleNumber]) {
            groupedByArticle[articleNumber] = {
              articleNumber: articleNumber,
              articleInfo: {
                plannedQuantity: articleInfo.plannedQuantity,
                status: articleInfo.status,
                progress: articleInfo.progress,
              },
              transactions: [],
              totals: {
                transactionNetWeight: 0,
                transactionTotalWeight: 0,
                transactionTearWeight: 0,
                transactionConeCount: 0,
              }
            };
          }
          
          groupedByArticle[articleNumber].transactions.push(transaction);
          groupedByArticle[articleNumber].totals.transactionNetWeight += transaction.transactionNetWeight || 0;
          groupedByArticle[articleNumber].totals.transactionTotalWeight += transaction.transactionTotalWeight || 0;
          groupedByArticle[articleNumber].totals.transactionTearWeight += transaction.transactionTearWeight || 0;
          groupedByArticle[articleNumber].totals.transactionConeCount += transaction.transactionConeCount || 0;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      unmatchedTransactions.push(transaction);
    }
  });

  // Add unmatched transactions to a "NO_ARTICLE" group
  if (unmatchedTransactions.length > 0) {
    groupedByArticle['NO_ARTICLE'] = {
      articleNumber: null,
      articleInfo: null,
      transactions: unmatchedTransactions,
      totals: {
        transactionNetWeight: unmatchedTransactions.reduce((sum, t) => sum + (t.transactionNetWeight || 0), 0),
        transactionTotalWeight: unmatchedTransactions.reduce((sum, t) => sum + (t.transactionTotalWeight || 0), 0),
        transactionTearWeight: unmatchedTransactions.reduce((sum, t) => sum + (t.transactionTearWeight || 0), 0),
        transactionConeCount: unmatchedTransactions.reduce((sum, t) => sum + (t.transactionConeCount || 0), 0),
      }
    };
  }

  return Object.values(groupedByArticle);
};

/**
 * Groups transactions by articleNumber field if available
 * @param {Array} transactions - Array of yarn transactions
 * @returns {Array} Transactions grouped by articleNumber
 */
const groupTransactionsByArticleNumber = (transactions) => {
  const grouped = {};
  
  transactions.forEach(transaction => {
    const articleKey = transaction.articleNumber || 'NO_ARTICLE';
    
    if (!grouped[articleKey]) {
      grouped[articleKey] = {
        articleNumber: transaction.articleNumber || null,
        articleInfo: null,
        transactions: [],
        totals: {
          transactionNetWeight: 0,
          transactionTotalWeight: 0,
          transactionTearWeight: 0,
          transactionConeCount: 0,
        }
      };
    }
    
    grouped[articleKey].transactions.push(transaction);
    grouped[articleKey].totals.transactionNetWeight += transaction.transactionNetWeight || 0;
    grouped[articleKey].totals.transactionTotalWeight += transaction.transactionTotalWeight || 0;
    grouped[articleKey].totals.transactionTearWeight += transaction.transactionTearWeight || 0;
    grouped[articleKey].totals.transactionConeCount += transaction.transactionConeCount || 0;
  });
  
  return Object.values(grouped);
};

/**
 * Gets yarn transactions for a production order (by visible orderNumber / ORD-xxx).
 * Default: only `yarn_issued`. Use `includeReturns` / `includeFloorIssue` to widen types.
 *
 * Matches `orderId` on the resolved ProductionOrder **or** `orderno` case-insensitive (legacy rows).
 *
 * @param {string} orderno
 * @param {boolean} groupByArticle
 * @param {{ includeReturns?: boolean; includeFloorIssue?: boolean }} [options]
 */
export const getYarnIssuedByOrder = async (orderno, groupByArticle = false, options = {}) => {
  const { includeReturns = false, includeFloorIssue = false } = options || {};

  /** @type {string[]} */
  const types = ['yarn_issued'];
  if (includeFloorIssue) {
    types.push('yarn_issued_linking', 'yarn_issued_sampling');
  }
  if (includeReturns) {
    types.push('yarn_returned');
  }

  const trimmed = String(orderno ?? '').trim();
  const ordRe = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');

  let order = await ProductionOrder.findOne({ orderNumber: trimmed }).select('_id orderNumber').lean();
  if (!order) {
    order = await ProductionOrder.findOne({ orderNumber: ordRe }).select('_id orderNumber').lean();
  }

  const orderScope = order ? { $or: [{ orderId: order._id }, { orderno: ordRe }] } : { orderno: ordRe };

  const mongooseFilter = {
    $and: [{ ...orderScope }, { transactionType: { $in: types } }],
  };

  const transactions = await YarnTransaction.find(mongooseFilter)
    .populate({
      path: 'yarnCatalogId',
      select: '_id yarnName yarnType status',
    })
    .populate({ path: 'orderId', select: 'orderNumber' })
    .populate({ path: 'articleId', select: 'articleNumber orderId machineId' })
    .populate({
      path: 'conesIdsArray',
      select: 'barcode boxId yarnName _id',
    })
    .sort({ transactionDate: -1 })
    .lean();

  // If groupByArticle is true, group transactions by articleNumber
  if (groupByArticle) {
    const groupedByArticle = {};
    
    transactions.forEach(transaction => {
      const articleKey = transaction.articleNumber || 'NO_ARTICLE';
      
      if (!groupedByArticle[articleKey]) {
        groupedByArticle[articleKey] = {
          articleNumber: transaction.articleNumber || null,
          transactions: [],
          totals: {
            transactionNetWeight: 0,
            transactionTotalWeight: 0,
            transactionTearWeight: 0,
            transactionConeCount: 0,
          }
        };
      }
      
      groupedByArticle[articleKey].transactions.push(transaction);
      groupedByArticle[articleKey].totals.transactionNetWeight += transaction.transactionNetWeight || 0;
      groupedByArticle[articleKey].totals.transactionTotalWeight += transaction.transactionTotalWeight || 0;
      groupedByArticle[articleKey].totals.transactionTearWeight += transaction.transactionTearWeight || 0;
      groupedByArticle[articleKey].totals.transactionConeCount += transaction.transactionConeCount || 0;
    });
    
    // Convert to array format
    return Object.values(groupedByArticle);
  }

  // Default: return flat array grouped by yarnName
  const groupedByYarn = {};
  
  transactions.forEach(transaction => {
    const yarnKey = transaction.yarnName || 'UNKNOWN_YARN';
    
    if (!groupedByYarn[yarnKey]) {
      groupedByYarn[yarnKey] = {
        yarnName: transaction.yarnName,
        yarnCatalogId: transaction.yarnCatalogId,
        transactions: [],
        totals: {
          transactionNetWeight: 0,
          transactionTotalWeight: 0,
          transactionTearWeight: 0,
          transactionConeCount: 0,
        }
      };
    }
    
    groupedByYarn[yarnKey].transactions.push(transaction);
    groupedByYarn[yarnKey].totals.transactionNetWeight += transaction.transactionNetWeight || 0;
    groupedByYarn[yarnKey].totals.transactionTotalWeight += transaction.transactionTotalWeight || 0;
    groupedByYarn[yarnKey].totals.transactionTearWeight += transaction.transactionTearWeight || 0;
    groupedByYarn[yarnKey].totals.transactionConeCount += transaction.transactionConeCount || 0;
  });
  
  return Object.values(groupedByYarn);
};

/**
 * Gets all yarn_issued transactions.
 * Returns all transactions with transactionType 'yarn_issued' regardless of order number.
 * Optionally filters by date range if start_date and/or end_date are provided.
 */
export const getAllYarnIssued = async (filters = {}) => {
  const mongooseFilter = {
    transactionType: 'yarn_issued',
  };

  if (filters.start_date || filters.end_date) {
    mongooseFilter.transactionDate = {};
    if (filters.start_date) {
      const start = new Date(filters.start_date);
      start.setHours(0, 0, 0, 0);
      mongooseFilter.transactionDate.$gte = start;
    }
    if (filters.end_date) {
      const end = new Date(filters.end_date);
      end.setHours(23, 59, 59, 999);
      mongooseFilter.transactionDate.$lte = end;
    }
  }

  const transactions = await YarnTransaction.find(mongooseFilter)
    .populate({
      path: 'yarnCatalogId',
      select: '_id yarnName yarnType status',
    })
    .sort({ transactionDate: -1 })
    .lean();

  return transactions;
};


