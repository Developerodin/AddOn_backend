import Joi from 'joi';

/**
 * Factory sync env keys. All optional and dark by default. They are lenient on purpose: a missing or odd
 * SYNC_* value never stops boot. The single new boot failure is SYNC_APPLY_MODE other than `shadow`
 * (for example `apply`), because apply is illegal until section 19 ownership is settled.
 */
const lenient = (fallback, description) => Joi.string().allow('').default(fallback).description(description);

export const syncEnvKeys = {
  SYNC_ENABLED: lenient('false', 'Master switch. false = /v1/sync returns 404 and the shadow hook is a no-op'),
  SYNC_SHADOW_VENDOR_TRANSFER: lenient('false', 'Shadow outbox insert after a committed vendor floor transfer'),
  SYNC_WORKER_ENABLED: lenient('false', 'Start the sync push worker in the API process'),
  SYNC_APPLY_PILOT: lenient(
    'false',
    'Pilot capture + apply for yarnPurchaseOrderCreated, productionOrderCreated, productionArticleFloorTransfer only. Needs SYNC_ENABLED'
  ),
  SYNC_APPLY_MODE: Joi.string()
    .trim()
    .lowercase()
    .valid('shadow', '')
    .default('shadow')
    .description('Only `shadow` is accepted in this build. `apply` fails config load.'),
  SYNC_SITE_ID: lenient('', 'This publisher site id. Empty = hook skipped and worker not started'),
  SYNC_FACTORY_SITE_ID: lenient(
    'factory-mac',
    'Site id of the factory. Factory-owned events (floor, yarn issue/return, warehouse, vendor) are captured only there and applied only from it'
  ),
  SYNC_PEER_BASE_URL: lenient('', 'Peer sync API base, e.g. https://host/v1/sync. Empty = worker no-op'),
  SYNC_PEER_KEY_ID: lenient('', 'Key id this site presents to the peer'),
  SYNC_PEER_CREDENTIAL: lenient('', 'Credential this site presents to the peer'),
  SYNC_WORKER_INTERVAL_MS: lenient('60000', 'Worker tick interval in ms (min 5000)'),
};

/** @param {unknown} v */
const isTrue = (v) => String(v ?? '').trim().toLowerCase() === 'true';

/**
 * @param {Record<string, any>} envVars - Joi-validated env
 */
export const buildSyncConfig = (envVars) => ({
  enabled: isTrue(envVars.SYNC_ENABLED),
  shadowVendorTransfer: isTrue(envVars.SYNC_SHADOW_VENDOR_TRANSFER),
  workerEnabled: isTrue(envVars.SYNC_WORKER_ENABLED),
  applyPilot: isTrue(envVars.SYNC_APPLY_PILOT),
  applyMode: 'shadow',
  siteId: String(envVars.SYNC_SITE_ID || '').trim(),
  factorySiteId: String(envVars.SYNC_FACTORY_SITE_ID || 'factory-mac').trim(),
  peerBaseUrl: String(envVars.SYNC_PEER_BASE_URL || '')
    .trim()
    .replace(/\/+$/, ''),
  peerKeyId: String(envVars.SYNC_PEER_KEY_ID || '').trim(),
  peerCredential: String(envVars.SYNC_PEER_CREDENTIAL || ''),
  workerIntervalMs: Math.max(5000, Number(envVars.SYNC_WORKER_INTERVAL_MS) || 60000),
});
