import crypto from 'crypto';
import os from 'os';
import config from '../../config/config.js';
import logger from '../../config/logger.js';
import SyncOutbox from '../../models/sync/syncOutbox.model.js';
import SyncJob from '../../models/sync/syncJob.model.js';
import { OUTBOX_STATUS, terminalExpireAt } from '../../models/sync/syncConstants.js';
import { toWireEvent } from './syncCursor.service.js';

/**
 * Sync push worker (shadow v1).
 * - Starts only when SYNC_ENABLED and SYNC_WORKER_ENABLED are true and SYNC_SITE_ID is set.
 * - No peer URL configured → every tick is a no-op.
 * - Claims per aggregate (max 5 per aggregate, 100 per tick) with a conditional PENDING → PROCESSING
 *   update and `lockedUntil`. HTTP happens only after the claim is written; nothing runs in a transaction.
 * - A failing event backs off its whole aggregate, so one poison event never blocks other flows.
 * - Never imports or calls a domain service.
 */

export const MAX_PER_AGGREGATE = 5;
export const MAX_PER_TICK = 100;
export const SCAN_LIMIT = 500;
export const LOCK_MS = 2 * 60 * 1000;
export const MAX_ATTEMPTS = 8;
export const PUSH_TIMEOUT_MS = 15000;

const BACKOFF_BASE_MS = 30 * 1000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;

/** @param {number} attempts attempts already made (>= 1) */
export const backoffMs = (attempts) => Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));

