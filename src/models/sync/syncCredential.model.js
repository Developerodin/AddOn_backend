import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

/**
 * Site-to-site credential for /v1/sync. Separate from the website order ingest key (apiKeyAuth).
 * Only the SHA-256 of the secret is stored. Seed with `src/scripts/sync-create-credential.js`.
 */
const syncCredentialSchema = new mongoose.Schema(
  {
    keyId: { type: String, required: true, trim: true },
    secretHash: { type: String, required: true, private: true },
    siteId: { type: String, required: true, trim: true },
    label: { type: String, default: '' },
    revoked: { type: Boolean, default: false },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

syncCredentialSchema.index({ keyId: 1 }, { unique: true });

syncCredentialSchema.plugin(toJSON);
syncCredentialSchema.plugin(paginate);

const SyncCredential = mongoose.models.SyncCredential || mongoose.model('SyncCredential', syncCredentialSchema);

export default SyncCredential;
