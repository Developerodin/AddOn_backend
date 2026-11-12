import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import config from '../../config/config.js';
import logger from '../../config/logger.js';
import SyncOutbox from '../../models/sync/syncOutbox.model.js';
import { SyncOrigin, SYNC_SCHEMA_VERSION } from '../../models/sync/syncEnums.js';
import { computeEventHash } from './syncHash.js';
import { aggregateVersionKey, nextCounterValue, siteSequenceKey } from './syncCounter.service.js';

/**
 * Pilot apply capture (publisher side). Three flows only:
 *   yarnPurchaseOrderCreated, productionOrderCreated, productionArticleFloorTransfer.
 *
 * Call only after the business write has committed, with no session. Each function may throw; the caller
 * must catch so a capture failure never changes the HTTP response. Nothing runs at import time.
 *
 * Production order create and article floor transfer share entityType `productionOrder` and the order id as
 * aggregateId, so the push worker delivers them in aggregateVersion order (create before transfer).
 */

export const YARN_PO_ENTITY_TYPE = 'yarnPurchaseOrder';
export const PRODUCTION_ORDER_ENTITY_TYPE = 'productionOrder';

export const PILOT_EVENT_TYPES = Object.freeze({
  YARN_PO_CREATED: 'yarnPurchaseOrderCreated',
  PRODUCTION_ORDER_CREATED: 'productionOrderCreated',
  ARTICLE_FLOOR_TRANSFER: 'productionArticleFloorTransfer',
});

/** Derived quantities are recomputed by each site and never shipped (receiver policy refuses them too). */
const DERIVED_KEYS = new Set(['producedqty', 'remainingqty']);

let warnedMissingSiteId = false;

/**
 * Set while the receiver applies a peer event. A business call made by apply (transferArticle) must not capture
 * a new outbox row, or the change would be sent back to its origin and applied twice.
 */
const applyContext = new AsyncLocalStorage();

/** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
export const runAsSyncApply = (fn) => applyContext.run({ syncApply: true }, fn);

export const isInsideSyncApply = () => Boolean(applyContext.getStore()?.syncApply);

/** SYNC_ENABLED and SYNC_APPLY_PILOT must both be true. Read at call time. */
export const isApplyPilotEnabled = () => Boolean(config.sync?.enabled && config.sync?.applyPilot);

/**
 * JSON-safe deep copy: ObjectIds → hex strings, Dates → ISO strings, `__v` and derived keys dropped.
 * @param {unknown} value
 * @returns {any}
 */
export const toPlainSnapshot = (value) => {
  const json = JSON.parse(JSON.stringify(value === undefined ? null : value));
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const out = {};
      Object.entries(v).forEach(([k, inner]) => {
        if (k === '__v' || DERIVED_KEYS.has(k.toLowerCase())) return;
        out[k] = strip(inner);
      });
      return out;
    }
    return v;
  };
  return strip(json);
};

/**
 * True when this process is the factory site (SYNC_SITE_ID equals SYNC_FACTORY_SITE_ID). Factory-owned events are
 * captured only here, so the cloud never sends them back.
 * @returns {boolean}
 */
export const isFactorySite = () => Boolean(config.sync?.siteId && config.sync.siteId === config.sync.factorySiteId);

/**
 * @param {{ entityType: string, eventType: string, aggregateId: string, payload: Record<string, any> }} input
 * @returns {Promise<import('mongoose').Document|null>}
 */
export const writePilotOutboxEvent = async ({ entityType, eventType, aggregateId, payload }) => {
  if (!isApplyPilotEnabled() || isInsideSyncApply()) return null;
  const { siteId } = config.sync;
  if (!siteId) {
    if (!warnedMissingSiteId) {
      warnedMissingSiteId = true;
      logger.warn('[sync] pilot capture skipped: SYNC_SITE_ID is empty');
    }
    return null;
  }

  const id = String(aggregateId);
  // Version first, then site sequence. If the insert fails, both values are burned (same as the vendor hook).
  const aggregateVersion = await nextCounterValue(aggregateVersionKey(entityType, id));
  const originSequence = await nextCounterValue(siteSequenceKey(siteId));

  const event = {
    eventId: crypto.randomUUID(),
    siteId,
    originSequence,
    entityType,
    eventType,
    aggregateId: id,
    aggregateVersion,
    schemaVersion: SYNC_SCHEMA_VERSION,
    origin: SyncOrigin.USER,
    occurredAt: new Date(),
    payload,
  };
  event.payloadHash = computeEventHash(event);
  return SyncOutbox.create(event);
};

const toObj = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject({ depopulate: true }) : doc);

/**
 * @param {import('mongoose').Document|Record<string, any>} purchaseOrder the saved YarnPurchaseOrder
 */
export const captureYarnPurchaseOrderCreated = async (purchaseOrder) => {
  if (!isApplyPilotEnabled() || !purchaseOrder) return null;
  const document = toPlainSnapshot(toObj(purchaseOrder));
  return writePilotOutboxEvent({
    entityType: YARN_PO_ENTITY_TYPE,
    eventType: PILOT_EVENT_TYPES.YARN_PO_CREATED,
    aggregateId: document._id,
    payload: { _id: document._id, poNumber: document.poNumber, document },
  });
};

/**
 * @param {import('mongoose').Document|Record<string, any>} order the saved ProductionOrder (articles may be populated)
 * @param {Array<Record<string, any>>} articles the saved Article rows for this order (lean or documents)
 */
export const captureProductionOrderCreated = async (order, articles) => {
  if (!isApplyPilotEnabled() || !order) return null;
  const orderDoc = toPlainSnapshot(toObj(order));
  const articleDocs = toPlainSnapshot((articles || []).map(toObj));
  // Order row stores article ids, never populated docs.
  orderDoc.articles = articleDocs.map((a) => a._id);
  return writePilotOutboxEvent({
    entityType: PRODUCTION_ORDER_ENTITY_TYPE,
    eventType: PILOT_EVENT_TYPES.PRODUCTION_ORDER_CREATED,
    aggregateId: orderDoc._id,
    payload: { _id: orderDoc._id, orderNumber: orderDoc.orderNumber, order: orderDoc, articles: articleDocs },
  });
};

/**
 * @param {{ orderId: string, articleId: string, fromFloor: string, toFloor: string, quantity: number,
 *   transferItems?: Array<{ transferred: number, styleCode?: string, brand?: string }> }} delta
 */
export const captureArticleFloorTransfer = async (delta) => {
  if (!isApplyPilotEnabled() || !delta || !isFactorySite()) return null;
  const items = Array.isArray(delta.transferItems)
    ? delta.transferItems.map((i) => ({
        transferred: Number(i.transferred) || 0,
        styleCode: i.styleCode ? String(i.styleCode) : '',
        brand: i.brand ? String(i.brand) : '',
      }))
    : null;
  return writePilotOutboxEvent({
    entityType: PRODUCTION_ORDER_ENTITY_TYPE,
    eventType: PILOT_EVENT_TYPES.ARTICLE_FLOOR_TRANSFER,
    aggregateId: String(delta.orderId),
    payload: {
      orderId: String(delta.orderId),
      articleId: String(delta.articleId),
      fromFloor: String(delta.fromFloor),
      toFloor: String(delta.toFloor),
      quantity: Number(delta.quantity),
      ...(items && items.length ? { transferItems: items } : {}),
    },
  });
};
