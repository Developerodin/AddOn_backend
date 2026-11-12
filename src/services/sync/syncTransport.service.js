import SyncOutbox from '../../models/sync/syncOutbox.model.js';
import SyncCursor from '../../models/sync/syncCursor.model.js';
import { SyncCursorKind, SyncOutboxStatus, SYNC_TERMINAL_TTL_MS } from '../../models/sync/syncEnums.js';

/**
 * Pull/ack over this site's outbox, ordered by `originSequence`. The transport cursor is per
 * (consumer site, publisher site) and only advances over a contiguous prefix.
 *
 * A sequence can be burned (allocated, then the outbox insert failed). A gap younger than
 * GAP_GRACE_MS is treated as an in-flight insert and stops the page; an older gap is skipped.
 */

export const GAP_GRACE_MS = 30 * 1000;
export const MAX_PULL_LIMIT = 100;
const MAX_ACK_SPAN_ROWS = 1000;

/**
 * @param {string} consumerId
 * @param {string} peerSiteId
 * @returns {Promise<number>}
 */
export const getTransportPosition = async (consumerId, peerSiteId) => {
  const row = await SyncCursor.findOne({ kind: SyncCursorKind.TRANSPORT, consumerId, peerSiteId }).lean();
  return row ? row.position : 0;
};

/**
 * Keep rows from `after + 1` while the sequence is contiguous or the gap is old enough to be a burned value.
 * @param {Array<{ originSequence: number, createdAt: Date }>} rows sorted by originSequence
 * @param {number} after
 * @param {number} now
 */
export const contiguousPrefix = (rows, after, now = Date.now()) => {
  const out = [];
  let expected = after + 1;
  for (const row of rows) {
    if (row.originSequence !== expected) {
      const age = now - new Date(row.createdAt).getTime();
      if (age < GAP_GRACE_MS) break;
    }
    out.push(row);
    expected = row.originSequence + 1;
  }
  return out;
};

/** @param {Record<string, *>} row */
export const toWireEvent = (row) => ({
  eventId: row.eventId,
  siteId: row.siteId,
  originSequence: row.originSequence,
  entityType: row.entityType,
  eventType: row.eventType,
  aggregateId: row.aggregateId,
  aggregateVersion: row.aggregateVersion,
  schemaVersion: row.schemaVersion,
  origin: row.origin,
  payload: row.payload,
});

/**
 * @param {{ localSiteId: string, consumerId: string, after?: number, limit?: number }} params
 */
export const listOutboxForPeer = async ({ localSiteId, consumerId, after, limit = MAX_PULL_LIMIT }) => {
  const cursor = await getTransportPosition(consumerId, localSiteId);
  const start = Number.isInteger(after) ? after : cursor;
  const rows = await SyncOutbox.find({ siteId: localSiteId, originSequence: { $gt: start } })
    .sort({ originSequence: 1 })
    .limit(Math.min(Math.max(1, limit), MAX_PULL_LIMIT))
    .lean();
  const page = contiguousPrefix(rows, start);
  return {
    siteId: localSiteId,
    cursor,
    after: start,
    events: page.map(toWireEvent),
    nextAfter: page.length > 0 ? page[page.length - 1].originSequence : start,
  };
};

/**
 * Advance the consumer's cursor to `upToSequence` only if the contiguous run from the current cursor reaches it.
 * @param {{ localSiteId: string, consumerId: string, upToSequence: number }} params
 * @returns {Promise<{ ok: true, cursor: number, advanced: boolean } | { ok: false, code: string, message: string, cursor: number }>}
 */
export const ackOutboxForPeer = async ({ localSiteId, consumerId, upToSequence }) => {
  const current = await getTransportPosition(consumerId, localSiteId);
  if (upToSequence <= current) {
    return { ok: true, cursor: current, advanced: false };
  }

  const rows = await SyncOutbox.find({ siteId: localSiteId, originSequence: { $gt: current, $lte: upToSequence } })
    .sort({ originSequence: 1 })
    .limit(MAX_ACK_SPAN_ROWS + 1)
    .select({ originSequence: 1, createdAt: 1 })
    .lean();
  if (rows.length > MAX_ACK_SPAN_ROWS) {
    return { ok: false, code: 'ACK_RANGE_TOO_LARGE', message: `ack at most ${MAX_ACK_SPAN_ROWS} rows at a time`, cursor: current };
  }
  const prefix = contiguousPrefix(rows, current);
  const reached = prefix.length > 0 ? prefix[prefix.length - 1].originSequence : current;
  if (reached !== upToSequence) {
    return {
      ok: false,
      code: 'ACK_NOT_CONTIGUOUS',
      message: `can only ack a contiguous prefix; highest ackable is ${reached}`,
      cursor: current,
    };
  }

  const filter = { kind: SyncCursorKind.TRANSPORT, consumerId, peerSiteId: localSiteId };
  await SyncCursor.updateOne(filter, { $setOnInsert: { position: 0 } }, { upsert: true }).catch((err) => {
    if (err?.code !== 11000) throw err;
  });
  // Only moves forward. A concurrent ack that already went further wins.
  await SyncCursor.updateOne({ ...filter, position: { $lt: upToSequence } }, { $set: { position: upToSequence } });

  const now = new Date();
  await SyncOutbox.updateMany(
    {
      siteId: localSiteId,
      originSequence: { $gt: current, $lte: upToSequence },
      status: { $in: [SyncOutboxStatus.PENDING, SyncOutboxStatus.FAILED] },
    },
    {
      $set: {
        status: SyncOutboxStatus.ACKED,
        claimable: false,
        ackedAt: now,
        lockedUntil: null,
        expireAt: new Date(now.getTime() + SYNC_TERMINAL_TTL_MS),
      },
    }
  );

  return { ok: true, cursor: await getTransportPosition(consumerId, localSiteId), advanced: true };
};
