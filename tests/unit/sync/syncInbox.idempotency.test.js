import { jest } from '@jest/globals';

const create = jest.fn();
const findOne = jest.fn();

jest.unstable_mockModule('../../../src/models/sync/syncInbox.model.js', () => ({
  default: { create, findOne },
}));

const { ingestEvent } = await import('../../../src/services/sync/syncInbox.service.js');
const { hashEvent } = await import('../../../src/services/sync/syncHash.js');

const event = {
  eventId: '018f3b2e-7c11-7a3e-9c2a-1b0e6d5a4c30',
  siteId: 'factory-a',
  originSequence: 1,
  entityType: 'vendorProductionFlow',
  eventType: 'vendorFloorTransfer',
  aggregateId: '664f0c2a9b1e4c0012ab34cd',
  aggregateVersion: 1,
  schemaVersion: 1,
  origin: 'user',
  occurredAt: new Date('2026-11-12T06:30:00.000Z'),
  payload: { quantity: 10 },
};

describe('sync inbox idempotency', () => {
  beforeEach(() => {
    create.mockReset();
    findOne.mockReset();
  });

  it('returns duplicate true when the same eventId and hash already exist', async () => {
    const payloadHash = hashEvent(event);
    create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    findOne.mockReturnValue({
      lean: async () => ({ _id: 'existing', status: 'PENDING', delivery: 'DURABLY_STORED', payloadHash }),
    });
    const result = await ingestEvent('factory-a', { ...event, payloadHash });
    expect(result.duplicate).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.domainInvoked).toBe(false);
  });

  it('returns 409 when the same eventId arrives with a different hash', async () => {
    create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    findOne.mockReturnValue({
      lean: async () => ({ _id: 'existing', status: 'PENDING', payloadHash: 'a'.repeat(64) }),
    });
    const result = await ingestEvent('factory-a', { ...event, payloadHash: hashEvent(event) });
    expect(result.httpStatus).toBe(409);
    expect(result.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
  });
});
