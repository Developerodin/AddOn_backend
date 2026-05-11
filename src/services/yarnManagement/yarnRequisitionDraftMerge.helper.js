import { Supplier } from '../../models/index.js';
import YarnPurchaseOrder from '../../models/yarnReq/yarnPurchaseOrder.model.js';
import { createPurchaseOrder } from './yarnPurchaseOrder.service.js';

const toPositiveNumber = (v) => Math.max(0, Number(v ?? 0));

/**
 * Resolves staged quantity suggestion from catalog min minus available when positive, else 1.
 * @param {{ minQty?: number; availableQty?: number }} requisitionLike
 */
const resolveStagedQty = (requisitionLike) => {
  const minQ = toPositiveNumber(requisitionLike.minQty);
  const avail = toPositiveNumber(requisitionLike.availableQty);
  const shortage = Math.max(0, minQ - avail);
  return shortage > 0 ? shortage : 1;
};

/**
 * Finds the newest draft yarn PO for a supplier (per-supplier staging bucket until submit).
 * @param {string|mongoose.Types.ObjectId} supplierId
 */
export const findLatestDraftPurchaseOrderForSupplier = async (supplierId) => {
  if (!supplierId) return null;
  return YarnPurchaseOrder.findOne({
    supplier: supplierId,
    currentStatus: 'draft',
  })
    .sort({ lastUpdateDate: -1 })
    .exec();
};

/**
 * Appends one requisition as a PO line onto a draft PO, merging quantity if yarn already exists on the PO.
 * @param {mongoose.Document} draftPo Mongoose YarnPurchaseOrder document
 * @param {mongoose.Document} requisitionDoc YarnRequisition document
 * @returns {Promise<{ mergedQty: boolean; lineAppended: boolean }>}
 */
export const mergeRequisitionLineIntoDraftPo = async (draftPo, requisitionDoc) => {
  const yarnCatalogId = requisitionDoc.yarnCatalogId;
  const yarnIdStr = yarnCatalogId?.toString?.() || '';
  const qtyIncrement = resolveStagedQty(requisitionDoc);

  const incomingName = String(requisitionDoc.yarnName || '').trim();

  const items = draftPo.poItems || [];
  const idx = items.findIndex(
    (item) =>
      yarnIdStr &&
      item.yarnCatalogId &&
      item.yarnCatalogId.toString &&
      item.yarnCatalogId.toString() === yarnIdStr
  );

  if (idx >= 0) {
    const row = draftPo.poItems[idx];
    row.quantity = toPositiveNumber(row.quantity) + qtyIncrement;
    if (incomingName && !String(row.yarnName || '').trim()) row.yarnName = incomingName;
  } else {
    draftPo.poItems.push({
      yarnName: incomingName || 'Pending yarn',
      yarnCatalogId,
      sourceRequisitionId: requisitionDoc._id,
      sizeCount: '(pending)',
      shadeCode: undefined,
      rate: 0,
      quantity: qtyIncrement,
      estimatedDeliveryDate: undefined,
      gstRate: 0,
    });
  }

  draftPo.markModified('poItems');
  await draftPo.save();
  return { mergedQty: idx >= 0, lineAppended: idx < 0 };
};

/**
 * Creates a new draft purchase order with one line derived from a yarn requisition (no existing draft for that supplier).
 * Rare race: two simultaneous first-line staging calls for the same vendor may create two drafts; downstream merges use the newest draft.
 * @param {mongoose.Document} requisitionDoc YarnRequisition with preferredSupplierId and yarn line fields set
 * @returns {Promise<mongoose.Document>} Persisted YarnPurchaseOrder with currentStatus draft
 */
export const createDraftPurchaseOrderForRequisition = async (requisitionDoc) => {
  const supplierId = requisitionDoc.preferredSupplierId;
  if (!supplierId) {
    throw new Error('createDraftPurchaseOrderForRequisition requires preferredSupplierId');
  }

  let supplierName = String(requisitionDoc.preferredSupplierName || '').trim();
  if (!supplierName) {
    const sup = await Supplier.findById(supplierId).select('brandName').lean();
    supplierName = sup?.brandName ? String(sup.brandName).trim() : 'Draft';
  }

  const incomingName = String(requisitionDoc.yarnName || '').trim();
  const qtyIncrement = resolveStagedQty(requisitionDoc);

  const created = await createPurchaseOrder({
    supplierName,
    supplier: supplierId,
    poItems: [
      {
        yarnName: incomingName || 'Pending yarn',
        yarnCatalogId: requisitionDoc.yarnCatalogId,
        sourceRequisitionId: requisitionDoc._id,
        sizeCount: '(pending)',
        shadeCode: undefined,
        rate: 0,
        quantity: qtyIncrement,
        estimatedDeliveryDate: undefined,
        gstRate: 0,
      },
    ],
    subTotal: 0,
    gst: 0,
    total: 0,
    currentStatus: 'draft',
    creditDays: 0,
  });

  return created;
};
