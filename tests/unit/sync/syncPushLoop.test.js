import { jest } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

/**
 * Push → inbox → ack loop with in-memory model fakes. No Mongo, no setupTestDB, no mongoose.connect.
 * The real runPushTick POSTs through `fetchImpl`; the fake peer feeds the parsed body to the real ingestEvents.
 */

const SITE = 'factory-a';

// ---------- config / logger (avoid dotenv + Joi + the dev .env) ----------
const syncCfg = {
  enabled: true,
  shadowVendorTransfer: true,
  workerEnabled: false,
  applyMode: 'shadow',
  siteId: SITE,
  peerBaseUrl: 'http://peer.test/v1/sync',
  peerKeyId: 'key-1',
  peerCredential: 'cred-1',
  workerIntervalMs: 60000,
};
jest.unstable_mockModule('../../../src/config/config.js', () => ({ default: { sync: syncCfg } }));
jest.unstable_mockModule('../../../src/config/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ---------- tiny in-memory query helpers ----------
const getPath = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const cmp = (a, b) => (a instanceof Date || b instanceof Date ? new Date(a).getTime() - new Date(b).getTime() : a < b ? -1 : a > b ? 1 : 0);
const matchValue = (actual, cond) => {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && Object.keys(cond).some((k) => k.startsWith('$'))) {
    return Object.entries(cond).every(([op, v]) => {
      if (op === '$in') return v.includes(actual);
      if (op === '$lt') return actual != null && cmp(actual, v) < 0;
      if (op === '$lte') return actual != null && cmp(actual, v) <= 0;
      if (op === '$gt') return actual != null && cmp(actual, v) > 0;
      throw new Error(`unsupported operator ${op}`);
    });
  }
  if (cond instanceof Date) return actual instanceof Date && actual.getTime() === cond.getTime();
  return actual === cond;
};
const matches = (doc, filter) => Object.entries(filter).every(([k, c]) => matchValue(getPath(doc, k), c));
const applyUpdate = (doc, update) => {
  Object.entries(update.$set || {}).forEach(([k, v]) => {
    doc[k] = v;
  });
  Object.entries(update.$inc || {}).forEach(([k, v]) => {
    doc[k] = (doc[k] || 0) + v;
  });
};
const clone = (d) => (d ? { ...d, payload: d.payload ? JSON.parse(JSON.stringify(d.payload)) : d.payload } : d);
const query = (rowsFn) => {
  let sortSpec = null;
  let lim = Infinity;
  const q = {
    sort(s) {
      sortSpec = s;
      return q;
    },
    limit(n) {
      lim = n;
      return q;
    },
    select() {
      return q;
    },
    session() {
      return q;
    },
    async lean() {
      let rows = rowsFn();
      if (sortSpec) {
        const keys = Object.entries(sortSpec);
        rows = [...rows].sort((a, b) => {
          for (const [k, dir] of keys) {
            const c = cmp(getPath(a, k), getPath(b, k));
            if (c) return c * dir;
          }
          return 0;
        });
      }
      return rows.slice(0, lim).map(clone);
    },
  };
  return q;
};

// ---------- SyncOutbox fake ----------
const outbox = [];
let outboxSeq = 0;
const SyncOutbox = {
  create: jest.fn(async (doc) => {
    const row = {
      _id: `ob${(outboxSeq += 1)}`,
      status: 'PENDING',
      attempts: 0,
      availableAt: new Date(0),
      lockedUntil: null,
      lockedBy: null,
      createdAt: new Date(),
      ...doc,
    };
    outbox.push(row);
    return clone(row);
  }),
  find: jest.fn((filter) => query(() => outbox.filter((r) => matches(r, filter)))),
  findOneAndUpdate: jest.fn((filter, update) => ({
    async lean() {
      const row = outbox.find((r) => matches(r, filter));
      if (!row) return null;
      applyUpdate(row, update);
      return clone(row);
    },
  })),
  updateOne: jest.fn(async (filter, update) => {
    const row = outbox.find((r) => matches(r, filter));
    if (row) applyUpdate(row, update);
    return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
  }),
  updateMany: jest.fn(async (filter, update) => {
    const rows = outbox.filter((r) => matches(r, filter));
    rows.forEach((r) => applyUpdate(r, update));
    return { matchedCount: rows.length, modifiedCount: rows.length };
  }),
};
jest.unstable_mockModule('../../../src/models/sync/syncOutbox.model.js', () => ({ default: SyncOutbox }));

