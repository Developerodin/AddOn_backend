import mongoose from 'mongoose';
import UserActivityLog from '../models/userActivityLog.model.js';

/**
 * Log auth event (login, register) - used when req.user isn't set yet by middleware
 * @param {Object} params
 * @param {ObjectId} params.userId - User ID
 * @param {string} params.action - 'login' | 'register'
 * @param {Object} params.req - Express request (for ip, userAgent)
 */
export const logAuthEvent = async ({ userId, action, req }) => {
  try {
    await UserActivityLog.create({
      userId,
      method: 'POST',
      path: `/v1/auth/${action}`,
      route: `/v1/auth`,
      statusCode: 200,
      action,
      resource: 'auth',
      ip: req?.ip || req?.connection?.remoteAddress,
      userAgent: req?.get?.('user-agent'),
    });
  } catch (err) {
    console.error('[userActivityLog] Failed to log auth event:', err.message);
  }
};

/**
 * Build query from filter params (shared by getUserActivityLogs and getAllActivityLogs)
 */
const buildLogsQuery = (filter, baseQuery = {}) => {
  const {
    resource,
    action,
    method,
    statusCode,
    errorsOnly,
    pathSearch,
    dateFrom,
    dateTo,
  } = filter;

  const query = { ...baseQuery };

  if (resource) query.resource = resource;
  if (action) query.action = action;
  if (method) query.method = method;
  if (errorsOnly) query.statusCode = { $gte: 400 };
  else if (statusCode != null) query.statusCode = statusCode;
  if (pathSearch) query.path = { $regex: pathSearch, $options: 'i' };
  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
    if (dateTo) {
      const d = new Date(dateTo);
      d.setUTCHours(23, 59, 59, 999); // end of day so dateTo is inclusive
      query.createdAt.$lte = d;
    }
  }

  return query;
};

/** Ensure userId is ObjectId for MongoDB queries */
const toObjectId = (id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);

/**
 * Get activity logs for a user with filters and pagination
 */
export const getUserActivityLogs = async (userId, filter = {}) => {
  const { page = 1, limit = 50, sortBy = 'createdAt', sortOrder = 'desc' } = filter;
  const query = buildLogsQuery(filter, { userId: toObjectId(userId) });

  const logs = await UserActivityLog.paginate(query, {
    page,
    limit,
    sortBy: `${sortBy}:${sortOrder}`,
    populate: { path: 'userId', select: 'name email' },
  });

  return logs;
};

/**
 * Get all activity logs (admin) - optional userId filter
 */
export const getAllActivityLogs = async (filter = {}) => {
  const { userId, page = 1, limit = 50, sortBy = 'createdAt', sortOrder = 'desc' } = filter;
  const baseQuery = userId ? { userId: toObjectId(userId) } : {};
  const query = buildLogsQuery(filter, baseQuery);

  const logs = await UserActivityLog.paginate(query, {
    page,
    limit,
    sortBy: `${sortBy}:${sortOrder}`,
    populate: { path: 'userId', select: 'name email' },
  });

  return logs;
};

/**
 * Get activity summary stats for a user (with optional filters)
 */
export const getUserActivityStats = async (userId, filter = {}) => {
  const { dateFrom, dateTo, resource, action, method } = filter;
  const match = { userId: toObjectId(userId) };

  if (dateFrom || dateTo) {
    match.createdAt = {};
    if (dateFrom) match.createdAt.$gte = new Date(dateFrom);
    if (dateTo) {
      const d = new Date(dateTo);
      d.setUTCHours(23, 59, 59, 999);
      match.createdAt.$lte = d;
    }
  }
  if (resource) match.resource = resource;
  if (action) match.action = action;
  if (method) match.method = method;

  const [byAction, byResource, totals] = await Promise.all([
    UserActivityLog.aggregate([
      { $match: match },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    UserActivityLog.aggregate([
      { $match: match },
      { $group: { _id: '$resource', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
    UserActivityLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          creates: { $sum: { $cond: [{ $eq: ['$action', 'create'] }, 1, 0] } },
          updates: { $sum: { $cond: [{ $eq: ['$action', 'update'] }, 1, 0] } },
          deletes: { $sum: { $cond: [{ $eq: ['$action', 'delete'] }, 1, 0] } },
          reads: { $sum: { $cond: [{ $eq: ['$action', 'read'] }, 1, 0] } },
          lists: { $sum: { $cond: [{ $eq: ['$action', 'list'] }, 1, 0] } },
          logins: { $sum: { $cond: [{ $eq: ['$action', 'login'] }, 1, 0] } },
          errors: { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } },
        },
      },
    ]),
  ]);

  return {
    byAction,
    byResource,
    totals: totals[0] || {
      totalCalls: 0,
      creates: 0,
      updates: 0,
      deletes: 0,
      reads: 0,
      lists: 0,
      logins: 0,
      errors: 0,
    },
  };
};
