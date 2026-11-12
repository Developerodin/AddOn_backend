/** Shared sync enums. Pure constants, no side effects. */

/**
 * Outbox (publisher side). A retryable failure goes back to PENDING with `lastError` and a later
 * `availableAt`, so the claim index can use a portable `$eq` partial filter.
 * ACKED means the peer transport stored the event. It does NOT mean a business result was applied.
 */
export const OUTBOX_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  ACKED: 'ACKED',
  QUARANTINED: 'QUARANTINED',
});

/**
 * Inbox (receiver side). Shadow mode stores valid events as PENDING. ACKNOWLEDGED is intentionally absent:
 * that word is reserved for a later apply path that commits a business result.
 */
export const INBOX_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  QUARANTINED: 'QUARANTINED',
  CONFLICTED: 'CONFLICTED',
  /** Pilot apply (SYNC_APPLY_PILOT) committed the business result. Terminal. */
  APPLIED: 'APPLIED',
  /** Pilot apply: a prerequisite (the production order) is not on this database yet. Retried when it lands. */
  WAITING_DEPENDENCY: 'WAITING_DEPENDENCY',
  /** Pilot apply threw. `lastError` holds the reason. */
  APPLY_FAILED: 'APPLY_FAILED',
});

export const INBOX_DELIVERY = Object.freeze({ DURABLY_STORED: 'DURABLY_STORED' });

/**
 * CONFLICTED = same field edited on both sides; needs an admin decision. Counted as an open conflict.
 * REBASED = both sides edited different fields; the merged view is stored for review. Not an open conflict, not applied.
 */
export const CONFLICT_STATUS = Object.freeze({
  CONFLICTED: 'CONFLICTED',
  RESOLUTION_RECORDED: 'RESOLUTION_RECORDED',
  REBASED: 'REBASED',
});

export const SYNC_ORIGIN = Object.freeze({ USER: 'user', SYNC: 'sync' });

export const SYNC_SCHEMA_VERSION = 1;

/** Terminal rows are kept this long, then TTL'd. Non-terminal rows never get `expireAt`. */
export const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const terminalExpireAt = (from = new Date()) => new Date(from.getTime() + TERMINAL_RETENTION_MS);
