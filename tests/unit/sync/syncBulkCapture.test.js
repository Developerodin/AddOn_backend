import { idsFromBulkResult, planBulkCapture } from '../../../src/services/sync/syncDocumentCapture.js';

describe('bulkWrite capture plan', () => {
  it('keeps insert and update ids and separates deletes', () => {
    const plan = planBulkCapture([
      { insertOne: { document: { _id: 'a', label: 'A' } } },
      { insertOne: { document: { label: 'no id yet' } } },
      { updateOne: { filter: { _id: 'b' }, update: { $set: { label: 'B' } } } },
      { updateMany: { filter: { zoneCode: 'Z' }, update: { $set: { isActive: true } } } },
      { deleteOne: { filter: { _id: 'c' } } },
      { deleteMany: { filter: { _id: { $in: ['d', 'e'] } } } },
      { deleteMany: { filter: { status: 'stale' } } },
    ]);
    expect(plan.upsertIds).toEqual(['a', 'b']);
    expect(plan.removeIds).toEqual(['c', 'd', 'e']);
    expect(plan.upsertFilters).toEqual([{ zoneCode: 'Z' }]);
    expect(plan.removeFilters).toEqual([{ status: 'stale' }]);
  });

  it('reads inserted and upserted ids from either driver shape', () => {
    expect(idsFromBulkResult({ insertedIds: { 0: 'a' }, upsertedIds: [{ _id: 'b' }] })).toEqual(['a', 'b']);
  });
});
