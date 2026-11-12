import mongoose from 'mongoose';

/**
 * Atomic counters for `originSequence` (key `site:<siteId>`) and `aggregateVersion`
 * (key `agg:<entityType>:<aggregateId>`). Incremented with `$inc`, never inside a floor session.
 * A burned value (insert failed after `$inc`) is acceptable in shadow v1.
 */
const syncCounterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false }
);

const SyncCounter = mongoose.models.SyncCounter || mongoose.model('SyncCounter', syncCounterSchema);

export default SyncCounter;
