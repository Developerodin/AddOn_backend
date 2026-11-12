import { Category, YarnCatalog } from '../../models/index.js';
import Product from '../../models/product.model.js';
import StyleCode from '../../models/styleCode.model.js';
import YarnCone from '../../models/yarnReq/yarnCone.model.js';
import YarnTransaction from '../../models/yarnReq/yarnTransaction.model.js';
import YarnFloorIssueBatch from '../../models/yarnReq/yarnFloorIssueBatch.model.js';
import WarehouseInventory from '../../models/whms/warehouseInventory.model.js';
import VendorProductionFlow from '../../models/vendorManagement/vendorProductionFlow.model.js';
import { ProductionOrder, Article } from '../../models/production/index.js';
import { updateArticleFloorReceivedData } from '../production/article.service.js';
import { issueConeForFloor } from '../yarnManagement/yarnConeFloorIssue.service.js';
import { returnYarnCone, updateYarnConeById } from '../yarnManagement/yarnCone.service.js';
import { updateWarehouseInventoryById } from '../whms/warehouseInventory.service.js';
import { transferVendorProductionFlowQuantity } from '../vendorManagement/vendorProductionFlow.service.js';
import { PRODUCTION_ORDER_ENTITY_TYPE, runAsSyncApply } from './syncPilotCapture.js';
import { VENDOR_FLOW_ENTITY_TYPE, VENDOR_TRANSFER_EVENT_TYPE } from './syncShadowCapture.js';
import { OWNERSHIP_ENTITY_TYPES as E, OWNERSHIP_EVENT_TYPES as T } from './syncOwnershipTypes.js';

/**
 * Ownership apply handlers (receiver side). syncPilotApply.service.js claims the inbox row, checks direction and
 * dependencies through these handlers, then calls `apply`. Every business call runs inside runAsSyncApply, so the
 * receiver never captures it again.
 *
 * Handler fields:
 *   entityType   the inbox entityType this event type must carry
 *   factoryOnly  true = applied only when the row came from the factory site
 *   retryable    true = an APPLY_FAILED row may be claimed again (idempotent writes only)
 *   skip(p)      optional; returns a reason to leave the row store-only (not claimed)
 *   waitFor(p)   optional; returns a reason string when a prerequisite is missing (row → WAITING_DEPENDENCY)
 *   apply(p,row) performs the write; returns { applyOutcome, domainInvoked, ... }
 */

/**
 * Insert-if-absent by _id with no save middleware (no number/name generator runs). Kept local to avoid a cycle
 * with syncPilotApply.service.js, which exports the same helper.
 * @param {import('mongoose').Model} Model
 * @param {Record<string, any>} doc
 * @returns {Promise<boolean>} true when a new row was inserted
 */
const insertIfAbsent = async (Model, doc) => {
  const casted = new Model(doc).toObject({ depopulate: true, virtuals: false, getters: false });
  const { _id, ...rest } = casted;
  if (!_id) throw new Error(`${Model.modelName} snapshot has no _id`);
  const res = await Model.collection.updateOne({ _id }, { $setOnInsert: rest }, { upsert: true });
  const upserted = typeof res.upsertedCount === 'number' ? res.upsertedCount : res.result && res.result.upserted ? 1 : 0;
  return upserted > 0;
};

/**
 * @param {import('mongoose').Model} Model
 * @param {Record<string, any>} doc
 * @returns {Promise<{ applyOutcome: string, domainInvoked: boolean }>}
 */
const insertOutcome = async (Model, doc) => {
  const inserted = await insertIfAbsent(Model, doc);
  return { applyOutcome: inserted ? 'INSERTED' : 'ALREADY_EXISTS', domainInvoked: true };
};

/**
 * Container accept on the receiver: same service, same container id, so a redelivery credits nothing twice
 * (updateArticleFloorReceivedData skips quantity already booked for that container).
 * @param {Record<string, any>} p payload
 * @returns {Promise<{ applyOutcome: string, domainInvoked: boolean, received: number|null }>}
 */
const applyFloorReceive = async (p) => {
  const article = await runAsSyncApply(() =>
    updateArticleFloorReceivedData(String(p.articleId), {
      floor: p.floor,
      quantity: Number(p.quantity),
      receivedData: {
        receivedStatusFromPreviousFloor: p.receivedData ? p.receivedData.receivedStatusFromPreviousFloor : '',
        receivedInContainerId: p.receivedData ? p.receivedData.receivedInContainerId : null,
        receivedTimestamp: p.receivedData ? p.receivedData.receivedTimestamp : null,
      },
      ...(Array.isArray(p.receivedTransferItems) && p.receivedTransferItems.length
        ? { receivedTransferItems: p.receivedTransferItems.map((i) => ({ ...i })) }
        : {}),
    })
  );
  const key = article && typeof article.getFloorKey === 'function' ? article.getFloorKey(p.floor) : null;
  const received = key && article.floorQuantities[key] ? article.floorQuantities[key].received : null;
  return { applyOutcome: 'RECEIVED', domainInvoked: true, received };
};

