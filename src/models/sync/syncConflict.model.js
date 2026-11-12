import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import { CONFLICT_STATUS } from './syncConstants.js';

/**
 * Concurrent edits to one aggregate, found on ingest (services/sync/syncConflictDetect.js).
 * - CONFLICTED: the same payload key changed on both sides. Needs an admin decision.
 * - REBASED: only different keys changed. `rebased` holds the merged view. Stored for review, never applied.
 * Resolve records intent only; nothing is applied to a business collection.
 */
const syncConflictSchema = new mongoose.Schema(
  {
    entityType: { type: String, required: true, trim: true },
    aggregateId: { type: String, required: true, trim: true },
    aggregateVersion: { type: Number, default: null },
    sourceSiteId: { type: String, required: true, trim: true },
    eventId: { type: String, required: true, trim: true },
    reason: { type: String, default: '' },
    status: { type: String, enum: Object.values(CONFLICT_STATUS), default: CONFLICT_STATUS.CONFLICTED },
    base: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    factory: { type: mongoose.Schema.Types.Mixed, default: null },
    cloud: { type: mongoose.Schema.Types.Mixed, default: null },
    factorySiteId: { type: String, default: null },
    cloudSiteId: { type: String, default: null },
    factoryEventId: { type: String, default: null },
    cloudEventId: { type: String, default: null },
    /** Keys present on both sides with different values. */
    changedKeys: { type: [String], default: [] },
    /** Keys present on only one side. */
    nonOverlappingKeys: { type: [String], default: [] },
    /** REBASED only: union of both payloads (without `base`). Not applied anywhere. */
    rebased: { type: mongoose.Schema.Types.Mixed, default: null },
    /** `${status}:${entityType}:${aggregateId}` while CONFLICTED or REBASED; unset on resolve. */
    openKey: { type: String, default: undefined },
    resolution: {
      decision: { type: String, enum: ['KEEP_LOCAL', 'KEEP_REMOTE', 'MANUAL', null], default: null },
      note: { type: String, default: '' },
      recordedBySiteId: { type: String, default: null },
      recordedByUserId: { type: String, default: null },
      recordedAt: { type: Date, default: null },
    },
  },
  { timestamps: true, minimize: false }
);

syncConflictSchema.index({ status: 1, createdAt: -1 });
syncConflictSchema.index({ entityType: 1, aggregateId: 1 });
/** At most one open conflict and one rebase result per aggregate, even under concurrent ingest. */
syncConflictSchema.index({ openKey: 1 }, { name: 'one_open_per_aggregate', unique: true, sparse: true });

syncConflictSchema.plugin(toJSON);
syncConflictSchema.plugin(paginate);

const SyncConflict = mongoose.models.SyncConflict || mongoose.model('SyncConflict', syncConflictSchema);

export default SyncConflict;
