import config from '../../config/config.js';
import SyncOwnership from '../../models/sync/syncOwnership.model.js';

/**
 * Domain apply is off in this build. Shadow transport never calls this.
 * A later apply path must call it and stop when `allowed` is false.
 *
 * @param {string} entityType
 * @returns {Promise<{ allowed: false, reason: string } | { allowed: true, direction: string, authority: string }>}
 */
export const getApplyDecision = async (entityType) => {
  if (!config.sync || config.sync.applyMode !== 'apply') {
    return { allowed: false, reason: 'SHADOW_ONLY' };
  }
  const row = await SyncOwnership.findOne({ entityType }).lean();
  if (!row) return { allowed: false, reason: 'OWNERSHIP_UNDECIDED' };
  return { allowed: true, direction: row.direction, authority: row.authority };
};

/**
 * Refuses to touch a business document. v1 always throws.
 *
 * @param {string} entityType
 * @returns {Promise<never>}
 */
export const refuseDomainApply = async (entityType) => {
  const decision = await getApplyDecision(entityType);
  const reason = decision.allowed ? 'APPLY_NOT_WIRED' : decision.reason;
  const error = new Error(`Domain apply refused: ${reason}`);
  error.code = reason;
  throw error;
};
