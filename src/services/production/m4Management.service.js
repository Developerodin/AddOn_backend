import httpStatus from 'http-status';
import mongoose from 'mongoose';
import {
  Article,
  M4Log,
  ProductionOrder,
  MachineOrderAssignment,
  M4LogType,
  ProductionFloor,
} from '../../models/production/index.js';
import Machine from '../../models/machine.model.js';
import User from '../../models/user.model.js';
import ApiError from '../../utils/ApiError.js';

const M4_FLOOR_KEYS = ['knitting', 'checking', 'secondaryChecking', 'finalChecking'];

const FLOOR_KEY_TO_LABEL = {
  knitting: 'Knitting',
  checking: 'Checking',
  secondaryChecking: 'Secondary Checking',
  finalChecking: 'Final Checking',
};

/**
 * Sum M4 quantity across M4-tracked floors.
 * @param {Object} article - Article document or plain object
 * @returns {number}
 */
const sumFloorM4 = (article) => {
  const fq = article?.floorQuantities || {};
  return M4_FLOOR_KEYS.reduce((sum, key) => sum + (fq[key]?.m4Quantity || 0), 0);
};

/**
 * Per-floor M4 breakdown for an article.
 * @param {Object} article
 * @returns {Object}
 */
export const computeM4Snapshot = (article) => {
  const fq = article?.floorQuantities || {};
  const byFloor = {
    knitting: fq.knitting?.m4Quantity || 0,
    checking: fq.checking?.m4Quantity || 0,
    secondaryChecking: fq.secondaryChecking?.m4Quantity || 0,
    finalChecking: fq.finalChecking?.m4Quantity || 0,
  };
  const onHand = Object.values(byFloor).reduce((s, n) => s + n, 0);
  const outwardTotal = article?.m4Tracking?.outwardTotal || 0;
  const availableForOutward = Math.max(0, onHand - outwardTotal);

  return {
    byFloor,
    onHand,
    outwardTotal,
    availableForOutward,
  };
};

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
 * Normalize a user reference to a string id.
 * @param {Object|string|null|undefined} user
 * @returns {string}
 */
const extractUserId = (user) => {
  if (!user) return 'system';
  if (typeof user === 'string') return user;

  const rawId = user.id ?? user._id ?? user.userId ?? user.floorSupervisorId;
  if (!rawId || rawId === 'system') return rawId || 'system';

  return typeof rawId === 'object' && rawId.toString ? rawId.toString() : String(rawId);
};

/**
 * Resolve user id, display name, and floor supervisor id for M4 log entries.
 * @param {Object|string|null|undefined} user
 * @returns {Promise<{ userId: string, userName: string, floorSupervisorId: string }>}
 */
const resolveUserDisplayFields = async (user) => {
  const userId = extractUserId(user);

  if (userId === 'system') {
    return { userId: 'system', userName: 'System', floorSupervisorId: 'system' };
  }

  let userName = '';
  if (user && typeof user === 'object') {
    userName = user.name || user.userName || '';
  }

  if (!userName && mongoose.Types.ObjectId.isValid(userId)) {
    const dbUser = await User.findById(userId).select('name').lean();
    userName = dbUser?.name || '';
  }

  const floorSupervisorId = extractUserId(user?.floorSupervisorId ? { userId: user.floorSupervisorId } : user);

  return {
    userId,
    userName,
    floorSupervisorId: floorSupervisorId === 'system' ? userId : floorSupervisorId,
  };
};

/**
 * Fill missing userName values on M4 logs using the users collection.
 * @param {Array<Object>} logs
 * @returns {Promise<Array<Object>>}
 */
const enrichM4LogsWithUserNames = async (logs) => {
  if (!logs?.length) return logs;

  const missingNameUserIds = [
    ...new Set(
      logs
        .filter((log) => !log.userName && log.userId && log.userId !== 'system')
        .map((log) => log.userId)
    ),
  ];

  if (!missingNameUserIds.length) return logs;

  const validIds = missingNameUserIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!validIds.length) return logs;

  const users = await User.find({ _id: { $in: validIds } }).select('name').lean();
  const nameById = Object.fromEntries(users.map((u) => [u._id.toString(), u.name]));

  return logs.map((log) => ({
    ...log,
    userName: log.userName || nameById[log.userId] || '',
  }));
};