// ---------- SyncJob fake ----------
const jobs = [];
const SyncJob = {
  create: jest.fn(async (doc) => {
    const row = { _id: `job${jobs.length + 1}`, status: 'RUNNING', ...doc };
    jobs.push(row);
    return row;
  }),
  updateOne: jest.fn(async (filter, update) => {
    const row = jobs.find((j) => j._id === filter._id);
    if (row) applyUpdate(row, update);
    return {};
  }),
};
jest.unstable_mockModule('../../../src/models/sync/syncJob.model.js', () => ({ default: SyncJob }));

// ---------- SyncInbox fake (unique on sourceSiteId + eventId, like the real index) ----------
const inbox = [];
const SyncInbox = {
  create: jest.fn(async (doc) => {
    if (inbox.some((r) => r.sourceSiteId === doc.sourceSiteId && r.eventId === doc.eventId)) {
      throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    }
    const row = { _id: `ib${inbox.length + 1}`, ...doc };
    inbox.push(row);
    return clone(row);
  }),
  findOne: jest.fn((filter) => ({
    async lean() {
      return clone(inbox.find((r) => matches(r, filter)) || null);
    },
  })),
};
jest.unstable_mockModule('../../../src/models/sync/syncInbox.model.js', () => ({ default: SyncInbox }));

// ---------- counters for the real shadow capture ----------
const counters = new Map();
jest.unstable_mockModule('../../../src/services/sync/syncCounter.service.js', () => ({
  aggregateVersionKey: (t, id) => `agg:${t}:${id}`,
  siteSequenceKey: (s) => `seq:${s}`,
  nextCounterValue: async (key) => {
    const n = (counters.get(key) || 0) + 1;
    counters.set(key, n);
    return n;
  },
}));

const { runPushTick } = await import('../../../src/services/sync/syncWorker.js');
const { ingestEvents } = await import('../../../src/services/sync/syncInbox.service.js');
const { captureVendorTransferShadow, VENDOR_FLOW_ENTITY_TYPE, VENDOR_TRANSFER_EVENT_TYPE } = await import(
  '../../../src/services/sync/syncShadowCapture.js'
);
const { computeEventHash } = await import('../../../src/services/sync/syncHash.js');

// ---------- fake peer: the POST body goes straight into the real ingestEvents ----------
const posts = [];
const ingestResults = [];
const peerFetch = jest.fn(async (url, init) => {
  const body = JSON.parse(init.body);
  posts.push({ url, init, body });
  const results = await ingestEvents(init.headers['X-Sync-Site'], body.events);
  ingestResults.push(results);
  return { status: 200, json: async () => ({ results }) };
});

/** Peer that answers with a fixed per-event result instead of ingesting. */
const cannedPeer = (make) =>
  jest.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    return { status: 200, json: async () => ({ results: body.events.map(make) }) };
  });

const delta = { flowId: '664f0c2a9b1e4c0012ab34cd', fromFloorKey: 'finalChecking', toFloorKey: 'dispatch', quantity: 10 };

const reset = () => {
  outbox.length = 0;
  jobs.length = 0;
  inbox.length = 0;
  posts.length = 0;
  ingestResults.length = 0;
  counters.clear();
  outboxSeq = 0;
  [SyncOutbox, SyncJob, SyncInbox].forEach((m) => Object.values(m).forEach((fn) => fn.mockClear()));
  peerFetch.mockClear();
};

const T0 = new Date('2026-11-12T06:30:00.000Z');
const later = (ms) => new Date(T0.getTime() + ms);

