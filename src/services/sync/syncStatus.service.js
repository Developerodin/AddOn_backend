import config from '../../config/config.js';
import SyncOutbox from '../../models/sync/syncOutbox.model.js';
import SyncInbox from '../../models/sync/syncInbox.model.js';
import SyncConflict from '../../models/sync/syncConflict.model.js';
import { CONFLICT_STATUS, INBOX_STATUS } from '../../models/sync/syncConstants.js';
import { getTransportPosition } from './syncCursor.service.js';

const countByStatus = async (Model) => {
  const rows = await Model.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  return rows.reduce((acc, r) => ({ ...acc, [r._id]: r.n }), {});
};

const probeFilter = {
  $or: [{ aggregateId: /^e2e-/ }, { eventType: 'e2eSyncProbe' }],
};

/**
 * Counts the admin can see: events still waiting, and open conflicts.
 * Probe rows are the local end-to-end script. They are not factory work.
 * Does not read site credentials and does not apply anything.
 * @returns {Promise<{ openConflicts: number, rebased: number, inboxPending: number, inboxProbe: number, inboxLive: number, outboxPending: number }>}
 */
export const getReviewQueue = async () => {
  const [outbox, inbox, openConflicts, rebased, inboxProbe] = await Promise.all([
    countByStatus(SyncOutbox),
    countByStatus(SyncInbox),
    SyncConflict.countDocuments({ status: CONFLICT_STATUS.CONFLICTED }),
    SyncConflict.countDocuments({ status: CONFLICT_STATUS.REBASED }),
    SyncInbox.countDocuments({ status: INBOX_STATUS.PENDING, ...probeFilter }),
  ]);
  const inboxPending = inbox.PENDING || 0;
  return {
    openConflicts,
    rebased,
    inboxPending,
    inboxProbe,
    inboxLive: Math.max(0, inboxPending - inboxProbe),
    outboxPending: outbox.PENDING || 0,
  };
};

/** @param {string} consumerSiteId authenticated caller */
export const getSyncStatus = async (consumerSiteId) => {
  const siteId = config.sync.siteId || null;
  const [outbox, inbox, openConflicts, transportPosition] = await Promise.all([
    countByStatus(SyncOutbox),
    countByStatus(SyncInbox),
    SyncConflict.countDocuments({ status: CONFLICT_STATUS.CONFLICTED }),
    siteId ? getTransportPosition(consumerSiteId, siteId) : Promise.resolve(null),
  ]);
  return {
    siteId,
    flags: {
      enabled: config.sync.enabled,
      shadowVendorTransfer: config.sync.shadowVendorTransfer,
      workerEnabled: config.sync.workerEnabled,
    },
    outbox,
    inbox,
    openConflicts,
    transportPosition,
  };
};
