import logger from '../../config/logger.js';
import YarnFloorIssueBatch from '../../models/yarnReq/yarnFloorIssueBatch.model.js';
import { MAX_PAYLOAD_BYTES } from './syncPolicy.js';
import {
  PRODUCTION_ORDER_ENTITY_TYPE,
  captureArticleFloorTransfer,
  isApplyPilotEnabled,
  isFactorySite,
  toPlainSnapshot,
  writePilotOutboxEvent,
} from './syncPilotCapture.js';
import { OWNERSHIP_ENTITY_TYPES, OWNERSHIP_EVENT_TYPES } from './syncOwnershipTypes.js';

/**
 * Ownership capture (publisher side). Call only after the business write committed, with no session.
 * Every capture here may throw; hooks call them through {@link safeCapture}, so a throw never reaches the response.
 * writePilotOutboxEvent already skips inside runAsSyncApply, so an applied peer event is never captured again.
 */

/**
 * Run one capture in its own try/catch. Logs and swallows the error so the business response is unchanged.
 * @param {string} label short event label for the log line
 * @param {() => Promise<unknown>} fn capture call
 * @returns {Promise<void>}
 */
export const safeCapture = async (label, fn) => {
  try {
    if (isApplyPilotEnabled()) await fn();
  } catch (err) {
    logger.error(`[sync] ${label} capture threw: ${err && err.message}`);
  }
};

/**
 * Document → plain JSON. Populated refs collapse to ids; __v, producedQty and remainingQty are dropped.
 * @param {import('mongoose').Document|Record<string, any>} doc
 * @returns {Record<string, any>}
 */
const snapshotOf = (doc) =>
  toPlainSnapshot(doc && typeof doc.toObject === 'function' ? doc.toObject({ depopulate: true, virtuals: false }) : doc);

/**
 * Refuse a payload the receiver policy would refuse anyway (64 KiB), so the outbox never holds a poison row.
 * @param {string} eventType
 * @param {Record<string, any>} payload
 * @returns {Record<string, any>} the same payload
 */
const assertPayloadSize = (eventType, payload) => {
  const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (size > MAX_PAYLOAD_BYTES) throw new Error(`${eventType} payload is ${size} bytes (limit ${MAX_PAYLOAD_BYTES})`);
  return payload;
};

/**
 * Factory-only event writer: the cloud never publishes factory-owned operations.
 * @param {{ entityType: string, eventType: string, aggregateId: string, payload: Record<string, any> }} input
 * @returns {Promise<import('mongoose').Document|null>}
 */
const writeFactoryEvent = (input) => {
  if (!isFactorySite()) return Promise.resolve(null);
  return writePilotOutboxEvent({ ...input, payload: assertPayloadSize(input.eventType, input.payload) });
};

/**
 * Normalised brand/style breakdown, or null when absent or when it does not add up to the moved quantity.
 * @param {unknown} items
 * @param {number} quantity
 * @returns {Array<{ transferred: number, styleCode: string, brand: string }>|null}
 */
const breakdownFor = (items, quantity) => {
  if (!Array.isArray(items) || items.length === 0) return null;
  const rows = items.map((i) => ({
    transferred: Number(i && i.transferred) || 0,
    styleCode: i && i.styleCode ? String(i.styleCode) : '',
    brand: i && i.brand ? String(i.brand) : '',
  }));
  const sum = rows.reduce((s, r) => s + r.transferred, 0);
  return Math.abs(sum - Number(quantity)) < 1e-9 ? rows : null;
};

/**
 * One committed floor move made by a private floor helper (progress auto-transfer, M1 transfer, ...).
 * Same event type and receiver as transferArticle's own capture.
 * @param {{ orderId: string, articleId: string, fromFloor: string, toFloor: string, quantity: number,
 *   transferItems?: Array<Record<string, any>>|null, styleFloors?: string[] }} move
 * @returns {Promise<import('mongoose').Document|null>}
 */
