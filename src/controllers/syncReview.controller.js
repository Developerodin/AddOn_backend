import config from '../config/config.js';
import catchAsync from '../utils/catchAsync.js';
import {
  listOpenConflicts,
  listConflictHistory,
  recordConflictResolution,
} from '../services/sync/syncConflict.service.js';
import { getReviewQueue } from '../services/sync/syncStatus.service.js';

/**
 * /v1/sync-review handlers (admin JWT). Intent only: nothing here imports or calls a business service.
 */
const SHADOW = Object.freeze({ applyMode: 'shadow', domainInvoked: false });

export const listConflicts = catchAsync(async (req, res) => {
  const [conflicts, queue] = await Promise.all([
    listOpenConflicts({ limit: req.query.limit }),
    getReviewQueue(),
  ]);
  res.send({ ...SHADOW, siteId: config.sync.siteId || null, conflicts, queue });
});

export const listConflictsHistory = catchAsync(async (req, res) => {
  const history = await listConflictHistory({
    page: req.query.page,
    limit: req.query.limit,
    entityType: req.query.entityType,
    aggregateId: req.query.aggregateId,
  });
  res.send({ ...SHADOW, siteId: config.sync.siteId || null, ...history });
});

export const resolveConflict = catchAsync(async (req, res) => {
  const out = await recordConflictResolution(req.params.id, req.body, config.sync.siteId || null, {
    userId: req.user && (req.user.id || req.user._id),
  });
  if (out.error) {
    return res.status(out.error.httpStatus).send({
      ...SHADOW,
      code: out.error.httpStatus,
      errorCode: out.error.code,
      message: out.error.message,
    });
  }
  return res.send({ ...SHADOW, intentOnly: true, conflict: out.conflict });
});
