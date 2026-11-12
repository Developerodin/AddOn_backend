import SyncInbox from '../../models/sync/syncInbox.model.js';
import {
  INBOX_DELIVERY,
  INBOX_STATUS,
  SYNC_SCHEMA_VERSION,
  terminalExpireAt,
} from '../../models/sync/syncConstants.js';
import { hashEvent } from './syncHash.js';
import { checkEventPolicy } from './syncPolicy.js';
import { detectConcurrentEdit } from './syncConflictDetect.js';
import logger from '../../config/logger.js';
import { applyPilotEvent, isApplyPilotReceiverEnabled, isPilotApplyEvent } from './syncPilotApply.service.js';

/**
 * Receiver. Stores events durably. With SYNC_APPLY_PILOT=true, three pilot event types are then applied by
 * syncPilotApply.service.js; every other event is store-only (domainInvoked false).
 */

const toResultRow = (row) => ({
  id: String(row._id),
  status: row.status,
  delivery: row.delivery,
  receivedAt: row.receivedAt,
  quarantineReason: row.quarantineReason || null,
});

/**
 * Concurrent-edit check after the row is stored. Never fails the ingest: the event is already durable, and the
 * check is idempotent, so a sender retry (DUPLICATE path) runs it again.
 * @param {Record<string, any>} row stored inbox row
 */
const checkConcurrency = async (row) => {
  try {
    const found = await detectConcurrentEdit(row);
    return found.outcome === 'NONE' ? null : { outcome: found.outcome, conflictId: found.conflictId || null };
  } catch (err) {
    logger.warn(`[sync] concurrent-edit check failed for ${row.entityType}/${row.aggregateId}: ${err && err.message}`);
    return null;
  }
};

/**
 * Pilot apply after the row is stored. Never fails the ingest. Returns fields merged into the result row.
 * @param {Record<string, any>} row stored inbox row
 */
const maybeApply = async (row) => {
  if (!isApplyPilotReceiverEnabled() || !isPilotApplyEvent(row)) return {};
  try {
    const applied = await applyPilotEvent(row);
    const { domainInvoked, status, ...rest } = applied;
    return { domainInvoked: Boolean(domainInvoked), ...(status ? { status } : {}), apply: rest };
  } catch (err) {
    logger.warn(`[sync] pilot apply threw for ${row.entityType}/${row.aggregateId}: ${err && err.message}`);
    return {};
  }
};

/**
 * @param {string} sourceSiteId authenticated publisher
 * @param {Record<string, any>} event Joi-validated
 */
export const ingestEvent = async (sourceSiteId, event) => {
  const base = { eventId: event.eventId, domainInvoked: false };

  const refusal = checkEventPolicy(event, sourceSiteId);
  if (refusal) {
    return { ...base, outcome: 'REJECTED', httpStatus: 422, duplicate: false, ...refusal };
  }

  const payloadHash = hashEvent(event);
  if (event.payloadHash && event.payloadHash !== payloadHash) {
    return {
      ...base,
      outcome: 'REJECTED',
      httpStatus: 422,
      duplicate: false,
      code: 'PAYLOAD_HASH_MISMATCH',
      message: 'payloadHash does not match the canonical event hash',
    };
  }

  const quarantined = event.schemaVersion !== SYNC_SCHEMA_VERSION;
  const now = new Date();
  const doc = {
    sourceSiteId,
    eventId: event.eventId,
    originSequence: event.originSequence,
    entityType: event.entityType,
    aggregateId: event.aggregateId,
    aggregateVersion: event.aggregateVersion,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    origin: event.origin,
    occurredAt: event.occurredAt,
    payload: event.payload,
    payloadHash,
    status: quarantined ? INBOX_STATUS.QUARANTINED : INBOX_STATUS.PENDING,
    delivery: INBOX_DELIVERY.DURABLY_STORED,
    quarantineReason: quarantined ? 'UNSUPPORTED_SCHEMA_VERSION' : null,
    receivedAt: now,
    availableAt: now,
    ...(quarantined ? { expireAt: terminalExpireAt(now) } : {}),
  };

  try {
    const row = await SyncInbox.create(doc);
    const concurrency = quarantined ? null : await checkConcurrency({ ...doc, _id: row._id });
    // A CONFLICTED row is never claimed by apply, so a same-field conflict is never applied.
    const applied = quarantined ? {} : await maybeApply({ ...doc, _id: row._id });
    return {
      ...base,
      outcome: quarantined ? 'QUARANTINED' : 'STORED',
      httpStatus: quarantined ? 202 : 201,
      duplicate: false,
      ...toResultRow(row),
      ...(concurrency ? { status: concurrency.outcome === 'CONFLICTED' ? INBOX_STATUS.CONFLICTED : row.status, concurrency } : {}),
      ...applied,
    };
  } catch (err) {
    if (!err || err.code !== 11000) {
      return { ...base, outcome: 'ERROR', httpStatus: 500, duplicate: false, code: 'STORE_FAILED', message: 'Store failed' };
    }
    const existing = await SyncInbox.findOne({ sourceSiteId, eventId: event.eventId }).lean();
    if (existing && existing.payloadHash === payloadHash) {
      const concurrency = existing.status === INBOX_STATUS.QUARANTINED ? null : await checkConcurrency(existing);
      // Redelivery: apply only if the row is still claimable (e.g. waiting). An APPLIED row is never re-applied.
      const applied = existing.status === INBOX_STATUS.QUARANTINED ? {} : await maybeApply(existing);
      return {
        ...base,
        outcome: 'DUPLICATE',
        httpStatus: 200,
        duplicate: true,
        ...toResultRow(existing),
        ...(concurrency ? { concurrency } : {}),
        ...applied,
      };
    }
    return {
      ...base,
      outcome: 'REJECTED',
      httpStatus: 409,
      duplicate: false,
      code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
      message: 'eventId already stored with a different payload hash',
    };
  }
};

/**
 * Per-event results. One bad item never rolls back its siblings.
 * @param {string} sourceSiteId
 * @param {Array<Record<string, any>>} events
 */
export const ingestEvents = async (sourceSiteId, events) => {
  const results = [];
  // Sequential keeps per-aggregate arrival order and bounds load (batch max 100).
  for (const event of events) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await ingestEvent(sourceSiteId, event));
  }
  return results;
};
