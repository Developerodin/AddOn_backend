import { jest } from '@jest/globals';

const cursorFindOne = jest.fn();
const cursorUpdateOne = jest.fn();
const outboxFind = jest.fn();

jest.unstable_mockModule('../../../src/models/sync/syncCursor.model.js', () => ({
  default: { findOne: cursorFindOne, updateOne: cursorUpdateOne },
}));

jest.unstable_mockModule('../../../src/models/sync/syncOutbox.model.js', () => ({
  default: { find: outboxFind },
}));

const { ackSequences } = await import('../../../src/services/sync/syncCursor.service.js');

/**
 * @param {number | null} position
 */
const cursorAt = (position) => ({
  lean: async () => (position == null ? null : { position }),
});

/**
 * @param {number[]} sequences
 */
const outboxRows = (sequences) => ({
  select: () => ({
    sort: () => ({
      lean: async () => sequences.map((originSequence) => ({ originSequence })),
    }),
  }),
});

describe('sync transport cursor', () => {
  beforeEach(() => {
    cursorFindOne.mockReset();
    cursorUpdateOne.mockReset();
    outboxFind.mockReset();
    cursorUpdateOne.mockResolvedValue({ acknowledged: true });
  });

  it('advances through a contiguous ack and stops at a gap', async () => {
    cursorFindOne.mockReturnValue(cursorAt(0));
    outboxFind.mockReturnValue(outboxRows([1, 2, 3]));

    const result = await ackSequences({
      consumerSiteId: 'cloud',
      publisherSiteId: 'factory-a',
      sequences: [1, 3],
    });

    expect(result.position).toBe(1);
    expect(result.notAdvanced).toEqual([3]);
    expect(cursorUpdateOne).toHaveBeenCalledWith(
      { consumerId: 'transport:cloud:factory-a', aggregateId: null },
      { $max: { position: 1 }, $setOnInsert: { kind: 'transport', publisherSiteId: 'factory-a' } },
      { upsert: true }
    );
  });

  it('does not move the cursor backwards', async () => {
    cursorFindOne.mockReturnValue(cursorAt(5));

    const result = await ackSequences({
      consumerSiteId: 'cloud',
      publisherSiteId: 'factory-a',
      sequences: [1, 2, 3],
    });

    expect(result.position).toBe(5);
    expect(cursorUpdateOne).not.toHaveBeenCalled();
    expect(outboxFind).not.toHaveBeenCalled();
  });
});
