import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import WarehouseReturn, {
  WarehouseReturnStatus,
  ReturnItemDecision,
  ReturnItemCondition,
} from '../../models/whms/warehouseReturn.model.js';
import WhmsInvoice, { WhmsInvoiceStatus } from '../../models/whms/invoice.model.js';
import WarehouseInventory from '../../models/whms/warehouseInventory.model.js';
import StyleCode from '../../models/styleCode.model.js';
import { appendWarehouseInventoryLog } from './warehouseInventory.service.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const generateReturnNumber = async () => {
  const year = new Date().getFullYear();
  const last = await WarehouseReturn.findOne({ returnNumber: new RegExp(`^WH-RET-${year}-`) })
    .sort({ createdAt: -1 })
    .select('returnNumber');
  const match = String(last?.returnNumber || '').match(/^WH-RET-\d{4}-(\d+)$/);
  const seq = match ? parseInt(match[1], 10) + 1 : 1;
  return `WH-RET-${year}-${String(seq).padStart(5, '0')}`;
};

/** Default supervisor decision implied by an inspected condition. */
const decisionForCondition = (condition) => {
  switch (condition) {
    case ReturnItemCondition.SALEABLE:
      return ReturnItemDecision.RESTOCK;
    case ReturnItemCondition.DAMAGED:
      return ReturnItemDecision.DAMAGED_STOCK;
    case ReturnItemCondition.REPAIR:
      return ReturnItemDecision.REPAIR;
    default:
      return '';
  }
};

/**
 * Open a return (RTO or RTV) against an invoice. Items are seeded from the
 * invoice so scanned quantities can be matched line by line.
 */
export const createReturn = async ({ type, invoiceId, invoiceNumber, reason, remarks = '' }, user) => {
  let invoice = null;
  if (invoiceId) invoice = await WhmsInvoice.findById(invoiceId);
  else if (invoiceNumber) invoice = await WhmsInvoice.findOne({ invoiceNumber: String(invoiceNumber).trim() });
  if (!invoice) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found — returns are matched against an invoice');
  if (invoice.status === WhmsInvoiceStatus.CANCELLED) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot create a return against a cancelled invoice');
  }

  const openExisting = await WarehouseReturn.findOne({
    invoiceId: invoice._id,
    status: { $in: [WarehouseReturnStatus.SCANNING, WarehouseReturnStatus.PENDING_APPROVAL] },
  });
  if (openExisting) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Return ${openExisting.returnNumber} is already open for this invoice`);
  }

  return WarehouseReturn.create({
    returnNumber: await generateReturnNumber(),
    type,
    orderId: invoice.orderId,
    orderNumber: invoice.orderNumber,
    invoiceId: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    clientType: invoice.clientType,
    clientName: invoice.clientName,
    reason,
    remarks: String(remarks || '').trim(),
    status: WarehouseReturnStatus.SCANNING,
    items: (invoice.items || []).map((item) => ({
      styleCode: item.styleCode,
      skuCode: item.skuCode,
      size: item.size || '',
      shade: item.shade || '',
      invoiceQty: Number(item.quantity || 0),
      scannedQty: 0,
      verifiedQty: 0,
    })),
    createdBy: user?._id ?? user?.id ?? null,
    createdByName: user?.name || user?.email || '',
  });
};

const getScanningReturn = async (returnId) => {
  const doc = await WarehouseReturn.findById(returnId);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Return not found');
  if (doc.status !== WarehouseReturnStatus.SCANNING) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Return is ${doc.status}; scanning is closed`);
  }
  return doc;
};

/** Scan a returned product back in (barcode = styleCode, fallback skuCode). */
export const scanReturnItem = async (returnId, { barcode, qty = 1 }) => {
  const doc = await getScanningReturn(returnId);

  const code = String(barcode || '').trim();
  if (!code) throw new ApiError(httpStatus.BAD_REQUEST, 'barcode is required');

  const item = doc.items.find((i) => i.styleCode === code) || doc.items.find((i) => i.skuCode === code);
  if (!item) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Barcode "${code}" is not on invoice ${doc.invoiceNumber}`);
  }

  item.scannedQty = Number(item.scannedQty || 0) + Number(qty || 1);
  await doc.save();
  return doc;
};

/** Supervisor inspection: set verified qty / condition / decision per item. */
export const updateReturnItem = async (returnId, itemId, body, user) => {
  const doc = await WarehouseReturn.findById(returnId);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Return not found');
  if (![WarehouseReturnStatus.SCANNING, WarehouseReturnStatus.PENDING_APPROVAL].includes(doc.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Return is ${doc.status}; items can no longer be edited`);
  }

  const item = doc.items.id(itemId);
  if (!item) throw new ApiError(httpStatus.NOT_FOUND, 'Return item not found');

  if (body.scannedQty !== undefined) item.scannedQty = Number(body.scannedQty);
  if (body.verifiedQty !== undefined) item.verifiedQty = Number(body.verifiedQty);
  if (body.condition !== undefined) {
    item.condition = body.condition;
    if (!body.decision && !item.decision) item.decision = decisionForCondition(body.condition);
  }
  if (body.decision !== undefined) item.decision = body.decision;
  if (body.remarks !== undefined) item.remarks = String(body.remarks || '').trim();

  doc.inspectedBy = user?._id ?? user?.id ?? null;
  doc.inspectedByName = user?.name || user?.email || '';
  await doc.save();
  return doc;
};