/**
 * Resolve machine display fields from a machine document or id.
 * @param {string|Object|null} machineRef
 * @returns {Promise<{ machineId: string, machineCode: string, machineName: string }>}
 */
export const resolveMachineInfo = async (machineRef) => {
  if (!machineRef) {
    return { machineId: '', machineCode: '', machineName: '' };
  }

  if (typeof machineRef === 'object' && machineRef !== null) {
    const machineId = machineRef._id?.toString?.() ?? String(machineRef._id ?? '');
    const machineCode = machineRef.machineCode || machineRef.machineNumber || '';
    const machineName = machineRef.name || machineRef.model || machineCode;
    return { machineId, machineCode, machineName };
  }

  const machineId = String(machineRef);
  const machine = await Machine.findById(machineId).select('machineCode machineNumber model').lean();
  if (!machine) {
    return { machineId, machineCode: '', machineName: '' };
  }

  const machineCode = machine.machineCode || machine.machineNumber || '';
  return {
    machineId,
    machineCode,
    machineName: machine.model || machineCode,
  };
};

/**
 * Resolve knitting machine for an article (explicit id, article field, or queue assignment).
 * @param {Object} article
 * @param {Object} [context]
 * @returns {Promise<{ machineId: string, machineCode: string, machineName: string }>}
 */
export const resolveKnittingMachineForArticle = async (article, context = {}) => {
  const explicitId = context.machineId || article?.machineId;
  if (explicitId) {
    return resolveMachineInfo(explicitId);
  }

  const articleMongoId = article._id?.toString?.() ?? String(article._id);
  const orderMongoId = article.orderId?.toString?.() ?? String(article.orderId);

  const assignment = await MachineOrderAssignment.findOne({
    isActive: true,
    productionOrderItems: {
      $elemMatch: {
        productionOrder: orderMongoId,
        article: articleMongoId,
      },
    },
  })
    .populate('machine', 'machineCode machineNumber model')
    .lean();

  if (assignment?.machine) {
    return resolveMachineInfo(assignment.machine);
  }

  return { machineId: '', machineCode: '', machineName: '' };
};

/**
 * Record an M4 ENTRY log when floor M4 increases (non-blocking caller).
 * @param {Object} params
 * @returns {Promise<Object|null>}
 */
export const recordM4Entry = async ({
  article,
  sourceFloor,
  deltaQuantity,
  previousFloorTotal,
  newFloorTotal,
  user,
  remarks = '',
  machineId,
  machineCode,
  machineName,
}) => {
  if (!article || !deltaQuantity || deltaQuantity <= 0) return null;

  const snapshot = computeM4Snapshot(article);
  const orderNumber = await resolveOrderNumber(article);
  const articleIdStr = article._id?.toString?.() ?? String(article._id);
  const orderIdStr = article.orderId?.toString?.() ?? String(article.orderId);

  let machine = { machineId: machineId || '', machineCode: machineCode || '', machineName: machineName || '' };
  if (sourceFloor === ProductionFloor.KNITTING && !machine.machineId && !machine.machineCode) {
    machine = await resolveKnittingMachineForArticle(article, { machineId });
  } else if (machineId && !machine.machineCode) {
    machine = await resolveMachineInfo(machineId);
  }

  const machineRemark =
    sourceFloor === ProductionFloor.KNITTING && machine.machineCode
      ? ` on machine ${machine.machineCode}`
      : '';

  const userFields = await resolveUserDisplayFields(user);

  return M4Log.createLogEntry({
    type: M4LogType.ENTRY,
    articleId: articleIdStr,
    orderId: orderIdStr,
    orderNumber,
    articleNumber: article.articleNumber || '',
    sourceFloor,
    quantity: deltaQuantity,
    previousOnHand: snapshot.onHand - deltaQuantity,
    newOnHand: snapshot.onHand,
    previousOutwardTotal: snapshot.outwardTotal,
    newOutwardTotal: snapshot.outwardTotal,
    availableAfter: snapshot.availableForOutward,
    remarks:
      remarks ||
      `M4 entry on ${sourceFloor}${machineRemark}: +${deltaQuantity} (floor total ${previousFloorTotal} → ${newFloorTotal})`,
    ...userFields,
    machineId: machine.machineId,
    machineCode: machine.machineCode,
    machineName: machine.machineName,
  });
};

