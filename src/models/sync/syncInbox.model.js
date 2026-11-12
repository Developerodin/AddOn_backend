import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import { INBOX_DELIVERY, INBOX_STATUS, SYNC_ORIGIN } from './syncConstants.js';

/**
 * Receiver-side durable store. Shadow mode: rows are stored and never applied to business collections.
 */
const syncInboxSchema = new mongoose.Schema(
  {
    sourceSiteId: { type: String, required: true, trim: true },
    eventId: { type: String, required: true, trim: true },
    originSequence: { type: Number, required: true, min: 1 },
    entityType: { type: String, required: true, trim: true },
    aggregateId: { type: String, required: true, trim: true },
    aggregateVersion: { type: Number, required: true, min: 1 },
    eventType: { type: String, required: true, trim: true },
    schemaVersion: { type: Number, required: true },
    origin: { type: String, enum: Object.values(SYNC_ORIGIN), required: true },
    occurredAt: { type: Date, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    payloadHash: { type: String, required: true },
    status: { type: String, enum: Object.values(INBOX_STATUS), default: INBOX_STATUS.PENDING, required: true },
    delivery: { type: String, enum: Object.values(INBOX_DELIVERY), default: INBOX_DELIVERY.DURABLY_STORED },
    quarantineReason: { type: String, default: null },
    receivedAt: { type: Date, default: () => new Date() },
    attempts: { type: Number, default: 0, min: 0 },
    availableAt: { type: Date, default: () => new Date(), required: true },
    lockedUntil: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    lastError: { type: String, default: null },
    /** Set only on terminal rows (QUARANTINED). Pending rows are never TTL'd. */
    expireAt: { type: Date, default: undefined },
  },
  { timestamps: true, minimize: false }
);

syncInboxSchema.index({ sourceSiteId: 1, eventId: 1 }, { unique: true });
/** Concurrent-edit lookup on ingest (services/sync/syncConflictDetect.js). */
syncInboxSchema.index({ entityType: 1, aggregateId: 1, aggregateVersion: 1 }, { name: 'concurrent_edit_lookup' });
syncInboxSchema.index(
  { availableAt: 1, aggregateId: 1, originSequence: 1 },
  { name: 'claim_pending', partialFilterExpression: { status: INBOX_STATUS.PENDING } }
);
syncInboxSchema.index(
  { expireAt: 1 },
  { name: 'ttl_terminal', expireAfterSeconds: 0, partialFilterExpression: { expireAt: { $exists: true } } }
);

syncInboxSchema.plugin(toJSON);
syncInboxSchema.plugin(paginate);

const SyncInbox = mongoose.models.SyncInbox || mongoose.model('SyncInbox', syncInboxSchema);

export default SyncInbox;
