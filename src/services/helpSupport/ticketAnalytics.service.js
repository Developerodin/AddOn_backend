import HelpSupportTicket, { TICKET_STATUS } from '../../models/helpSupport/ticket.model.js';

/**
 * Build analytics match filter from query params.
 * @param {Record<string, unknown>} query
 * @returns {Record<string, unknown>}
 */
const buildAnalyticsMatch = (query) => {
  const match = { isDeleted: false };

  if (query.dateFrom || query.dateTo) {
    match.createdAt = {};
    if (query.dateFrom) match.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) match.createdAt.$lte = new Date(query.dateTo);
  }
  if (query.assignedTo) match.assignedTo = query.assignedTo;
  if (query.category) match.category = query.category;
  if (query.priority) match.priority = query.priority;
  if (query.raisedBy) match.raisedBy = query.raisedBy;

  return match;
};

/**
 * Summary analytics cards.
 * @param {Record<string, unknown>} query
 */
export const getAnalyticsSummary = async (query) => {
  const match = buildAnalyticsMatch(query);
  const now = new Date();
  const openStatuses = ['raised', 'pending', 'in_progress', 'in_review', 'on_hold', 'awaiting_user', 'reopened'];

  const [totals] = await HelpSupportTicket.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalTickets: { $sum: 1 },
        openCount: { $sum: { $cond: [{ $in: ['$status', openStatuses] }, 1, 0] } },
        resolvedCount: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } },
        closedCount: { $sum: { $cond: [{ $in: ['$status', ['closed', 'cancelled']] }, 1, 0] } },
        avgTimeToFirstResponseMs: {
          $avg: {
            $cond: [
              { $ifNull: ['$firstResponseAt', false] },
              { $subtract: ['$firstResponseAt', '$createdAt'] },
              null,
            ],
          },
        },
        avgTimeToResolutionMs: {
          $avg: {
            $cond: [
              { $ifNull: ['$resolvedAt', false] },
              { $subtract: ['$resolvedAt', '$createdAt'] },
              null,
            ],
          },
        },
        slaBreachCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ifNull: ['$slaDueAt', false] },
                  {
                    $or: [
                      { $gt: ['$resolvedAt', '$slaDueAt'] },
                      { $and: [{ $eq: ['$resolvedAt', null] }, { $lt: ['$slaDueAt', now] }] },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  const base = totals || {
    totalTickets: 0,
    openCount: 0,
    resolvedCount: 0,
    closedCount: 0,
    avgTimeToFirstResponseMs: null,
    avgTimeToResolutionMs: null,
    slaBreachCount: 0,
  };

  const breachRate = base.totalTickets ? base.slaBreachCount / base.totalTickets : 0;

  return {
    range: { from: query.dateFrom || null, to: query.dateTo || null },
    totalTickets: base.totalTickets,
    openCount: base.openCount,
    resolvedCount: base.resolvedCount,
    closedCount: base.closedCount,
    avgTimeToFirstResponseMs: base.avgTimeToFirstResponseMs,
    avgTimeToResolutionMs: base.avgTimeToResolutionMs,
    slaBreachCount: base.slaBreachCount,
    slaBreachRate: breachRate,
  };
};

/**
 * Aggregate time spent in each status.
 * @param {Record<string, unknown>} query
 */
export const getTimeInStatusAnalytics = async (query) => {
  const match = buildAnalyticsMatch(query);

  const statusFields = TICKET_STATUS.reduce((acc, status) => {
    acc[status] = { $ifNull: [`$timeInStatus.${status}`, 0] };
    return acc;
  }, {});

  const [rollup] = await HelpSupportTicket.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalTickets: { $sum: 1 },
        ...TICKET_STATUS.reduce((acc, status) => {
          acc[`total_${status}`] = { $sum: statusFields[status] };
          return acc;
        }, {}),
        totalLifetimeMs: {
          $sum: {
            $subtract: [{ $ifNull: ['$closedAt', new Date()] }, '$createdAt'],
          },
        },
      },
    },
  ]);

  const totalTickets = rollup?.totalTickets || 0;
  const perStatus = {};

  TICKET_STATUS.forEach((status) => {
    const totalMs = rollup?.[`total_${status}`] || 0;
    perStatus[status] = {
      totalMs,
      avgMs: totalTickets ? totalMs / totalTickets : 0,
      tickets: totalTickets,
    };
  });

  return {
    range: { from: query.dateFrom || null, to: query.dateTo || null },
    totalTickets,
    totalTimeMs: rollup?.totalLifetimeMs || 0,
    perStatus,
  };
};

/**
 * Ticket counts grouped by status.
 * @param {Record<string, unknown>} query
 */
export const getByStatus = async (query) => {
  const match = buildAnalyticsMatch(query);
  const rows = await HelpSupportTicket.aggregate([
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return { results: rows.map((r) => ({ status: r._id, count: r.count })) };
};

/**
 * Ticket counts grouped by disposition.
 * @param {Record<string, unknown>} query
 */
export const getByDisposition = async (query) => {
  const match = buildAnalyticsMatch(query);
  const rows = await HelpSupportTicket.aggregate([
    { $match: match },
    { $group: { _id: '$disposition', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return { results: rows.map((r) => ({ disposition: r._id, count: r.count })) };
};

/**
 * Per-agent workload and avg resolution time.
 * @param {Record<string, unknown>} query
 */
export const getAgentWorkload = async (query) => {
  const match = buildAnalyticsMatch(query);
  const openStatuses = ['raised', 'pending', 'in_progress', 'in_review', 'on_hold', 'awaiting_user', 'reopened'];

  const rows = await HelpSupportTicket.aggregate([
    { $match: { ...match, assignedTo: { $ne: null } } },
    {
      $group: {
        _id: '$assignedTo',
        openCount: { $sum: { $cond: [{ $in: ['$status', openStatuses] }, 1, 0] } },
        totalAssigned: { $sum: 1 },
        avgResolutionMs: {
          $avg: {
            $cond: [
              { $ifNull: ['$resolvedAt', false] },
              { $subtract: ['$resolvedAt', '$createdAt'] },
              null,
            ],
          },
        },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'agent',
      },
    },
    { $unwind: { path: '$agent', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        agentId: '$_id',
        agentName: '$agent.name',
        agentEmail: '$agent.email',
        openCount: 1,
        totalAssigned: 1,
        avgResolutionMs: 1,
      },
    },
    { $sort: { openCount: -1 } },
  ]);

  return { results: rows };
};

/**
 * Created vs resolved trend over time.
 * @param {Record<string, unknown>} query
 */
export const getTrend = async (query) => {
  const match = buildAnalyticsMatch(query);
  const bucket = query.bucket === 'week' ? 'week' : 'day';

  const dateFormat = bucket === 'week' ? '%Y-W%V' : '%Y-%m-%d';

  const [created, resolved] = await Promise.all([
    HelpSupportTicket.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    HelpSupportTicket.aggregate([
      { $match: { ...match, resolvedAt: { $ne: null } } },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: '$resolvedAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  return {
    bucket,
    created: created.map((r) => ({ period: r._id, count: r.count })),
    resolved: resolved.map((r) => ({ period: r._id, count: r.count })),
  };
};
