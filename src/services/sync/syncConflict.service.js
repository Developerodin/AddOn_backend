import SyncConflict from '../../models/sync/syncConflict.model.js';
import { CONFLICT_STATUS } from '../../models/sync/syncConstants.js';

/**
 * Admin view of one open conflict. Old rows created before base/factory/cloud existed show empty objects.
 * @param {Record<string, any>} row lean SyncConflict
 */
const toReviewRow = (row) => ({
  id: String(row._id),
  entityType: row.entityType,
  aggregateId: row.aggregateId,
  aggregateVersion: row.aggregateVersion ?? null,
  status: row.status,
  reason: row.reason || '',
  base: row.base || {},
  factory: row.factory || {},
  cloud: row.cloud || {},
  factorySiteId: row.factorySiteId || null,
  cloudSiteId: row.cloudSiteId || null,
  changedKeys: row.changedKeys || [],
  nonOverlappingKeys: row.nonOverlappingKeys || [],
  createdAt: row.createdAt,
});

/** Audit log row: summary + resolution metadata (no heavy payload replay required). */
const toHistoryRow = (row) => {
  const res = row.resolution || {};
  return {
    id: String(row._id),
    entityType: row.entityType,
    aggregateId: row.aggregateId,
    aggregateVersion: row.aggregateVersion ?? null,
    changedKeys: row.changedKeys || [],
    factorySiteId: row.factorySiteId || null,
    cloudSiteId: row.cloudSiteId || null,
    createdAt: row.createdAt,
    resolution: {
      decision: res.decision || null,
      note: res.note || '',
      recordedAt: res.recordedAt || null,
      recordedByUserId: res.recordedByUserId || null,
      recordedBySiteId: res.recordedBySiteId || null,
    },
  };
};

/**
 * Open (CONFLICTED) rows, newest first. Read only.
 * @param {{ limit?: number }} [opts]
 */
export const listOpenConflicts = async ({ limit = 100 } = {}) => {
  const rows = await SyncConflict.find({ status: CONFLICT_STATUS.CONFLICTED }).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map(toReviewRow);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Paginated resolution audit log (RESOLUTION_RECORDED only). Read only.
 * @param {{ page?: number, limit?: number, entityType?: string, aggregateId?: string }} [opts]
 */
export const listConflictHistory = async ({ page = 1, limit = 20, entityType, aggregateId } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const safePage = Math.max(Number(page) || 1, 1);
  const filter = { status: CONFLICT_STATUS.RESOLUTION_RECORDED };
  if (entityType && String(entityType).trim()) {
    filter.entityType = String(entityType).trim();
  }
  if (aggregateId && String(aggregateId).trim()) {
    const term = escapeRegex(String(aggregateId).trim());
    filter.aggregateId = { $regex: term, $options: 'i' };
  }

  const skip = (safePage - 1) * safeLimit;
  const [rows, total] = await Promise.all([
    SyncConflict.find(filter).sort({ 'resolution.recordedAt': -1, createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
    SyncConflict.countDocuments(filter),
  ]);

  return {
    results: rows.map(toHistoryRow),
    page: safePage,
    limit: safeLimit,
    totalResults: total,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
};

/**
 * Records a resolution intent. Does not rebase, does not apply, does not call any domain service.
 * Clears `openKey` so a later concurrent edit on the same aggregate can open a new conflict.
 * @param {string} conflictId
 * @param {{ decision: string, note?: string }} body
 * @param {string|null} siteId authenticated site (site-key route) or this server's site (admin route)
 * @param {{ userId?: string|null }} [actor] admin user for the JWT route
 * @returns {Promise<{ conflict: object } | { error: { httpStatus: number, code: string, message: string } }>}
 */
export const recordConflictResolution = async (conflictId, { decision, note = '' }, siteId, { userId = null } = {}) => {
  const conflict = await SyncConflict.findOneAndUpdate(
    { _id: conflictId, status: CONFLICT_STATUS.CONFLICTED },
    {
      $set: {
        status: CONFLICT_STATUS.RESOLUTION_RECORDED,
        'resolution.decision': decision,
        'resolution.note': note,
        'resolution.recordedBySiteId': siteId || null,
        'resolution.recordedByUserId': userId ? String(userId) : null,
        'resolution.recordedAt': new Date(),
      },
      $unset: { openKey: '' },
    },
    { new: true }
  );
  if (conflict) return { conflict };

  const exists = await SyncConflict.exists({ _id: conflictId });
  if (!exists) return { error: { httpStatus: 404, code: 'NOT_FOUND', message: 'Conflict not found' } };
  return { error: { httpStatus: 422, code: 'NOT_CONFLICTED', message: 'Conflict is not in CONFLICTED state' } };
};
