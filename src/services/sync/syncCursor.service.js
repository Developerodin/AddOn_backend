import SyncCursor from '../../models/sync/syncCursor.model.js';
import SyncOutbox from '../../models/sync/syncOutbox.model.js';

/**
 * Transport cursor: per (consumer site, publisher site), position = highest contiguous acked originSequence.
 * Burned sequences (gaps) are never served, so "contiguous" means contiguous over rows that exist.
 */

export const transportConsumerId = (consumerSiteId, publisherSiteId) =>
  `transport:${consumerSiteId}:${publisherSiteId}`;

/** @returns {Promise<number>} */
export const getTransportPosition = async (consumerSiteId, publisherSiteId) => {
  const row = await SyncCursor.findOne({
    consumerId: transportConsumerId(consumerSiteId, publisherSiteId),
    aggregateId: null,
  }).lean();
  return row ? row.position : 0;
};

/** Wire shape of an outbox row (no worker/lock fields). */
export const toWireEvent = (row) => ({
  eventId: row.eventId,
  siteId: row.siteId,
  originSequence: row.originSequence,
  entityType: row.entityType,
  aggregateId: row.aggregateId,
  aggregateVersion: row.aggregateVersion,
  eventType: row.eventType,
  schemaVersion: row.schemaVersion,
  origin: row.origin,
  occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : row.occurredAt,
  payload: row.payload,
  payloadHash: row.payloadHash,
});

/**
 * @param {{ consumerSiteId: string, publisherSiteId: string, after?: number, limit?: number }} input
 */
export const listEventsForConsumer = async ({ consumerSiteId, publisherSiteId, after, limit = 100 }) => {
  const from = Number.isInteger(after) ? after : await getTransportPosition(consumerSiteId, publisherSiteId);
  const rows = await SyncOutbox.find({ siteId: publisherSiteId, originSequence: { $gt: from } })
    .sort({ originSequence: 1 })
    .limit(Math.min(Math.max(1, limit), 100))
    .lean();
  const events = rows.map(toWireEvent);
  return { after: from, events, nextAfter: events.length ? events[events.length - 1].originSequence : from };
};

/**
 * Advance only through the contiguous prefix of existing outbox rows that the consumer acked.
 * Never moves backwards ($max).
 * @param {{ consumerSiteId: string, publisherSiteId: string, sequences: number[] }} input
 */
export const ackSequences = async ({ consumerSiteId, publisherSiteId, sequences }) => {
  const consumerId = transportConsumerId(consumerSiteId, publisherSiteId);
  const before = await getTransportPosition(consumerSiteId, publisherSiteId);
  const acked = new Set(sequences.filter((n) => n > before));

  let position = before;
  if (acked.size > 0) {
    const maxAcked = Math.max(...acked);
    const rows = await SyncOutbox.find({
      siteId: publisherSiteId,
      originSequence: { $gt: before, $lte: maxAcked },
    })
      .select('originSequence')
      .sort({ originSequence: 1 })
      .lean();
    for (const r of rows) {
      if (!acked.has(r.originSequence)) break;
      position = r.originSequence;
    }
  }

  if (position > before) {
    await SyncCursor.updateOne(
      { consumerId, aggregateId: null },
      {
        $max: { position },
        $setOnInsert: { kind: 'transport', publisherSiteId },
      },
      { upsert: true }
    );
  }

  const current = Math.max(position, await getTransportPosition(consumerSiteId, publisherSiteId));
  const notAdvanced = sequences.filter((n) => n > current).sort((a, b) => a - b);
  return { previousPosition: before, position: current, notAdvanced };
};
