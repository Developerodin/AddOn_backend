import httpStatus from 'http-status';
import config from '../config/config.js';
import catchAsync from '../utils/catchAsync.js';
import { ingestEvents } from '../services/sync/syncInbox.service.js';
import { listEventsForConsumer, ackSequences } from '../services/sync/syncCursor.service.js';
import { getSyncStatus } from '../services/sync/syncStatus.service.js';
import { recordConflictResolution } from '../services/sync/syncConflict.service.js';

/**
 * /v1/sync handlers. applyMode stays `shadow`; the only business writes come from the SYNC_APPLY_PILOT path in
 * syncInbox.service.js (three event types), reported per event as domainInvoked.
 */
const SHADOW = Object.freeze({ applyMode: 'shadow', domainInvoked: false });

const siteNotConfigured = (res) =>
  res.status(httpStatus.UNPROCESSABLE_ENTITY).send({
    ...SHADOW,
    code: httpStatus.UNPROCESSABLE_ENTITY,
    errorCode: 'SITE_NOT_CONFIGURED',
    message: 'SYNC_SITE_ID is not configured on this server',
  });

/**
 * Single event: HTTP status is that event's status (201 stored, 200 duplicate, 202 quarantined, 409, 422).
 * Batch: 200 when every event is 2xx, otherwise 207 with per-event results.
 */
export const postEvents = catchAsync(async (req, res) => {
  const results = await ingestEvents(req.syncSite.siteId, req.body.events);
  let status;
  if (results.length === 1) {
    status = results[0].httpStatus;
  } else {
    status = results.every((r) => r.httpStatus < 300) ? httpStatus.OK : httpStatus.MULTI_STATUS;
  }
  const body = { ...SHADOW, applyPilot: Boolean(config.sync.applyPilot), domainInvoked: results.some((r) => r.domainInvoked), results };
  if (results.length === 1) {
    body.duplicate = results[0].duplicate;
    if (results[0].code) {
      body.errorCode = results[0].code;
      body.message = results[0].message;
    }
  }
  res.status(status).send(body);
});

export const getEvents = catchAsync(async (req, res) => {
  const publisherSiteId = config.sync.siteId;
  if (!publisherSiteId) return siteNotConfigured(res);
  const page = await listEventsForConsumer({
    consumerSiteId: req.syncSite.siteId,
    publisherSiteId,
    after: req.query.after,
    limit: req.query.limit,
  });
  return res.send({ ...SHADOW, siteId: publisherSiteId, ...page });
});

export const ackEvents = catchAsync(async (req, res) => {
  const publisherSiteId = config.sync.siteId;
  if (!publisherSiteId) return siteNotConfigured(res);
  if (req.body.publisherSiteId !== publisherSiteId) {
    return res.status(httpStatus.UNPROCESSABLE_ENTITY).send({
      ...SHADOW,
      code: httpStatus.UNPROCESSABLE_ENTITY,
      errorCode: 'PUBLISHER_MISMATCH',
      message: 'publisherSiteId does not match this server',
    });
  }
  const result = await ackSequences({
    consumerSiteId: req.syncSite.siteId,
    publisherSiteId,
    sequences: req.body.sequences,
  });
  return res.send({ ...SHADOW, publisherSiteId, ...result });
});

export const getStatus = catchAsync(async (req, res) => {
  const status = await getSyncStatus(req.syncSite.siteId);
  res.send({ ...SHADOW, ...status });
});

export const resolveConflict = catchAsync(async (req, res) => {
  const out = await recordConflictResolution(req.params.id, req.body, req.syncSite.siteId);
  if (out.error) {
    return res.status(out.error.httpStatus).send({
      ...SHADOW,
      code: out.error.httpStatus,
      errorCode: out.error.code,
      message: out.error.message,
    });
  }
  return res.send({ ...SHADOW, intentOnly: true, conflict: out.conflict });
});
