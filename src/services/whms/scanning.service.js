import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import ScanSession, { ScanSessionStatus, ScanItemStatus } from '../../models/whms/scanSession.model.js';
import PickList from '../../models/whms/pickList.model.js';
import WarehouseOrder, { WarehouseOrderFlowStatus } from '../../models/whms/warehouseOrder.model.js';
import { transitionOrder } from './orderFlow.service.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const itemStatusFor = (scannedQty, expectedQty) => {
  if (scannedQty <= 0) return ScanItemStatus.PENDING;
  if (scannedQty < expectedQty) return ScanItemStatus.SHORT;
  if (scannedQty === expectedQty) return ScanItemStatus.MATCHED;
  return ScanItemStatus.EXCESS;
};

const sessionSummary = (session) => {
  const items = session.items || [];
  return {
    totalItems: items.length,
    matched: items.filter((i) => i.status === ScanItemStatus.MATCHED).length,
    short: items.filter((i) => i.status === ScanItemStatus.SHORT).length,
    excess: items.filter((i) => i.status === ScanItemStatus.EXCESS).length,
    pending: items.filter((i) => i.status === ScanItemStatus.PENDING).length,
    totalExpected: items.reduce((s, i) => s + Number(i.expectedQty || 0), 0),
    totalScanned: items.reduce((s, i) => s + Number(i.scannedQty || 0), 0),
  };
};

const serializeSession = (session) => ({
  ...(session.toJSON ? session.toJSON() : session),
  summary: sessionSummary(session),
});

/**
 * Open a scan session for an order in the scanning stage. Items are seeded from
 * pick rows with picked quantity > 0 (expected = pickupQuantity).
 */
export const createSession = async (orderId, user) => {
  const order = await WarehouseOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');

  const stage = order.flowStatus;
  if (![WarehouseOrderFlowStatus.SENT_TO_SCANNING, WarehouseOrderFlowStatus.SCANNING_IN_PROGRESS].includes(stage)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Order must be in the scanning stage (current: "${stage}")`);
  }

  const existing = await ScanSession.findOne({ orderId, status: ScanSessionStatus.OPEN });
  if (existing) return serializeSession(existing);

  const pickRows = await PickList.find({ orderId, pickupQuantity: { $gt: 0 } })
    .sort({ styleCode: 1, size: 1 })
    .lean();
  if (!pickRows.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No picked quantities found for this order');
  }

  const session = await ScanSession.create({
    orderId,
    orderNumber: order.orderNumber,
    items: pickRows.map((row) => ({
      pickListId: row._id,
      skuCode: row.skuCode,
      styleCode: row.styleCode,
      size: row.size || '',
      shade: row.shade || '',
      expectedQty: Number(row.pickupQuantity || 0),
      scannedQty: 0,
      status: ScanItemStatus.PENDING,
    })),
    startedBy: user?._id ?? user?.id ?? null,
    startedByName: user?.name || user?.email || '',
  });

  if (stage === WarehouseOrderFlowStatus.SENT_TO_SCANNING) {
    await transitionOrder(orderId, WarehouseOrderFlowStatus.SCANNING_IN_PROGRESS, user, {}, { system: true });
  }

  return serializeSession(session);
};

const getOpenSession = async (sessionId) => {
  const session = await ScanSession.findById(sessionId);
  if (!session) throw new ApiError(httpStatus.NOT_FOUND, 'Scan session not found');
  if (session.status !== ScanSessionStatus.OPEN) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Scan session is ${session.status}`);
  }
  return session;
};

/**
 * Register a barcode scan. The barcode is matched against styleCode (label
 * content) and falls back to skuCode. Returns the updated item + live summary
 * so the UI can highlight short/excess rows immediately.
 */
export const scanBarcode = async (sessionId, { barcode, qty = 1 }) => {
  const session = await getOpenSession(sessionId);

  const code = String(barcode || '').trim();
  if (!code) throw new ApiError(httpStatus.BAD_REQUEST, 'barcode is required');

  const item =
    session.items.find((i) => i.styleCode === code) || session.items.find((i) => i.skuCode === code);
  if (!item) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Barcode "${code}" does not belong to this order`);
  }

  item.scannedQty = Number(item.scannedQty || 0) + Number(qty || 1);
  item.status = itemStatusFor(item.scannedQty, item.expectedQty);
  await session.save();

  return {
    scannedItem: item.toJSON ? item.toJSON() : item,
    session: serializeSession(session),
  };
};

/** Manual correction of a scanned quantity (scanning permission enforced at route). */
export const updateScanItem = async (sessionId, itemId, { scannedQty }) => {
  const session = await getOpenSession(sessionId);

  const item = session.items.id(itemId);
  if (!item) throw new ApiError(httpStatus.NOT_FOUND, 'Scan item not found');

  item.scannedQty = Number(scannedQty);
  item.status = itemStatusFor(item.scannedQty, item.expectedQty);
  await session.save();

  return serializeSession(session);
};

/**
 * Complete the session. Blocks when any row is short/excess/pending unless
 * `force` (mismatch override) is set with remarks; then moves the order to
 * scanning-done.
 */
export const completeSession = async (sessionId, user, { force = false, remarks = '' } = {}) => {
  const session = await getOpenSession(sessionId);

  const summary = sessionSummary(session);
  const hasMismatch = summary.short + summary.excess + summary.pending > 0;
  if (hasMismatch && !force) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Scanning has mismatches (${summary.pending} pending, ${summary.short} short, ${summary.excess} excess). Resolve them or complete with force + remarks.`
    );
  }
  if (hasMismatch && force && !String(remarks || '').trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Remarks are required when completing with mismatches');
  }

  session.status = ScanSessionStatus.COMPLETED;
  session.completedBy = user?._id ?? user?.id ?? null;
  session.completedByName = user?.name || user?.email || '';
  session.completedAt = new Date();
  session.mismatchOverride = hasMismatch;
  session.overrideRemarks = String(remarks || '').trim();
  await session.save();

  await transitionOrder(
    String(session.orderId),
    WarehouseOrderFlowStatus.SCANNING_DONE,
    user,
    { remarks: hasMismatch ? `Completed with mismatch override: ${session.overrideRemarks}` : 'Scanning completed' },
    { system: true }
  );

  return serializeSession(session);
};

export const cancelSession = async (sessionId, user, { remarks = '' } = {}) => {
  const session = await getOpenSession(sessionId);
  session.status = ScanSessionStatus.CANCELLED;
  session.overrideRemarks = String(remarks || '').trim();
  session.completedBy = user?._id ?? user?.id ?? null;
  session.completedByName = user?.name || user?.email || '';
  await session.save();
  return serializeSession(session);
};

export const getSessionById = async (sessionId) => {
  const session = await ScanSession.findById(sessionId);
  if (!session) throw new ApiError(httpStatus.NOT_FOUND, 'Scan session not found');
  return serializeSession(session);
};

export const querySessions = async (query, options) => {
  const filter = {};
  if (query.orderId) filter.orderId = query.orderId;
  if (query.status) filter.status = query.status;
  if (query.q && String(query.q).trim()) {
    filter.orderNumber = new RegExp(escapeRegex(String(query.q).trim()), 'i');
  }
  const result = await ScanSession.paginate(filter, { sortBy: 'createdAt:desc', ...options });
  return {
    ...result,
    results: result.results.map((s) => serializeSession(s)),
  };
};
