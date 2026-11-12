/** Outbox row lifecycle. ACKED = the peer durably stored it. */
export const SyncOutboxStatus = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  FAILED: 'FAILED',
  ACKED: 'ACKED',
  QUARANTINED: 'QUARANTINED',
});

/**
 * Inbox row lifecycle. v1 is shadow only: rows stay PENDING (or QUARANTINED).
 * There is deliberately no ACKNOWLEDGED value: that word is reserved for a later apply that committed a business result.
 */
export const SyncInboxStatus = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  FAILED: 'FAILED',
  QUARANTINED: 'QUARANTINED',
  CONFLICTED: 'CONFLICTED',
});

export const SyncDelivery = Object.freeze({
  DURABLY_STORED: 'DURABLY_STORED',
});

export const SyncOrigin = Object.freeze({
  USER: 'user',
  SYNC: 'sync',
});

export const SyncConflictStatus = Object.freeze({
  CONFLICTED: 'CONFLICTED',
  RESOLUTION_RECORDED: 'RESOLUTION_RECORDED',
});

export const SyncCursorKind = Object.freeze({
  TRANSPORT: 'transport',
  APPLY: 'apply',
});

/** Terminal rows get a TTL `expireAt`. Pending/failed rows never do, so an outage cannot delete the backlog. */
export const SYNC_TERMINAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const SYNC_SCHEMA_VERSION = 1;