/**
 * @param {Record<string, any>} p payload of yarnConeCreated
 */
const applyYarnConeCreated = (p) => insertOutcome(YarnCone, { ...(p.document || {}), _id: p._id, barcode: p.barcode });

/**
 * Same cone _id, then the real floor issue (inventory transaction + cone update) with the source batch id.
 * @param {Record<string, any>} p payload of yarnConeFloorIssued
 */
const applyYarnConeFloorIssued = async (p) => {
  if (p.batch && p.batch._id) await insertIfAbsent(YarnFloorIssueBatch, p.batch);
  const cone = await YarnCone.findById(p.coneId).select('barcode').lean();
  await runAsSyncApply(() =>
    issueConeForFloor({
      barcode: cone.barcode,
      floor: p.floor,
      totalWeight: p.totalWeight,
      totalTearWeight: p.totalTearWeight,
      issuedByEmail: p.issuedByEmail,
      issueBatchId: p.issueBatchId,
    })
  );
  return { applyOutcome: 'ISSUED', domainInvoked: true };
};

/**
 * @param {Record<string, any>} p payload of yarnConeReturned
 */
const applyYarnConeReturned = async (p) => {
  const cone = await YarnCone.findById(p.coneId).select('barcode').lean();
  await runAsSyncApply(() => returnYarnCone(cone.barcode, { ...(p.returnData || {}) }));
  return { applyOutcome: 'RETURNED', domainInvoked: true };
};

/**
 * Yarn-issue screen transaction. Insert by the source `_id` so inventory math is not run a second time.
 * @param {Record<string, any>} p payload of yarnTransactionIssued
 * @returns {Promise<{ applyOutcome: string, domainInvoked: boolean }>}
 */
const applyYarnTransactionIssued = (p) => insertOutcome(YarnTransaction, { ...(p.document || {}), _id: p._id });

/**
 * Yarn-issue screen cone PATCH. Same update the screen sends, so returnYarnCone can accept the cone.
 * @param {Record<string, any>} p payload of yarnConeProductionIssued
 * @returns {Promise<{ applyOutcome: string, domainInvoked: boolean }>}
 */
const applyYarnConeProductionIssued = async (p) => {
  await runAsSyncApply(() =>
    updateYarnConeById(String(p.coneId), {
      issueStatus: 'issued',
      ...(p.issueDate ? { issueDate: p.issueDate } : {}),
      ...(p.issueWeight != null ? { issueWeight: p.issueWeight } : {}),
      ...(p.orderId ? { orderId: p.orderId } : {}),
      ...(p.articleId ? { articleId: p.articleId } : {}),
    })
  );
  return { applyOutcome: 'ISSUED', domainInvoked: true };
};

/**
 * @param {Record<string, any>} p payload of warehouseInventoryUpdated
 */
const applyWarehouseInventoryUpdated = async (p) => {
  await runAsSyncApply(() => updateWarehouseInventoryById(String(p._id), { ...(p.body || {}) }, null));
  return { applyOutcome: 'UPDATED', domainInvoked: true };
};

/**
 * The stored vendor transfer, applied once through the existing service (math unchanged).
 * @param {Record<string, any>} p payload of vendorFloorTransfer
 */
const applyVendorTransfer = async (p) => {
  const opts = p.containerBarcode ? { existingContainerBarcode: String(p.containerBarcode) } : {};
  await runAsSyncApply(() =>
    transferVendorProductionFlowQuantity(String(p.flowId), p.fromFloorKey, p.toFloorKey, Number(p.quantity), opts)
  );
  return { applyOutcome: 'TRANSFERRED', domainInvoked: true };
};

/**
 * @param {import('mongoose').Model} Model
 * @param {string} id
 * @param {string} what label used in the waiting reason
 * @returns {Promise<string|null>} reason when the row is missing
 */
const waitUnless = async (Model, id, what) => ((await Model.exists({ _id: id })) ? null : `WAITING_FOR_${what} ${id}`);

/**
 * @param {Record<string, any>} p payload with orderId + articleId
 * @returns {Promise<string|null>}
 */
const waitForOrderAndArticle = async (p) =>
  (await waitUnless(ProductionOrder, p.orderId, 'ORDER')) || waitUnless(Article, p.articleId, 'ARTICLE');

