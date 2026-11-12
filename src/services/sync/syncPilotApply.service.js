import crypto from 'crypto';
import os from 'os';
import config from '../../config/config.js';
import logger from '../../config/logger.js';
import SyncInbox from '../../models/sync/syncInbox.model.js';
import { INBOX_STATUS, terminalExpireAt } from '../../models/sync/syncConstants.js';
import { YarnPurchaseOrder } from '../../models/index.js';
import { ProductionOrder, Article } from '../../models/production/index.js';
import {
  PILOT_EVENT_TYPES,
  PRODUCTION_ORDER_ENTITY_TYPE,
  YARN_PO_ENTITY_TYPE,
} from './syncPilotCapture.js';
import { ownershipHandlerFor } from './syncOwnershipApply.service.js';
import { applyDocumentRemoved, applyDocumentUpserted } from './syncDocumentApply.js';
import { DOCUMENT_REMOVED_EVENT_TYPE, DOCUMENT_UPSERTED_EVENT_TYPE } from './syncDocumentTypes.js';
import { OWNERSHIP_EVENT_TYPES } from './syncOwnershipTypes.js';
import { VENDOR_TRANSFER_EVENT_TYPE } from './syncShadowCapture.js';

/**
 * Pilot apply (receiver side). Runs only when SYNC_ENABLED and SYNC_APPLY_PILOT are true, after the inbox row
 * is stored. Three event types only; every other event stays store-only with domainInvoked false.
 *
 * - yarnPurchaseOrderCreated / productionOrderCreated: insert-if-absent by the source _id, keeping the source
 *   poNumber / orderNumber. No save hooks run, so no number generator is called. An existing _id is left alone.
 * - productionArticleFloorTransfer is not replayed. transferArticle saves the article, and that save is copied by
 *   documentUpserted. Replaying the transfer would move the quantity a second time.
 * - CONFLICTED rows are never claimed, so a same-field conflict is never applied.
 * - Ownership events (floor receive, yarn cone, warehouse, vendor transfer, masters) route through the handlers in
 *   syncOwnershipApply.service.js. Factory-owned events are applied only when they came from the factory site.
 * - documentUpserted (any captured model, both directions): upsert by source _id via syncDocumentApply.js. Retryable.
 * - documentRemoved: deleteOne by source _id. A second delivery deletes nothing else.
 * - Service-replay events (floor transfer/receive, cone issue/return, warehouse patch, vendor transfer) are marked
 *   applied and not replayed. The registrar already copied the rows those services saved. Replaying them inserts a
 *   second yarn transaction or moves the same quantity again.
 */

/**
 * Event types whose apply used to call the ERP service again. The documents that service writes are captured as
 * documentUpserted / documentRemoved, so replaying the service here would insert a second row.
 */
const COVERED_BY_DOCUMENT_SYNC = new Set([
  PILOT_EVENT_TYPES.ARTICLE_FLOOR_TRANSFER,
  OWNERSHIP_EVENT_TYPES.ARTICLE_FLOOR_RECEIVE,
  OWNERSHIP_EVENT_TYPES.YARN_CONE_FLOOR_ISSUED,
  OWNERSHIP_EVENT_TYPES.YARN_CONE_RETURNED,
  OWNERSHIP_EVENT_TYPES.YARN_CONE_PRODUCTION_ISSUED,
  OWNERSHIP_EVENT_TYPES.WAREHOUSE_INVENTORY_UPDATED,
  VENDOR_TRANSFER_EVENT_TYPE,
]);

/**
 * @param {Record<string, any>} row inbox row
 * @returns {boolean} true for a generic whole-document event
 */
const isDocumentUpsert = (row) => Boolean(row && row.eventType === DOCUMENT_UPSERTED_EVENT_TYPE);

/** @param {Record<string, any>} row */
const isDocumentRemoved = (row) => Boolean(row && row.eventType === DOCUMENT_REMOVED_EVENT_TYPE);

/** @param {Record<string, any>} row */
const isDocumentEvent = (row) => isDocumentUpsert(row) || isDocumentRemoved(row);

const LOCK_MS = 2 * 60 * 1000;
const WORKER_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;

const PILOT_ROUTES = Object.freeze({
  [PILOT_EVENT_TYPES.YARN_PO_CREATED]: YARN_PO_ENTITY_TYPE,
  [PILOT_EVENT_TYPES.PRODUCTION_ORDER_CREATED]: PRODUCTION_ORDER_ENTITY_TYPE,
  [PILOT_EVENT_TYPES.ARTICLE_FLOOR_TRANSFER]: PRODUCTION_ORDER_ENTITY_TYPE,
});

/**
 * Creates are idempotent upserts, so a failed one may be retried. A transfer is not retried after APPLY_FAILED:
 * transferArticle saves the article before the order and log, so a retry after a late throw could move twice.
 * Ownership handlers declare their own `retryable`.
 * @param {Record<string, any>} row inbox row
 * @returns {string[]}
 */
