import crypto from 'crypto';

/**
 * Deterministic JSON: object keys sorted at every depth, `undefined` dropped, Dates as ISO strings.
 * @param {*} value
 * @returns {string}
 */
export const canonicalJson = (value) => {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

/** @param {string} s */
export const sha256Hex = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

/** Fields that define an event's content. `eventId` is the idempotency key, so it is not part of the hash. */
const HASHED_EVENT_FIELDS = [
  'siteId',
  'originSequence',
  'entityType',
  'eventType',
  'aggregateId',
  'aggregateVersion',
  'schemaVersion',
  'origin',
  'payload',
];

/**
 * SHA-256 of the canonical event content. Same eventId + same hash = duplicate; different hash = 409.
 * @param {Record<string, *>} event
 * @returns {string}
 */
export const computeEventHash = (event) => {
  const subset = {};
  HASHED_EVENT_FIELDS.forEach((k) => {
    subset[k] = event[k];
  });
  return sha256Hex(canonicalJson(subset));
};

/** Inbox name for the same content hash. */
export const hashEvent = computeEventHash;