/**
 * The issue reads the cone and its yarn catalog; both must be on this site first.
 * @param {Record<string, any>} p payload of yarnConeFloorIssued
 * @returns {Promise<string|null>}
 */
const waitForConeAndCatalog = async (p) => {
  const cone = await YarnCone.findById(p.coneId).select('yarnCatalogId').lean();
  if (!cone) return `WAITING_FOR_CONE ${p.coneId}`;
  return waitUnless(YarnCatalog, cone.yarnCatalogId, 'YARN_CATALOG');
};

/** Factory-owned ownership handlers plus the vendor transfer. */
export const OWNERSHIP_HANDLERS = Object.freeze({
  [T.ARTICLE_FLOOR_RECEIVE]: {
    entityType: PRODUCTION_ORDER_ENTITY_TYPE,
    factoryOnly: true,
    retryable: false,
    // A Warehouse receive also books WHMS inward rows; warehouse stock is synced by its own events instead.
    skip: (p) => (p.floor === 'Warehouse' ? 'STORE_ONLY_WAREHOUSE_RECEIVE' : null),
    waitFor: waitForOrderAndArticle,
    apply: applyFloorReceive,
  },
  [T.YARN_CONE_CREATED]: { entityType: E.YARN_CONE, factoryOnly: true, retryable: true, apply: applyYarnConeCreated },
  [T.YARN_CONE_FLOOR_ISSUED]: {
    entityType: E.YARN_CONE,
    factoryOnly: true,
    retryable: false,
    waitFor: waitForConeAndCatalog,
    apply: applyYarnConeFloorIssued,
  },
  [T.YARN_TRANSACTION_ISSUED]: {
    entityType: E.YARN_CONE,
    factoryOnly: true,
    retryable: true,
    waitFor: (p) => waitUnless(YarnCone, p.coneId, 'CONE'),
    apply: applyYarnTransactionIssued,
  },
  [T.YARN_CONE_PRODUCTION_ISSUED]: {
    entityType: E.YARN_CONE,
    factoryOnly: true,
    retryable: true,
    waitFor: (p) => waitUnless(YarnCone, p.coneId, 'CONE'),
    apply: applyYarnConeProductionIssued,
  },
  [T.YARN_CONE_RETURNED]: {
    entityType: E.YARN_CONE,
    factoryOnly: true,
    retryable: false,
    waitFor: (p) => waitUnless(YarnCone, p.coneId, 'CONE'),
    apply: applyYarnConeReturned,
  },
  [T.WAREHOUSE_INVENTORY_CREATED]: {
    entityType: E.WAREHOUSE_INVENTORY,
    factoryOnly: true,
    retryable: true,
    apply: (p) => insertOutcome(WarehouseInventory, { ...(p.document || {}), _id: p._id }),
  },
  [T.WAREHOUSE_INVENTORY_UPDATED]: {
    entityType: E.WAREHOUSE_INVENTORY,
    factoryOnly: true,
    // Absolute values (PATCH semantics), so applying the same body again gives the same row.
    retryable: true,
    waitFor: (p) => waitUnless(WarehouseInventory, p._id, 'WAREHOUSE_INVENTORY'),
    apply: applyWarehouseInventoryUpdated,
  },
  [VENDOR_TRANSFER_EVENT_TYPE]: {
    entityType: VENDOR_FLOW_ENTITY_TYPE,
    factoryOnly: true,
    retryable: false,
    waitFor: (p) => waitUnless(VendorProductionFlow, p.flowId, 'VENDOR_FLOW'),
    apply: applyVendorTransfer,
  },
  // Masters: both directions, insert-if-absent by source _id. The source code/name stays as sent.
  [T.CATEGORY_CREATED]: { entityType: E.CATEGORY, factoryOnly: false, retryable: true, apply: (p) => insertOutcome(Category, p) },
  [T.PRODUCT_CREATED]: { entityType: E.PRODUCT, factoryOnly: false, retryable: true, apply: (p) => insertOutcome(Product, p) },
  [T.STYLE_CODE_CREATED]: { entityType: E.STYLE_CODE, factoryOnly: false, retryable: true, apply: (p) => insertOutcome(StyleCode, p) },
  [T.YARN_CATALOG_CREATED]: {
    entityType: E.YARN_CATALOG,
    factoryOnly: false,
    retryable: true,
    apply: (p) => insertOutcome(YarnCatalog, p),
  },
});

/**
 * @param {Record<string, any>} row inbox row
 * @returns {object|null} the handler when eventType and entityType match
 */
export const ownershipHandlerFor = (row) => {
  const h = row ? OWNERSHIP_HANDLERS[row.eventType] : null;
  return h && h.entityType === row.entityType ? h : null;
};