/** Difference report: invoice vs scanned vs verified, per line. */
export const buildDifferenceReport = async (returnId) => {
  const doc = await WarehouseReturn.findById(returnId);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Return not found');

  const items = (doc.items || []).map((item) => {
    const invoiceQty = Number(item.invoiceQty || 0);
    const scannedQty = Number(item.scannedQty || 0);
    const verifiedQty = Number(item.verifiedQty || 0);
    return {
      id: String(item._id),
      styleCode: item.styleCode,
      skuCode: item.skuCode,
      size: item.size || '',
      shade: item.shade || '',
      invoiceQty,
      scannedQty,
      verifiedQty,
      scanVsInvoice: scannedQty - invoiceQty,
      condition: item.condition || '',
      decision: item.decision || '',
    };
  });

  return {
    returnId: String(doc._id),
    returnNumber: doc.returnNumber,
    type: doc.type,
    status: doc.status,
    invoiceNumber: doc.invoiceNumber,
    orderNumber: doc.orderNumber,
    reason: doc.reason,
    items,
    summary: {
      totalInvoiceQty: items.reduce((s, i) => s + i.invoiceQty, 0),
      totalScannedQty: items.reduce((s, i) => s + i.scannedQty, 0),
      totalVerifiedQty: items.reduce((s, i) => s + i.verifiedQty, 0),
      linesWithDifference: items.filter((i) => i.scanVsInvoice !== 0).length,
    },
  };
};

/** Move scanning → pending-approval. Verified qty defaults to scanned qty when unset. */
export const submitReturnForApproval = async (returnId, user) => {
  const doc = await getScanningReturn(returnId);

  const scannedTotal = (doc.items || []).reduce((s, i) => s + Number(i.scannedQty || 0), 0);
  if (scannedTotal <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Nothing scanned yet — scan returned products first');
  }

  for (const item of doc.items) {
    if (Number(item.verifiedQty || 0) === 0 && Number(item.scannedQty || 0) > 0) {
      item.verifiedQty = Number(item.scannedQty || 0);
    }
  }

  doc.status = WarehouseReturnStatus.PENDING_APPROVAL;
  doc.inspectedBy = doc.inspectedBy || user?._id || user?.id || null;
  doc.inspectedByName = doc.inspectedByName || user?.name || user?.email || '';
  await doc.save();
  return doc;
};

/** Find or lazily create the inventory row for a style code (returns may restock sold-out styles). */
const findOrCreateInventoryRow = async (styleCode) => {
  let inv = await WarehouseInventory.findOne({ styleCode });
  if (inv) return inv;

  const style = await StyleCode.findOne({ styleCode }).select('_id styleCode');
  if (!style) {
    throw new ApiError(httpStatus.BAD_REQUEST, `No style code "${styleCode}" in catalogue — cannot restock`);
  }
  inv = await WarehouseInventory.create({
    styleCodeId: style._id,
    styleCode: style.styleCode,
    totalQuantity: 0,
    blockedQuantity: 0,
    availableQuantity: 0,
  });
  return inv;
};

/**
 * Approve the return (supervisor). Applies per-item decisions:
 *  restock → totalQuantity += verifiedQty       (log: return_restock)
 *  damaged-stock → damagedQuantity += verifiedQty (log: return_damaged)
 *  repair → tracked on the return only            (log: return_repair)
 *  reject → no stock change
 */
