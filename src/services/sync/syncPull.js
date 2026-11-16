import config from '../../config/config.js';
import logger from '../../config/logger.js';
import { ingestEvents } from './syncInbox.service.js';

const PULL_TIMEOUT_MS = 15000;
const PULL_PAGE_SIZE = 100;

/**
 * Pull the peer outbox into this site.
 * The factory runs this because the cloud server cannot open a connection to the factory LAN.
 * Apply goes through ingestEvents, which does not write a new outbox row, so a pulled change is not sent back.
 */

/** Pages read in one tick, so a backlog drains without holding the process. */
export const MAX_PULL_PAGES = 5;

/**
 * One HTTP call to the peer sync API. Never throws.
 * @param {Function} fetchImpl
 * @param {string} path path under the peer base, beginning with /
 * @param {RequestInit} [init]
 * @returns {Promise<{ ok: boolean, status: number, body: any, error?: string }>}
 */
const peerRequest = async (fetchImpl, path, init = {}) => {
  const { peerBaseUrl, peerKeyId, peerCredential, siteId } = config.sync;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULL_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${peerBaseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        'X-Sync-Key-Id': peerKeyId,
        'X-Sync-Credential': peerCredential,
        'X-Sync-Site': siteId,
      },
      signal: controller.signal,
    });
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      body = null;
    }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: err && err.name === 'AbortError' ? 'TIMEOUT' : String((err && err.message) || err),
    };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Read the peer's outbox and apply it here, then ack the contiguous prefix.
 * A rejected event is acked so one bad row cannot block every later change.
 * A store error stops the page there and is not acked, so the next tick retries it.
 * @param {{ fetchImpl?: Function }} [opts]
 */
export const runPullTick = async (opts = {}) => {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!config.sync.peerBaseUrl) return { skipped: 'NO_PEER_URL' };
  if (!config.sync.siteId) return { skipped: 'NO_SITE_ID' };
  if (!config.sync.peerKeyId || !config.sync.peerCredential) return { skipped: 'NO_PEER_CREDENTIAL' };

  const stats = { pulled: 0, stored: 0, duplicate: 0, rejected: 0, acked: 0, pages: 0 };
  for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const got = await peerRequest(fetchImpl, `/events?limit=${PULL_PAGE_SIZE}`, { method: 'GET' });
    if (!got.ok || !got.body || !Array.isArray(got.body.events)) {
      return { ...stats, error: got.error || `HTTP ${got.status}` };
    }
    const events = got.body.events;
    stats.pages += 1;
    if (events.length === 0) break;

    const publisherSiteId = events[0].siteId;
    if (!publisherSiteId || events.some((event) => event.siteId !== publisherSiteId)) {
      return { ...stats, error: 'MIXED_PUBLISHER' };
    }
    if (publisherSiteId === config.sync.siteId) {
      logger.warn('[sync] pull skipped a page published by this site');
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    const results = await ingestEvents(publisherSiteId, events);
    let prefix = 0;
    for (let i = 0; i < results.length; i += 1) {
      const result = results[i];
      if (result.outcome === 'ERROR' || result.httpStatus >= 500) break;
      prefix += 1;
      stats.pulled += 1;
      if (result.outcome === 'STORED') stats.stored += 1;
      else if (result.outcome === 'DUPLICATE') stats.duplicate += 1;
      else if (result.outcome === 'QUARANTINED' || result.outcome === 'REJECTED') {
        stats.rejected += 1;
        logger.warn(`[sync] pull skipped ${events[i].eventId}: ${result.code || result.outcome}`);
      }
    }

    if (prefix > 0) {
      const sequences = events.slice(0, prefix).map((event) => event.originSequence);
      // eslint-disable-next-line no-await-in-loop
      const acked = await peerRequest(fetchImpl, '/events/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publisherSiteId, sequences }),
      });
      if (!acked.ok) return { ...stats, error: acked.error || `ACK HTTP ${acked.status}` };
      stats.acked += sequences.length;
    }
    if (prefix < events.length || events.length < PULL_PAGE_SIZE) break;
  }
  return stats;
};
