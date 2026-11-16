import { jest } from '@jest/globals';

/**
 * Peer outbox → GET → local ingest → ack. ingestEvents is mocked; no Mongo.
 * The factory uses this path because the cloud cannot open a connection to the factory.
 */

const syncCfg = {
  enabled: true,
  workerEnabled: true,
  siteId: 'factory-mac',
  peerBaseUrl: 'http://peer.test/v1/sync',
  peerKeyId: 'key-1',
  peerCredential: 'cred-1',
  workerIntervalMs: 60000,
};

jest.unstable_mockModule('../../../src/config/config.js', () => ({ default: { sync: syncCfg } }));
jest.unstable_mockModule('../../../src/config/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.unstable_mockModule('../../../src/models/sync/syncOutbox.model.js', () => ({ default: {} }));
jest.unstable_mockModule('../../../src/models/sync/syncJob.model.js', () => ({ default: {} }));
jest.unstable_mockModule('../../../src/services/sync/syncCursor.service.js', () => ({
  toWireEvent: (row) => row,
}));

const ingestEvents = jest.fn();
jest.unstable_mockModule('../../../src/services/sync/syncInbox.service.js', () => ({ ingestEvents }));

const { runPullTick } = await import('../../../src/services/sync/syncPull.js');

const cloudEvent = (originSequence) => ({
  eventId: `evt-${originSequence}`,
  siteId: 'cloud',
  originSequence,
  entityType: 'Product',
  aggregateId: 'p1',
  aggregateVersion: 1,
  eventType: 'documentUpserted',
  schemaVersion: 1,
  origin: 'user',
  occurredAt: '2026-11-13T12:00:00.000Z',
  payload: { _id: 'p1' },
  payloadHash: 'a'.repeat(64),
});

const calls = [];
const ok = (body) => ({ status: 200, json: async () => body });

const fetchImpl = jest.fn(async (url, init) => {
  calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, site: init.headers['X-Sync-Site'] });
  if (String(url).endsWith('/events/ack')) return ok({ position: 1 });
  const events = fetchImpl.pages.shift() || [];
  return ok({ siteId: 'cloud', events });
});

beforeEach(() => {
  calls.length = 0;
  fetchImpl.pages = [];
  fetchImpl.mockClear();
  ingestEvents.mockReset();
});

describe('sync pull loop: peer outbox → ingest → ack', () => {
  it('stores a cloud event locally and acks its sequence', async () => {
    fetchImpl.pages = [[cloudEvent(4)]];
    ingestEvents.mockResolvedValue([{ outcome: 'STORED', httpStatus: 201, eventId: 'evt-4' }]);

    const stats = await runPullTick({ fetchImpl });

    expect(stats).toMatchObject({ pulled: 1, stored: 1, acked: 1, pages: 1 });
    expect(ingestEvents).toHaveBeenCalledWith('cloud', [expect.objectContaining({ eventId: 'evt-4' })]);
    const ack = calls.find((c) => c.url.endsWith('/events/ack'));
    expect(ack.site).toBe('factory-mac');
    expect(ack.body).toEqual({ publisherSiteId: 'cloud', sequences: [4] });
  });

  it('acks a rejected event so one bad row does not block later changes', async () => {
    fetchImpl.pages = [[cloudEvent(1), cloudEvent(2)]];
    ingestEvents.mockResolvedValue([
      { outcome: 'REJECTED', httpStatus: 422, code: 'ENTITY_TYPE_NOT_ALLOWED', eventId: 'evt-1' },
      { outcome: 'STORED', httpStatus: 201, eventId: 'evt-2' },
    ]);

    const stats = await runPullTick({ fetchImpl });

    expect(stats).toMatchObject({ pulled: 2, stored: 1, rejected: 1, acked: 2 });
    expect(calls.find((c) => c.url.endsWith('/events/ack')).body.sequences).toEqual([1, 2]);
  });

  it('does not ack a store failure, and does not ack events after it', async () => {
    fetchImpl.pages = [[cloudEvent(1), cloudEvent(2)]];
    ingestEvents.mockResolvedValue([
      { outcome: 'STORED', httpStatus: 201, eventId: 'evt-1' },
      { outcome: 'ERROR', httpStatus: 500, eventId: 'evt-2' },
    ]);

    const stats = await runPullTick({ fetchImpl });

    expect(stats).toMatchObject({ pulled: 1, stored: 1, acked: 1 });
    expect(calls.find((c) => c.url.endsWith('/events/ack')).body.sequences).toEqual([1]);
  });

  it('does nothing when the peer has no new events', async () => {
    fetchImpl.pages = [[]];

    const stats = await runPullTick({ fetchImpl });

    expect(stats).toMatchObject({ pulled: 0, acked: 0, pages: 1 });
    expect(ingestEvents).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.endsWith('/events/ack'))).toBe(false);
  });
});