const claimableStatuses = (row) => {
  const handler = ownershipHandlerFor(row);
  const retryable =
    isDocumentEvent(row) || (handler ? handler.retryable : row.eventType !== PILOT_EVENT_TYPES.ARTICLE_FLOOR_TRANSFER);
  return retryable
    ? [INBOX_STATUS.PENDING, INBOX_STATUS.WAITING_DEPENDENCY, INBOX_STATUS.APPLY_FAILED]
    : [INBOX_STATUS.PENDING, INBOX_STATUS.WAITING_DEPENDENCY];
};

export const isApplyPilotReceiverEnabled = () => Boolean(config.sync?.enabled && config.sync?.applyPilot);

/** @param {Record<string, any>} row */
export const isPilotApplyEvent = (row) =>
  Boolean(row && (PILOT_ROUTES[row.eventType] === row.entityType || ownershipHandlerFor(row) || isDocumentEvent(row)));

/**
 * Factory-owned event types: applied only when the row came from the factory site, so a cloud copy is never applied.
 * @param {Record<string, any>} row inbox row
 * @returns {boolean}
 */
const isFactoryOnlyEvent = (row) => {
  if (isDocumentEvent(row)) return false;
  const handler = ownershipHandlerFor(row);
  return handler ? handler.factoryOnly : row.eventType === PILOT_EVENT_TYPES.ARTICLE_FLOOR_TRANSFER;
};

const finish = (rowId, status, extra = {}) => {
  const now = new Date();
  const set = { status, lockedUntil: null, lockedBy: null, ...extra };
  if (status === INBOX_STATUS.APPLIED) set.expireAt = terminalExpireAt(now);
  return SyncInbox.updateOne({ _id: rowId, status: INBOX_STATUS.PROCESSING, lockedBy: WORKER_ID }, { $set: set });
};

/**
 * Insert the source document if its _id is absent. Mongoose casts types (ids, dates) from the JSON payload but
 * no save middleware runs, so the source number is kept and nothing is generated.
 * @param {import('mongoose').Model} Model
 * @param {Record<string, any>} doc
 * @returns {Promise<boolean>} true when a new row was inserted
 */
export const insertIfAbsent = async (Model, doc) => {
  const casted = new Model(doc).toObject({ depopulate: true, virtuals: false, getters: false });
  const { _id, ...rest } = casted;
  if (!_id) throw new Error(`${Model.modelName} snapshot has no _id`);
  const res = await Model.collection.updateOne({ _id }, { $setOnInsert: rest }, { upsert: true });
  const upserted = typeof res.upsertedCount === 'number' ? res.upsertedCount : (res.result && res.result.upserted ? 1 : 0);
  return upserted > 0;
};

const applyYarnPurchaseOrderCreated = async (payload) => {
  const doc = { ...(payload.document || {}), _id: payload._id, poNumber: payload.poNumber };
  const inserted = await insertIfAbsent(YarnPurchaseOrder, doc);
  return { applyOutcome: inserted ? 'INSERTED' : 'ALREADY_EXISTS', domainInvoked: true };
};

const applyProductionOrderCreated = async (payload) => {
  const articles = Array.isArray(payload.articles) ? payload.articles : [];
  // Articles first: an order row on this database means its articles are already here.
  let articlesInserted = 0;
  for (const article of articles) {
    // eslint-disable-next-line no-await-in-loop
    if (await insertIfAbsent(Article, article)) articlesInserted += 1;
  }
  const orderDoc = {
    ...(payload.order || {}),
    _id: payload._id,
    orderNumber: payload.orderNumber,
    articles: articles.map((a) => a._id),
  };
  const inserted = await insertIfAbsent(ProductionOrder, orderDoc);
  return { applyOutcome: inserted ? 'INSERTED' : 'ALREADY_EXISTS', domainInvoked: true, articlesInserted };
};

/**
 * Apply one stored inbox row. Never throws.
 * @param {Record<string, any>} row stored inbox row (needs _id, eventId, entityType, eventType, payload)
 * @param {{ release?: boolean }} [opts] release=false when called from a release loop (no nested release)
 * @returns {Promise<{ domainInvoked: boolean, applyOutcome: string, status?: string, [k: string]: any }>}
 */
