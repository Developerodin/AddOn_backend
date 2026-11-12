import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

/**
 * Two cursor kinds, both required:
 * - `transport`: one row per (consumer, publisher) pair. `position` = highest contiguous acked originSequence.
 * - `apply`: one row per (consumer, aggregate). `position` = last applied aggregateVersion (unused in shadow v1).
 */
const syncCursorSchema = new mongoose.Schema(
  {
    consumerId: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['transport', 'apply'], required: true },
    publisherSiteId: { type: String, default: null, trim: true },
    /** null for transport rows */
    aggregateId: { type: String, default: null, trim: true },
    position: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

syncCursorSchema.index({ consumerId: 1, aggregateId: 1 }, { unique: true });

syncCursorSchema.plugin(toJSON);
syncCursorSchema.plugin(paginate);

const SyncCursor = mongoose.models.SyncCursor || mongoose.model('SyncCursor', syncCursorSchema);

export default SyncCursor;
