/**
 * Generic document sync (`documentUpserted`) constants. Pure, no I/O, no mongoose import, so the receiver policy can
 * use them without loading models.
 */

export const DOCUMENT_UPSERTED_EVENT_TYPE = 'documentUpserted';

/** The source row was deleted. Applied as deleteOne by `_id` (a second delivery deletes nothing extra). */
export const DOCUMENT_REMOVED_EVENT_TYPE = 'documentRemoved';

/** A snapshot above this size is not captured (logged instead). */
export const MAX_DOCUMENT_SNAPSHOT_BYTES = 512 * 1024;

/** Receiver limit for a documentUpserted payload: the snapshot plus the small envelope (_id, modelName, collectionName). */
export const MAX_DOCUMENT_PAYLOAD_BYTES = MAX_DOCUMENT_SNAPSHOT_BYTES + 4 * 1024;

/**
 * Never captured, never applied. Logs, tokens, vectors, derived snapshots and the sync tables themselves.
 * Business counters (`*Counter`) are excluded too: shipping a counter row would overwrite the peer's sequence and
 * break its number generator.
 */
export const EXCLUDED_MODEL_NAMES = Object.freeze([
  'UserActivityLog',
  'Token',
  'FaqVector',
  'YarnDailyClosingSnapshot',
  'FloorStatistics',
  'WebsiteOrderOutboundQueue',
  'SyncOutbox',
  'SyncInbox',
  'SyncCursor',
  'SyncCredential',
  'SyncCounter',
  'SyncConflict',
  'SyncJob',
  'SyncOwnership',
]);

const EXCLUDED_SET = new Set(EXCLUDED_MODEL_NAMES);
const EXCLUDED_SUFFIX_RE = /(SyncLog|Counter)$/;
const MODEL_NAME_RE = /^[A-Z][A-Za-z0-9_]{0,63}$/;

/**
 * True when a mongoose model with this name is captured by the registrar (and accepted by the receiver).
 * @param {unknown} name mongoose model name
 * @returns {boolean}
 */
export const isCapturableModelName = (name) =>
  typeof name === 'string' && MODEL_NAME_RE.test(name) && !EXCLUDED_SET.has(name) && !EXCLUDED_SUFFIX_RE.test(name);
