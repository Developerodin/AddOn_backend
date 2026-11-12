import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

/**
 * Who may edit a synced entity. Empty until Section 19 is decided.
 * No row means domain apply stays illegal.
 */
const syncOwnershipSchema = new mongoose.Schema(
  {
    entityType: { type: String, required: true, trim: true },
    direction: {
      type: String,
      required: true,
      enum: ['local_to_cloud', 'cloud_to_local', 'bidirectional'],
    },
    authority: { type: String, required: true, enum: ['factory', 'cloud', 'configured'] },
  },
  { timestamps: true }
);

syncOwnershipSchema.index({ entityType: 1 }, { unique: true });
syncOwnershipSchema.plugin(toJSON);
syncOwnershipSchema.plugin(paginate);

const SyncOwnership = mongoose.models.SyncOwnership || mongoose.model('SyncOwnership', syncOwnershipSchema);

export default SyncOwnership;
