import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

/** One row per worker tick that did work. Finished rows carry `expireAt` and are TTL'd. */
const syncJobSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['push'], required: true },
    siteId: { type: String, required: true },
    status: { type: String, enum: ['RUNNING', 'SUCCEEDED', 'FAILED'], default: 'RUNNING' },
    startedAt: { type: Date, default: () => new Date() },
    finishedAt: { type: Date, default: null },
    stats: { type: mongoose.Schema.Types.Mixed, default: {} },
    error: { type: String, default: null },
    expireAt: { type: Date, default: undefined },
  },
  { timestamps: true, minimize: false }
);

syncJobSchema.index({ type: 1, startedAt: -1 });
syncJobSchema.index(
  { expireAt: 1 },
  { name: 'ttl_terminal', expireAfterSeconds: 0, partialFilterExpression: { expireAt: { $exists: true } } }
);

syncJobSchema.plugin(toJSON);
syncJobSchema.plugin(paginate);

const SyncJob = mongoose.models.SyncJob || mongoose.model('SyncJob', syncJobSchema);

export default SyncJob;