describe('sync push loop: outbox → POST → inbox → ack (mocks only)', () => {
  beforeEach(reset);

  it('claims and POSTs a pending vendor-transfer row, stores it once, and acks it', async () => {
    const created = await captureVendorTransferShadow(delta);
    expect(created.entityType).toBe(VENDOR_FLOW_ENTITY_TYPE);
    expect(created.eventType).toBe(VENDOR_TRANSFER_EVENT_TYPE);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].status).toBe('PENDING');

    const stats = await runPushTick({ fetchImpl: peerFetch, workerId: 'w1', now: T0 });

    // 1. claimed and POSTed
    expect(stats).toEqual({ claimed: 1, acked: 1, retry: 0, quarantined: 0 });
    expect(peerFetch).toHaveBeenCalledTimes(1);
    expect(posts[0].url).toBe('http://peer.test/v1/sync/events');
    expect(posts[0].init.method).toBe('POST');
    expect(posts[0].init.headers['X-Sync-Site']).toBe(SITE);
    expect(posts[0].body.events).toHaveLength(1);
    const wire = posts[0].body.events[0];
    expect(wire.eventId).toBe(created.eventId);
    expect(wire.payloadHash).toBe(created.payloadHash);
    expect(wire.payloadHash).toBe(computeEventHash(wire));
    expect(wire.payload).toEqual({ ...delta, containerBarcode: null });

    // 2. stored once, no domain call
    const [first] = ingestResults[0];
    expect(first.outcome).toBe('STORED');
    expect(first.duplicate).toBe(false);
    expect(first.domainInvoked).toBe(false);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      sourceSiteId: SITE,
      eventId: created.eventId,
      payloadHash: created.payloadHash,
      status: 'PENDING',
      delivery: 'DURABLY_STORED',
    });

    // 4. acked after STORED
    expect(outbox[0].status).toBe('ACKED');
    expect(outbox[0].ackedAt).toEqual(T0);
    expect(outbox[0].lockedBy).toBeNull();
    expect(jobs[0].status).toBe('SUCCEEDED');

    // Nothing left to push.
    const again = await runPushTick({ fetchImpl: peerFetch, workerId: 'w1', now: later(1000) });
    expect(again).toEqual({ claimed: 0, acked: 0, retry: 0, quarantined: 0 });
    expect(peerFetch).toHaveBeenCalledTimes(1);
  });

  it('re-push of the same event (ack lost) is DUPLICATE, makes no second inbox row, and acks', async () => {
    const created = await captureVendorTransferShadow(delta);
    await runPushTick({ fetchImpl: peerFetch, workerId: 'w1', now: T0 });
    expect(inbox).toHaveLength(1);

    // Simulate the publisher never seeing the ack: row goes back to PENDING with the same eventId and hash.
    Object.assign(outbox[0], { status: 'PENDING', ackedAt: null, expireAt: undefined });

    const stats = await runPushTick({ fetchImpl: peerFetch, workerId: 'w2', now: later(1000) });

    // 3. duplicate, no second effect
    const [second] = ingestResults[1];
    expect(second.eventId).toBe(created.eventId);
    expect(second.outcome).toBe('DUPLICATE');
    expect(second.duplicate).toBe(true);
    expect(second.httpStatus).toBe(200);
    expect(second.domainInvoked).toBe(false);
    expect(second.id).toBe(ingestResults[0][0].id);
    expect(inbox).toHaveLength(1);
    expect(SyncInbox.create).toHaveBeenCalledTimes(2); // second insert hit the unique key and stored nothing

    // 4. acked after DUPLICATE
    expect(stats).toEqual({ claimed: 1, acked: 1, retry: 0, quarantined: 0 });
    expect(outbox[0].status).toBe('ACKED');
  });

  it('direct second ingest of the same wire event is DUPLICATE with no new row', async () => {
    await captureVendorTransferShadow(delta);
    await runPushTick({ fetchImpl: peerFetch, workerId: 'w1', now: T0 });
    const wire = posts[0].body.events[0];

    const [again] = await ingestEvents(SITE, [wire]);
    expect(again).toMatchObject({ outcome: 'DUPLICATE', duplicate: true, domainInvoked: false });
    expect(inbox).toHaveLength(1);
  });

  it('does not ack on a hash-mismatch 409 (quarantines the outbox row instead)', async () => {
    await captureVendorTransferShadow(delta);
    // Peer already holds this eventId with different content.
    inbox.push({ _id: 'ibX', sourceSiteId: SITE, eventId: outbox[0].eventId, payloadHash: 'f'.repeat(64), status: 'PENDING' });

    const stats = await runPushTick({ fetchImpl: peerFetch, workerId: 'w1', now: T0 });

    expect(ingestResults[0][0]).toMatchObject({ outcome: 'REJECTED', httpStatus: 409, code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
    expect(stats).toEqual({ claimed: 1, acked: 0, retry: 0, quarantined: 1 });
    expect(outbox[0].status).toBe('QUARANTINED');
    expect(outbox[0].ackedAt).toBeUndefined();
    expect(inbox).toHaveLength(1);
  });

  it('does not ack on a policy 422 (quarantines the outbox row instead)', async () => {
    await captureVendorTransferShadow(delta);
    // Receiver authenticates the sender as a different site → SITE_MISMATCH.
    const wrongSitePeer = jest.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      const results = await ingestEvents('some-other-site', body.events);
      ingestResults.push(results);
      return { status: 200, json: async () => ({ results }) };
    });

    const stats = await runPushTick({ fetchImpl: wrongSitePeer, workerId: 'w1', now: T0 });

    expect(ingestResults[0][0]).toMatchObject({ outcome: 'REJECTED', httpStatus: 422, code: 'SITE_MISMATCH' });
    expect(stats.acked).toBe(0);
    expect(outbox[0].status).toBe('QUARANTINED');
    expect(inbox).toHaveLength(0);
  });

  it('does not ack when the store fails (ERROR 500): row goes back to PENDING with backoff', async () => {
    await captureVendorTransferShadow(delta);
    SyncInbox.create.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });

    const stats = await runPushTick({ fetchImpl: peerFetch, workerId: 'w1', now: T0 });

    expect(ingestResults[0][0]).toMatchObject({ outcome: 'ERROR', httpStatus: 500 });
    expect(stats).toEqual({ claimed: 1, acked: 0, retry: 1, quarantined: 0 });
    expect(outbox[0].status).toBe('PENDING');
    expect(outbox[0].availableAt.getTime()).toBeGreaterThan(T0.getTime());
    expect(inbox).toHaveLength(0);
  });

  it('does not ack when the peer is unreachable or returns no result for the event', async () => {
    await captureVendorTransferShadow(delta);
    const down = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const s1 = await runPushTick({ fetchImpl: down, workerId: 'w1', now: T0 });
    expect(s1).toEqual({ claimed: 1, acked: 0, retry: 1, quarantined: 0 });
    expect(outbox[0].status).toBe('PENDING');
    expect(jobs[0].status).toBe('FAILED');

    const empty = cannedPeer(() => ({ eventId: 'not-this-one', outcome: 'STORED' }));
    const s2 = await runPushTick({ fetchImpl: empty, workerId: 'w1', now: later(10 * 60 * 1000) });
    expect(s2).toEqual({ claimed: 1, acked: 0, retry: 1, quarantined: 0 });
    expect(outbox[0].status).toBe('PENDING');
  });
});