export const captureFloorMove = async (move) => {
  const quantity = Number(move.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const styleFloors = move.styleFloors || [];
  const items = styleFloors.includes(move.fromFloor) ? breakdownFor(move.transferItems, quantity) : null;
  return captureArticleFloorTransfer({
    orderId: String(move.orderId),
    articleId: String(move.articleId),
    fromFloor: String(move.fromFloor),
    toFloor: String(move.toFloor),
    quantity,
    transferItems: items,
  });
};

/**
 * Container accept on a floor (received went up by `quantity`).
 * @param {{ orderId: string, articleId: string, floor: string, quantity: number,
 *   receivedData?: Record<string, any>, receivedTransferItems?: Array<Record<string, any>>|null }} receive
 * @returns {Promise<import('mongoose').Document|null>}
 */
export const captureArticleFloorReceive = async (receive) => {
  const quantity = Number(receive.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const rd = receive.receivedData || {};
  const items = breakdownFor(receive.receivedTransferItems, quantity);
  return writeFactoryEvent({
    entityType: PRODUCTION_ORDER_ENTITY_TYPE,
    eventType: OWNERSHIP_EVENT_TYPES.ARTICLE_FLOOR_RECEIVE,
    aggregateId: String(receive.orderId),
    payload: {
      orderId: String(receive.orderId),
      articleId: String(receive.articleId),
      floor: String(receive.floor),
      quantity,
      receivedData: {
        receivedStatusFromPreviousFloor:
          rd.receivedStatusFromPreviousFloor != null ? String(rd.receivedStatusFromPreviousFloor) : '',
        receivedInContainerId: rd.receivedInContainerId ? String(rd.receivedInContainerId) : null,
        receivedTimestamp: rd.receivedTimestamp ? new Date(rd.receivedTimestamp).toISOString() : null,
      },
      ...(items ? { receivedTransferItems: items } : {}),
    },
  });
};

/**
 * @param {import('mongoose').Document|Record<string, any>} cone the saved YarnCone
 * @returns {Promise<import('mongoose').Document|null>}
 */
export const captureYarnConeCreated = async (cone) => {
  if (!cone) return null;
  const document = snapshotOf(cone);
  return writeFactoryEvent({
    entityType: OWNERSHIP_ENTITY_TYPES.YARN_CONE,
    eventType: OWNERSHIP_EVENT_TYPES.YARN_CONE_CREATED,
    aggregateId: String(document._id),
    payload: { _id: document._id, barcode: document.barcode, document },
  });
};

/**
 * Floor issue of one cone. Carries the issue batch so the receiver can create it if absent (the issue checks it).
 * @param {{ coneId: string, barcode: string, floor: string, totalWeight: number, totalTearWeight?: number,
 *   issuedByEmail?: string, issueBatchId: string }} issue
 * @returns {Promise<import('mongoose').Document|null>}
 */
export const captureYarnConeFloorIssued = async (issue) => {
  if (!isFactorySite()) return null;
  const batch = await YarnFloorIssueBatch.findOne({ issueBatchId: String(issue.issueBatchId) }).lean();
  return writeFactoryEvent({
    entityType: OWNERSHIP_ENTITY_TYPES.YARN_CONE,
    eventType: OWNERSHIP_EVENT_TYPES.YARN_CONE_FLOOR_ISSUED,
    aggregateId: String(issue.coneId),
    payload: {
      coneId: String(issue.coneId),
      barcode: String(issue.barcode),
      floor: String(issue.floor),
      totalWeight: Number(issue.totalWeight),
      totalTearWeight: Number(issue.totalTearWeight ?? 0),
      issuedByEmail: issue.issuedByEmail ? String(issue.issuedByEmail) : '',
      issueBatchId: String(issue.issueBatchId),
      batch: batch ? toPlainSnapshot(batch) : null,
    },
  });
};

const RETURN_KEYS = ['returnWeight', 'returnDate', 'returnBy', 'coneStorageId', 'orderId', 'productionOrderId', 'articleId'];

/**
 * @param {{ coneId: string, barcode: string, returnData?: Record<string, any> }} ret
 * @returns {Promise<import('mongoose').Document|null>}
 */
/**
 * The yarn-issue screen's transaction (`yarn_issued`). Stored by source `_id` so a redelivery does not post twice.
 * @param {import('mongoose').Document|Record<string, any>} transaction
 * @param {string} coneId first cone on the transaction; shares the cone aggregate so issue stays ordered
 * @returns {Promise<import('mongoose').Document|null>}
 */
export const captureYarnTransactionIssued = async (transaction, coneId) => {
  if (!transaction || !coneId) return null;
  if (transaction.transactionType !== 'yarn_issued') return null;
  const document = snapshotOf(transaction);
  return writeFactoryEvent({
    entityType: OWNERSHIP_ENTITY_TYPES.YARN_CONE,
    eventType: OWNERSHIP_EVENT_TYPES.YARN_TRANSACTION_ISSUED,
    aggregateId: String(coneId),
    payload: { _id: document._id, coneId: String(coneId), document },
  });
};

/**
 * The yarn-issue screen's cone PATCH (`issueStatus: issued`). Return refuses any other status.
 * @param {import('mongoose').Document|Record<string, any>} cone saved cone
 * @returns {Promise<import('mongoose').Document|null>}
 */
export const captureYarnConeProductionIssued = async (cone) => {
  if (!cone || cone.issueStatus !== 'issued') return null;
  return writeFactoryEvent({
    entityType: OWNERSHIP_ENTITY_TYPES.YARN_CONE,
    eventType: OWNERSHIP_EVENT_TYPES.YARN_CONE_PRODUCTION_ISSUED,
    aggregateId: String(cone._id),
    payload: {
      coneId: String(cone._id),
      issueStatus: 'issued',
      issueDate: cone.issueDate ? new Date(cone.issueDate).toISOString() : null,
      issueWeight: cone.issueWeight != null ? Number(cone.issueWeight) : null,
      orderId: cone.orderId ? String(cone.orderId) : null,
      articleId: cone.articleId ? String(cone.articleId) : null,
    },
  });
};

/**
 * @param {{ coneId: string, barcode: string, returnData?: Record<string, any> }} ret
 * @returns {Promise<import('mongoose').Document|null>}
 */
export const captureYarnConeReturned = async (ret) => {
  const src = ret.returnData || {};
  const returnData = {};
  RETURN_KEYS.forEach((k) => {
    if (src[k] !== undefined && src[k] !== null) returnData[k] = src[k];
  });
  return writeFactoryEvent({
    entityType: OWNERSHIP_ENTITY_TYPES.YARN_CONE,
    eventType: OWNERSHIP_EVENT_TYPES.YARN_CONE_RETURNED,
    aggregateId: String(ret.coneId),
    payload: { coneId: String(ret.coneId), barcode: String(ret.barcode), returnData: toPlainSnapshot(returnData) },
  });
};

/**
 * New warehouse inventory row (not a merge into an existing row).
 * @param {import('mongoose').Document|Record<string, any>} record
 * @returns {Promise<import('mongoose').Document|null>}
 */
export const captureWarehouseInventoryCreated = async (record) => {
  if (!record) return null;
  const document = snapshotOf(record);
  return writeFactoryEvent({
    entityType: OWNERSHIP_ENTITY_TYPES.WAREHOUSE_INVENTORY,
    eventType: OWNERSHIP_EVENT_TYPES.WAREHOUSE_INVENTORY_CREATED,
    aggregateId: String(document._id),
    payload: { _id: document._id, document },
  });
};

/**
 * Update of one warehouse inventory row. `body` is what updateWarehouseInventoryById accepts (absolute values).
 * @param {string} id
 * @param {Record<string, any>} body
 * @returns {Promise<import('mongoose').Document|null>}
 */
export const captureWarehouseInventoryUpdated = async (id, body) =>
  writeFactoryEvent({
    entityType: OWNERSHIP_ENTITY_TYPES.WAREHOUSE_INVENTORY,
    eventType: OWNERSHIP_EVENT_TYPES.WAREHOUSE_INVENTORY_UPDATED,
    aggregateId: String(id),
    payload: { _id: String(id), body: toPlainSnapshot(body || {}) },
  });

/**
 * Master create (both directions). The payload is the flat document so the conflict detector compares fields.
 * @param {string} entityType one of MASTER_ENTITY_TYPES
 * @param {string} eventType matching *Created event type
 * @param {import('mongoose').Document|Record<string, any>} doc the saved master document
 * @returns {Promise<import('mongoose').Document|null>}
 */
export const captureMasterCreated = async (entityType, eventType, doc) => {
  if (!doc) return null;
  const payload = assertPayloadSize(eventType, snapshotOf(doc));
  return writePilotOutboxEvent({ entityType, eventType, aggregateId: String(payload._id), payload });
};