/**
 * Mark M4 quantity as outward (ledger-only; floor quantities unchanged).
 * @param {string} articleId
 * @param {Object} body
 * @param {Object} user
 * @returns {Promise<Object>}
 */
export const markM4Outward = async (articleId, body, user = {}) => {
  const { quantity, remarks } = body;

  if (!remarks || !String(remarks).trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Remarks are required for outward');
  }

  const article = await findArticleById(articleId);
  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
  }

  const snapshot = computeM4Snapshot(article);
  if (quantity <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Outward quantity must be greater than 0');
  }
  if (quantity > snapshot.availableForOutward) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot outward ${quantity} units. Available: ${snapshot.availableForOutward}`
    );
  }

  if (!article.m4Tracking) {
    article.m4Tracking = { outwardTotal: 0 };
  }
  const previousOutwardTotal = article.m4Tracking.outwardTotal || 0;
  const newOutwardTotal = previousOutwardTotal + quantity;
  article.m4Tracking.outwardTotal = newOutwardTotal;
  await article.save();

  const orderNumber = await resolveOrderNumber(article);
  const articleIdStr = article._id.toString();
  const orderIdStr = article.orderId.toString();
  const availableAfter = Math.max(0, snapshot.onHand - newOutwardTotal);

  const userFields = await resolveUserDisplayFields(user);

  const log = await M4Log.createLogEntry({
    type: M4LogType.OUTWARD,
    articleId: articleIdStr,
    orderId: orderIdStr,
    orderNumber,
    articleNumber: article.articleNumber || '',
    sourceFloor: null,
    quantity,
    previousOnHand: snapshot.onHand,
    newOnHand: snapshot.onHand,
    previousOutwardTotal,
    newOutwardTotal,
    availableAfter,
    remarks: String(remarks).trim(),
    ...userFields,
  });

  return {
    article: {
      id: article.id,
      _id: article._id,
      articleNumber: article.articleNumber,
      orderId: article.orderId,
      orderNumber,
      m4Snapshot: computeM4Snapshot(article),
    },
    log,
  };
};

/**
 * Build Mongo filter for articles with M4 activity.
 * @param {Object} filter
 * @returns {Object}
 */
const buildArticleM4Filter = (filter = {}) => {
  const mongoFilter = {
    $or: [
      { 'floorQuantities.knitting.m4Quantity': { $gt: 0 } },
      { 'floorQuantities.checking.m4Quantity': { $gt: 0 } },
      { 'floorQuantities.secondaryChecking.m4Quantity': { $gt: 0 } },
      { 'floorQuantities.finalChecking.m4Quantity': { $gt: 0 } },
      { 'm4Tracking.outwardTotal': { $gt: 0 } },
    ],
  };

  if (filter.orderId) {
    mongoFilter.orderId = filter.orderId;
  }

  if (filter.search) {
    const q = filter.search.trim();
    mongoFilter.$and = [
      ...(mongoFilter.$and || []),
      {
        $or: [
          { articleNumber: { $regex: q, $options: 'i' } },
          { id: { $regex: q, $options: 'i' } },
        ],
      },
    ];
  }

  return mongoFilter;
};

/**
 * Paginated list of articles with M4 snapshot data.
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getM4Articles = async (filter = {}, options = {}) => {
  const mongoFilter = buildArticleM4Filter(filter);
  const page = options.page || 1;
  const limit = options.limit || 50;
  const skip = (page - 1) * limit;

  const [articles, totalResults] = await Promise.all([
    Article.find(mongoFilter)
      .sort(options.sortBy ? options.sortBy.replace(':', ' ') : { updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Article.countDocuments(mongoFilter),
  ]);

  const orderIds = [...new Set(articles.map((a) => a.orderId?.toString()).filter(Boolean))];
  const orders = await ProductionOrder.find({ _id: { $in: orderIds } })
    .select('orderNumber priority status orderNote')
    .lean();
  const orderMap = Object.fromEntries(orders.map((o) => [o._id.toString(), o]));

  const results = articles.map((article) => {
    const snapshot = computeM4Snapshot(article);
    const order = orderMap[article.orderId?.toString()] || {};
    return {
      id: article.id,
      _id: article._id,
      articleNumber: article.articleNumber,
      orderId: article.orderId,
      orderNumber: order.orderNumber || '',
      orderNote: order.orderNote || '',
      priority: article.priority,
      status: article.status,
      linkingType: article.linkingType,
      m4Snapshot: snapshot,
    };
  });

  const totalPages = Math.ceil(totalResults / limit) || 1;

  return {
    results,
    page,
    limit,
    totalPages,
    totalResults,
  };
};

/**
 * M4 summary for a single article including recent logs.
 * @param {string} articleId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getM4ArticleSummary = async (articleId, options = {}) => {
  const article = await findArticleById(articleId);
  if (!article) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found');
  }

  const orderNumber = await resolveOrderNumber(article);
  const articleIdStr = article._id.toString();
  const logLimit = options.logLimit || 20;

  const recentLogs = await enrichM4LogsWithUserNames(
    await M4Log.find({ articleId: articleIdStr })
      .sort({ timestamp: -1 })
      .limit(logLimit)
      .lean()
  );

  return {
    id: article.id,
    _id: article._id,
    articleNumber: article.articleNumber,
    orderId: article.orderId,
    orderNumber,
    m4Snapshot: computeM4Snapshot(article),
    recentLogs,
  };
};

/**
 * Paginated M4 ledger logs with filters.
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getM4Logs = async (filter = {}, options = {}) => {
  const logFilter = {};

  if (filter.articleId) {
    logFilter.articleId = filter.articleId;
  }
  if (filter.orderId) {
    logFilter.orderId = filter.orderId;
  }
  if (filter.type) {
    logFilter.type = filter.type;
  }
  if (filter.sourceFloor) {
    logFilter.sourceFloor = filter.sourceFloor;
  }
  if (filter.dateFrom || filter.dateTo) {
    logFilter.timestamp = {};
    if (filter.dateFrom) logFilter.timestamp.$gte = new Date(filter.dateFrom);
    if (filter.dateTo) logFilter.timestamp.$lte = new Date(filter.dateTo);
  }
  if (filter.machineId) {
    logFilter.machineId = filter.machineId;
  }
  if (filter.search) {
    const q = filter.search.trim();
    logFilter.$or = [
      { orderNumber: { $regex: q, $options: 'i' } },
      { articleNumber: { $regex: q, $options: 'i' } },
      { remarks: { $regex: q, $options: 'i' } },
      { userName: { $regex: q, $options: 'i' } },
      { machineCode: { $regex: q, $options: 'i' } },
      { machineName: { $regex: q, $options: 'i' } },
    ];
  }

  const paginated = await M4Log.paginate(logFilter, {
    ...options,
    sortBy: options.sortBy || 'timestamp:desc',
  });

  if (paginated.results?.length) {
    paginated.results = await enrichM4LogsWithUserNames(paginated.results);
  }

  return paginated;
};

/**
 * Aggregate KPI stats for M4 Management dashboard.
 * @returns {Promise<Object>}
 */
export const getM4Statistics = async () => {
  const articles = await Article.find(buildArticleM4Filter()).lean();
  let totalOnHand = 0;
  let totalOutwarded = 0;
  let totalAvailable = 0;

  for (const article of articles) {
    const snap = computeM4Snapshot(article);
    totalOnHand += snap.onHand;
    totalOutwarded += snap.outwardTotal;
    totalAvailable += snap.availableForOutward;
  }

  return {
    articleCount: articles.length,
    totalOnHand,
    totalOutwarded,
    totalAvailable,
  };
};

export { FLOOR_KEY_TO_LABEL, M4_FLOOR_KEYS, sumFloorM4 };