describe('ingest path stays off domain services', () => {
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src');
  const forbidden = /(vendorManagement|yarnManagement|services\/production|whms|order\.service|warehouse)/i;

  /** Follow relative imports from an entry file and return every reachable src file. */
  const reachable = (entryRel, stopAt = []) => {
    const seen = new Set();
    const stops = new Set(stopAt.map((rel) => path.join(srcRoot, rel)));
    const stack = [path.join(srcRoot, entryRel)];
    while (stack.length) {
      const file = stack.pop();
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      if (stops.has(file)) continue;
      const source = readFileSync(file, 'utf8');
      const re = /(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
      let m;
      while ((m = re.exec(source))) stack.push(path.resolve(path.dirname(file), m[1] || m[2]));
    }
    return [...seen].map((f) => path.relative(srcRoot, f));
  };

  it('runPushTick never reaches a vendor, yarn, order, or warehouse module', () => {
    const files = reachable('services/sync/syncWorker.js');
    expect(files).toContain('services/sync/syncWorker.js');
    files.forEach((rel) => expect(rel).not.toMatch(forbidden));
  });

  it('ingestEvents reaches a domain module only through the SYNC_APPLY_PILOT apply service', () => {
    const files = reachable('services/sync/syncInbox.service.js', ['services/sync/syncPilotApply.service.js']);
    expect(files).toEqual(
      expect.arrayContaining(['services/sync/syncInbox.service.js', 'services/sync/syncPilotApply.service.js'])
    );
    files.forEach((rel) => expect(rel).not.toMatch(forbidden));
  });

  it('every ingest result reports domainInvoked false', async () => {
    reset();
    await captureVendorTransferShadow(delta);
    await runPushTick({ fetchImpl: peerFetch, workerId: 'w1', now: T0 });
    Object.assign(outbox[0], { status: 'PENDING' });
    await runPushTick({ fetchImpl: peerFetch, workerId: 'w1', now: later(1000) });
    const all = ingestResults.flat();
    expect(all).toHaveLength(2);
    all.forEach((r) => expect(r.domainInvoked).toBe(false));
  });
});