export const approveReturn = async (returnId, user) => {
  const doc = await WarehouseReturn.findById(returnId);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Return not found');
  if (doc.status !== WarehouseReturnStatus.PENDING_APPROVAL) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Return must be pending-approval (current: ${doc.status})`);
  }

  const actionable = (doc.items || []).filter((i) => Number(i.verifiedQty || 0) > 0);
  const missingDecision = actionable.filter((i) => !i.decision);
  if (missingDecision.length) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Set a decision for every verified line (missing: ${missingDecision.map((i) => i.styleCode).join(', ')})`
    );
  }

  for (const item of actionable) {
    const qty = Number(item.verifiedQty || 0);
    const userId = user?._id ?? user?.id ?? null;
    const baseMeta = {
      returnId: String(doc._id),
      returnNumber: doc.returnNumber,
      returnType: doc.type,
      invoiceNumber: doc.invoiceNumber,
    };

    if (item.decision === ReturnItemDecision.RESTOCK) {
      const inv = await findOrCreateInventoryRow(item.styleCode);
      const updated = await WarehouseInventory.findOneAndUpdate(
        { _id: inv._id },
        [
          { $set: { totalQuantity: { $add: ['$totalQuantity', qty] } } },
          {
            $set: {
              availableQuantity: {
                $max: [0, { $subtract: ['$totalQuantity', { $ifNull: ['$blockedQuantity', 0] }] }],
              },
            },
          },
        ],
        { new: true }
      );
      await appendWarehouseInventoryLog({
        warehouseInventoryId: updated._id,
        styleCodeId: updated.styleCodeId,
        styleCode: updated.styleCode,
        action: 'return_restock',
        message: `Return ${doc.returnNumber} (${doc.type}) restocked ${qty}`,
        quantityDelta: qty,
        blockedDelta: 0,
        totalQuantityAfter: Number(updated.totalQuantity ?? 0),
        blockedQuantityAfter: Number(updated.blockedQuantity ?? 0),
        availableQuantityAfter: Number(updated.availableQuantity ?? 0),
        userId,
        meta: baseMeta,
      });
    } else if (item.decision === ReturnItemDecision.DAMAGED_STOCK) {
      const inv = await findOrCreateInventoryRow(item.styleCode);
      const updated = await WarehouseInventory.findOneAndUpdate(
        { _id: inv._id },
        { $inc: { damagedQuantity: qty } },
        { new: true }
      );
      await appendWarehouseInventoryLog({
        warehouseInventoryId: updated._id,
        styleCodeId: updated.styleCodeId,
        styleCode: updated.styleCode,
        action: 'return_damaged',
        message: `Return ${doc.returnNumber} (${doc.type}) moved ${qty} to damaged stock`,
        quantityDelta: 0,
        blockedDelta: 0,
        totalQuantityAfter: Number(updated.totalQuantity ?? 0),
        blockedQuantityAfter: Number(updated.blockedQuantity ?? 0),
        availableQuantityAfter: Number(updated.availableQuantity ?? 0),
        userId,
        meta: { ...baseMeta, damagedQty: qty, damagedQuantityAfter: Number(updated.damagedQuantity ?? 0) },
      });
    } else if (item.decision === ReturnItemDecision.REPAIR) {
      const inv = await WarehouseInventory.findOne({ styleCode: item.styleCode });
      if (inv) {
        await appendWarehouseInventoryLog({
          warehouseInventoryId: inv._id,
          styleCodeId: inv.styleCodeId,
          styleCode: inv.styleCode,
          action: 'return_repair',
          message: `Return ${doc.returnNumber} (${doc.type}) sent ${qty} for repair/repacking`,
          quantityDelta: 0,
          blockedDelta: 0,
          totalQuantityAfter: Number(inv.totalQuantity ?? 0),
          blockedQuantityAfter: Number(inv.blockedQuantity ?? 0),
          availableQuantityAfter: Number(inv.availableQuantity ?? 0),
          userId,
          meta: { ...baseMeta, repairQty: qty },
        });
      }
    }
    // reject → no stock effect
  }

  doc.status = WarehouseReturnStatus.APPROVED;
  doc.approvedBy = user?._id ?? user?.id ?? null;
  doc.approvedByName = user?.name || user?.email || '';
  doc.approvedAt = new Date();
  await doc.save();
  return doc;
};

export const rejectReturn = async (returnId, user, { reason = '' } = {}) => {
  const doc = await WarehouseReturn.findById(returnId);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Return not found');
  if (![WarehouseReturnStatus.SCANNING, WarehouseReturnStatus.PENDING_APPROVAL].includes(doc.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Return is already ${doc.status}`);
  }

  doc.status = WarehouseReturnStatus.REJECTED;
  doc.rejectReason = String(reason || '').trim();
  doc.approvedBy = user?._id ?? user?.id ?? null;
  doc.approvedByName = user?.name || user?.email || '';
  await doc.save();
  return doc;
};

export const buildReturnFilter = (query) => {
  const filter = {};
  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;
  if (query.orderId) filter.orderId = query.orderId;
  if (query.invoiceId) filter.invoiceId = query.invoiceId;
  if (query.reason) filter.reason = query.reason;
  if (query.q && String(query.q).trim()) {
    const regex = new RegExp(escapeRegex(String(query.q).trim()), 'i');
    filter.$or = [{ returnNumber: regex }, { invoiceNumber: regex }, { orderNumber: regex }, { clientName: regex }];
  }
  return filter;
};

export const queryReturns = async (filter, options) => {
  return WarehouseReturn.paginate(filter, { sortBy: 'createdAt:desc', ...options });
};

export const getReturnById = async (returnId) => {
  const doc = await WarehouseReturn.findById(returnId);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Return not found');
  return doc;
};