export const applyPilotEvent = async (row, { release = true } = {}) => {
  if (!isApplyPilotReceiverEnabled()) return { domainInvoked: false, applyOutcome: 'PILOT_OFF' };
  if (!isPilotApplyEvent(row)) return { domainInvoked: false, applyOutcome: 'STORE_ONLY' };
  if (isFactoryOnlyEvent(row) && row.sourceSiteId !== config.sync.factorySiteId) {
    return { domainInvoked: false, applyOutcome: 'DIRECTION_REFUSED' };
  }
  const handler = ownershipHandlerFor(row);
  const skipReason = handler && handler.skip ? handler.skip(row.payload || {}) : null;
  if (skipReason) return { domainInvoked: false, applyOutcome: skipReason };

  const now = new Date();
  const claimed = await SyncInbox.findOneAndUpdate(
    { _id: row._id, status: { $in: claimableStatuses(row) } },
    {
      $set: { status: INBOX_STATUS.PROCESSING, lockedBy: WORKER_ID, lockedUntil: new Date(now.getTime() + LOCK_MS) },
      $inc: { attempts: 1 },
    },
    { new: true }
  ).lean();

  if (!claimed) {
    const current = await SyncInbox.findById(row._id).select('status').lean();
    const status = current ? current.status : null;
    return {
      domainInvoked: false,
      applyOutcome: status === INBOX_STATUS.APPLIED ? 'ALREADY_APPLIED' : 'NOT_CLAIMABLE',
      status,
    };
  }

  const { payload } = claimed;
  try {
    if (COVERED_BY_DOCUMENT_SYNC.has(claimed.eventType)) {
      await finish(claimed._id, INBOX_STATUS.APPLIED, { lastError: null });
      return { domainInvoked: false, applyOutcome: 'COVERED_BY_DOCUMENT_UPSERT', status: INBOX_STATUS.APPLIED };
    }
    const waitReason = handler && handler.waitFor ? await handler.waitFor(payload) : null;
    if (waitReason) {
      await finish(claimed._id, INBOX_STATUS.WAITING_DEPENDENCY, { lastError: waitReason });
      return { domainInvoked: false, applyOutcome: 'WAITING_DEPENDENCY', status: INBOX_STATUS.WAITING_DEPENDENCY };
    }

    let out;
    if (isDocumentRemoved(claimed)) out = await applyDocumentRemoved(payload, claimed);
    else if (isDocumentUpsert(claimed)) out = await applyDocumentUpserted(payload, claimed);
    else if (handler) out = await handler.apply(payload, claimed);
    else if (claimed.eventType === PILOT_EVENT_TYPES.YARN_PO_CREATED) out = await applyYarnPurchaseOrderCreated(payload);
    else if (claimed.eventType === PILOT_EVENT_TYPES.PRODUCTION_ORDER_CREATED) out = await applyProductionOrderCreated(payload);
    else throw new Error(`NO_APPLY_ROUTE ${claimed.eventType}`);

    await finish(claimed._id, INBOX_STATUS.APPLIED, { lastError: null });

    if (release) {
      // eslint-disable-next-line no-use-before-define
      out.released = await releaseWaitingFor(claimed);
    }
    return { ...out, status: INBOX_STATUS.APPLIED };
  } catch (err) {
    const message = String((err && err.message) || err).slice(0, 500);
    logger.warn(`[sync] pilot apply failed ${claimed.eventType} ${claimed.aggregateId}: ${message}`);
    await finish(claimed._id, INBOX_STATUS.APPLY_FAILED, { lastError: message });
    return { domainInvoked: false, applyOutcome: 'APPLY_FAILED', status: INBOX_STATUS.APPLY_FAILED, error: message };
  }
};

/**
 * After an order lands, apply transfers that were waiting for it, in per-aggregate version order.
 * @param {string} orderId
 * @returns {Promise<Array<{ eventId: string, applyOutcome: string }>>}
 */
export const releaseWaitingTransfers = async (orderId) => {
  const waiting = await SyncInbox.find({
    entityType: PRODUCTION_ORDER_ENTITY_TYPE,
    eventType: PILOT_EVENT_TYPES.ARTICLE_FLOOR_TRANSFER,
    'payload.orderId': orderId,
    status: INBOX_STATUS.WAITING_DEPENDENCY,
  })
    .sort({ sourceSiteId: 1, aggregateVersion: 1 })
    .lean();
  const released = [];
  for (const row of waiting) {
    // eslint-disable-next-line no-await-in-loop
    const r = await applyPilotEvent(row, { release: false });
    released.push({ eventId: row.eventId, applyOutcome: r.applyOutcome });
  }
  return released;
};

const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * After a row is applied, retry rows that were waiting on it: the same aggregate (later versions, e.g. transfers
 * after the order create, an issue after the cone create) and rows whose waiting reason names this aggregate id
 * (e.g. a cone issue waiting for its yarn catalog). Nested applies do not release again, so order is kept.
 * @param {Record<string, any>} applied the applied inbox row
 * @returns {Promise<Array<{ eventId: string, applyOutcome: string }>>}
 */
export const releaseWaitingFor = async (applied) => {
  const waiting = await SyncInbox.find({
    _id: { $ne: applied._id },
    status: INBOX_STATUS.WAITING_DEPENDENCY,
    $or: [
      { entityType: applied.entityType, aggregateId: applied.aggregateId },
      { lastError: { $regex: `^WAITING_FOR_[A-Z_]+ ${escapeRegex(applied.aggregateId)}$` } },
    ],
  })
    .sort({ sourceSiteId: 1, aggregateVersion: 1, receivedAt: 1 })
    .lean();
  const released = [];
  for (const row of waiting) {
    // eslint-disable-next-line no-await-in-loop
    const r = await applyPilotEvent(row, { release: false });
    released.push({ eventId: row.eventId, applyOutcome: r.applyOutcome });
  }
  return released;
};
