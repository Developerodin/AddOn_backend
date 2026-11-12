import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import { OUTBOX_STATUS, SYNC_ORIGIN, SYNC_SCHEMA_VERSION } from './syncConstants.js';

/**
 * Publisher-side event log. Written after a floor commit (never inside the floor session).
 * - transport order: (siteId, originSequence)
 * - apply/claim order: per aggregate, by aggregateVersion
 */
const syncOutboxSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, trim: true },
    siteId: { type: String, required: true, trim: true },
    originSequence: { type: Number, required: true, min: 1 },
    entityType: { type: String, required: true, trim: true },
    aggregateId: { type: String, required: true, trim: true },
    aggregateVersion: { type: Number, required: true, min: 1 },
    eventType: { type: String, required: true, trim: true },
    schemaVersion: { type: Number, required: true, default: SYNC_SCHEMA_VERSION },
    origin: { type: String, enum: Object.values(SYNC_ORIGIN), required: true },
    occurredAt: { type: Date, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    payloadHash: { type: String, required: true },
    status: { type: String, enum: Object.values(OUTBOX_STATUS), default: OUTBOX_STATUS.PENDING, required: true },
    attempts: { type: Number, default: 0, min: 0 },
    availableAt: { type: Date, default: () => new Date(), required: true },
    lockedUntil: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    lastError: { type: String, default: null },
    ackedAt: { type: Date, default: null },
    quarantineReason: { type: String, default: null },
    /** Set only on terminal rows (ACKED / QUARANTINED). Pending backlog is never TTL'd. */
    expireAt: { type: Date, default: undefined },
  },
  { timestamps: true, minimize: false }
);

syncOutboxSchema.index({ eventId: 1 }, { unique: true });
syncOutboxSchema.index({ siteId: 1, originSequence: 1 }, { unique: true });
syncOutboxSchema.index({ entityType: 1, aggregateId: 1, aggregateVersion: 1 }, { unique: true });
syncOutboxSchema.index(
  { availableAt: 1, aggregateId: 1, originSequence: 1 },
  { name: 'claim_pending', partialFilterExpression: { status: OUTBOX_STATUS.PENDING } }
);
syncOutboxSchema.index(
  { lockedUntil: 1 },
  { name: 'reclaim_stale_processing', partialFilterExpression: { status: OUTBOX_STATUS.PROCESSING } }
);
syncOutboxSchema.index(
  { expireAt: 1 },
  { name: 'ttl_terminal', expireAfterSeconds: 0, partialFilterExpression: { expireAt: { $exists: true } } }
);

syncOutboxSchema.plugin(toJSON);
syncOutboxSchema.plugin(paginate);

const SyncOutbox = mongoose.models.SyncOutbox || mongoose.model('SyncOutbox', syncOutboxSchema);

export default SyncOutbox;