const defaultWorkerId = () => `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;

/**
 * Select and claim up to MAX_PER_TICK events, at most MAX_PER_AGGREGATE per aggregate, in aggregateVersion
 * order. An aggregate is skipped when its oldest open row is not claimable (in flight or backing off).
 * @param {{ workerId: string, now?: Date }} opts
 * @returns {Promise<Array<object>>} claimed rows (lean)
 */
export const claimBatch = async ({ workerId, now = new Date() }) => {
  // Release locks left by a crashed worker.
  await SyncOutbox.updateMany(
    { status: OUTBOX_STATUS.PROCESSING, lockedUntil: { $lt: now } },
    { $set: { status: OUTBOX_STATUS.PENDING, lockedUntil: null, lockedBy: null } }
  );

  const candidates = await SyncOutbox.find({ status: OUTBOX_STATUS.PENDING, availableAt: { $lte: now } })
    .sort({ availableAt: 1, aggregateId: 1, originSequence: 1 })
    .limit(SCAN_LIMIT)
    .select('entityType aggregateId')
    .lean();

  const aggregates = [];
  const seen = new Set();
  candidates.forEach((c) => {
    const key = `${c.entityType}\u0000${c.aggregateId}`;
    if (!seen.has(key)) {
      seen.add(key);
      aggregates.push({ entityType: c.entityType, aggregateId: c.aggregateId });
    }
  });

  const claimed = [];
  for (const agg of aggregates) {
    if (claimed.length >= MAX_PER_TICK) break;
    // eslint-disable-next-line no-await-in-loop
    const open = await SyncOutbox.find({
      entityType: agg.entityType,
      aggregateId: agg.aggregateId,
      status: { $in: [OUTBOX_STATUS.PENDING, OUTBOX_STATUS.PROCESSING] },
    })
      .sort({ aggregateVersion: 1 })
      .limit(MAX_PER_AGGREGATE)
      .select('_id status availableAt')
      .lean();

    for (const row of open) {
      if (claimed.length >= MAX_PER_TICK) break;
      if (row.status !== OUTBOX_STATUS.PENDING || row.availableAt > now) break;
      // eslint-disable-next-line no-await-in-loop
      const got = await SyncOutbox.findOneAndUpdate(
        { _id: row._id, status: OUTBOX_STATUS.PENDING, availableAt: { $lte: now } },
        {
          $set: { status: OUTBOX_STATUS.PROCESSING, lockedUntil: new Date(now.getTime() + LOCK_MS), lockedBy: workerId },
          $inc: { attempts: 1 },
        },
        { new: true }
      ).lean();
      if (!got) break; // someone else took it; keep this aggregate's order intact
      claimed.push(got);
    }
  }
  return claimed;
};

const ownFilter = (row, workerId) => ({ _id: row._id, status: OUTBOX_STATUS.PROCESSING, lockedBy: workerId });

const markAcked = (row, workerId, now) =>
  SyncOutbox.updateOne(ownFilter(row, workerId), {
    $set: {
      status: OUTBOX_STATUS.ACKED,
      ackedAt: now,
      lockedUntil: null,
      lockedBy: null,
      lastError: null,
      expireAt: terminalExpireAt(now),
    },
  });

const markQuarantined = (row, workerId, now, reason) =>
  SyncOutbox.updateOne(ownFilter(row, workerId), {
    $set: {
      status: OUTBOX_STATUS.QUARANTINED,
      quarantineReason: String(reason).slice(0, 500),
      lockedUntil: null,
      lockedBy: null,
      expireAt: terminalExpireAt(now),
    },
  });

const markRetry = async (row, workerId, now, error) => {
  if (row.attempts >= MAX_ATTEMPTS) {
    await markQuarantined(row, workerId, now, `MAX_ATTEMPTS: ${error}`);
    return 'quarantined';
  }
  const next = new Date(now.getTime() + backoffMs(row.attempts));
  await SyncOutbox.updateOne(ownFilter(row, workerId), {
    $set: {
      status: OUTBOX_STATUS.PENDING,
      availableAt: next,
      lockedUntil: null,
      lockedBy: null,
      lastError: String(error).slice(0, 500),
    },
  });
  // Hold the rest of this aggregate behind the failed head so it leaves the claimable set.
  await SyncOutbox.updateMany(
    {
      entityType: row.entityType,
      aggregateId: row.aggregateId,
      aggregateVersion: { $gt: row.aggregateVersion },
      status: OUTBOX_STATUS.PENDING,
      availableAt: { $lt: next },
    },
    { $set: { availableAt: next } }
  );
  return 'retry';
};

/**
 * POST claimed events to the peer. No session, no transaction.
 * @returns {Promise<{ ok: boolean, results?: Array<object>, error?: string }>}
 */
const pushToPeer = async (rows, fetchImpl) => {
  const { peerBaseUrl, peerKeyId, peerCredential, siteId } = config.sync;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${peerBaseUrl}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Key-Id': peerKeyId,
        'X-Sync-Credential': peerCredential,
        'X-Sync-Site': siteId,
      },
      body: JSON.stringify({ events: rows.map(toWireEvent) }),
      signal: controller.signal,
    });
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      body = null;
    }
    if (body && Array.isArray(body.results)) return { ok: true, results: body.results };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err && err.name === 'AbortError' ? 'TIMEOUT' : String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * One worker tick.
 * @param {{ fetchImpl?: Function, workerId?: string, now?: Date }} [opts]
 */
export const runPushTick = async (opts = {}) => {
  const { fetchImpl = globalThis.fetch, workerId = defaultWorkerId(), now = new Date() } = opts;
  if (!config.sync.peerBaseUrl) return { skipped: 'NO_PEER_URL' };
  if (!config.sync.siteId) return { skipped: 'NO_SITE_ID' };

  const rows = await claimBatch({ workerId, now });
  const stats = { claimed: rows.length, acked: 0, retry: 0, quarantined: 0 };
  if (rows.length === 0) return stats;

  const job = await SyncJob.create({ type: 'push', siteId: config.sync.siteId, stats });
  const push = await pushToPeer(rows, fetchImpl);
  const byId = new Map((push.results || []).map((r) => [r.eventId, r]));

  for (const row of rows) {
    const r = byId.get(row.eventId);
    let outcome;
    if (r && ['STORED', 'DUPLICATE', 'QUARANTINED'].includes(r.outcome)) {
      // eslint-disable-next-line no-await-in-loop
      await markAcked(row, workerId, now);
      outcome = 'acked';
    } else if (r && (r.httpStatus === 409 || r.httpStatus === 422)) {
      // eslint-disable-next-line no-await-in-loop
      await markQuarantined(row, workerId, now, `${r.code || r.httpStatus}: ${r.message || ''}`);
      outcome = 'quarantined';
    } else {
      // eslint-disable-next-line no-await-in-loop
      outcome = await markRetry(row, workerId, now, push.error || (r && r.code) || 'NO_RESULT');
    }
    stats[outcome] += 1;
  }

  await SyncJob.updateOne(
    { _id: job._id },
    {
      $set: {
        status: push.ok ? 'SUCCEEDED' : 'FAILED',
        finishedAt: new Date(),
        stats,
        error: push.ok ? null : push.error,
        expireAt: terminalExpireAt(),
      },
    }
  );
  return stats;
};

/**
 * Start the interval worker. Returns null (and logs) when it must not run. Never throws.
 * @returns {{ stop: () => void } | null}
 */
export const startSyncWorker = () => {
  const s = config.sync || {};
  if (!s.workerEnabled) return null;
  if (!s.enabled) {
    logger.warn('[sync] SYNC_WORKER_ENABLED=true but SYNC_ENABLED is not true; worker not started');
    return null;
  }
  if (!s.siteId) {
    logger.warn('[sync] SYNC_WORKER_ENABLED=true but SYNC_SITE_ID is empty; worker not started');
    return null;
  }
  if (!s.peerBaseUrl) logger.warn('[sync] SYNC_PEER_BASE_URL is empty; worker ticks are no-ops');

  const workerId = defaultWorkerId();
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const stats = await runPushTick({ workerId });
      if (stats.claimed) logger.info(`[sync] push tick ${JSON.stringify(stats)}`);
    } catch (err) {
      logger.error(`[sync] push tick failed: ${err && err.message}`);
    } finally {
      running = false;
    }
  }, s.workerIntervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info(`[sync] worker started site=${s.siteId} every ${s.workerIntervalMs}ms`);
  return {
    stop: () => clearInterval(timer),
  };
};

/** @param {{ stop: () => void } | null | undefined} handle */
export const stopSyncWorker = (handle) => {
  if (handle && typeof handle.stop === 'function') {
    handle.stop();
    logger.info('[sync] worker stopped');
  }
};
