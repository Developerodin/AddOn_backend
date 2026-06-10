/**
 * Redacts credentials from a Mongo URI for safe logging.
 *
 * @param {string} uri
 * @returns {string}
 */
export function redactMongoUri(uri) {
  return String(uri || '').replace(/^(mongodb(?:\+srv)?:\/\/)([^@]+)@/i, '$1***:***@');
}

/**
 * Sets or replaces `retryWrites` (and write concern for standalone) on a MongoDB URI.
 * Standalone MongoDB on EC2 requires `retryWrites=false` and `w=1` (not `w=majority`).
 *
 * @param {string} uri - Mongo connection string
 * @param {boolean} [enabled=false] - Whether retryable writes are enabled
 * @returns {string}
 */
export function setRetryWritesOnUri(uri, enabled = false) {
  const raw = String(uri || '').trim();
  if (!raw) return raw;

  const qIdx = raw.indexOf('?');
  const base = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const query = qIdx === -1 ? '' : raw.slice(qIdx + 1);

  const params = new Map();
  if (query) {
    for (const part of query.split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      const key = (eq === -1 ? part : part.slice(0, eq)).trim();
      const val = eq === -1 ? '' : part.slice(eq + 1);
      const keyLower = key.toLowerCase();
      if (!key || keyLower === 'retrywrites') continue;
      if (!enabled && keyLower === 'w' && val === 'majority') continue;
      params.set(key, val);
    }
  }

  params.set('retryWrites', enabled ? 'true' : 'false');
  if (!enabled) params.set('w', '1');

  const qs = [...params.entries()]
    .map(([k, v]) => (v === '' ? k : `${k}=${v}`))
    .join('&');

  return `${base}?${qs}`;
}

/**
 * Parses `MONGODB_RETRY_WRITES` env value (defaults to false for standalone hosts).
 *
 * @param {string | boolean | undefined} raw
 * @returns {boolean}
 */
export function parseMongoRetryWrites(raw) {
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  return false;
}
