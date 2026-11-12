import SyncCounter from '../../models/sync/syncCounter.model.js';

/**
 * Atomically allocates the next value for `key` (1, 2, 3, ...). No session: always outside the floor transaction.
 * @param {string} key
 * @returns {Promise<number>}
 */
export const nextCounterValue = async (key) => {
  // The counter row's _id is the key (see syncCounter.model.js). There is no `key` path.
  const row = await SyncCounter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, lean: true }
  );
  return row.seq;
};

/** @param {string} siteId */
export const siteSequenceKey = (siteId) => `site:${siteId}`;

/**
 * @param {string} entityType
 * @param {string} aggregateId
 */
export const aggregateVersionKey = (entityType, aggregateId) => `agg:${entityType}:${aggregateId}`;
