import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import WhmsInvoice, { WhmsInvoiceStatus } from '../../models/whms/invoice.model.js';
import ScanSession, { ScanSessionStatus } from '../../models/whms/scanSession.model.js';
import WarehouseOrder, { WarehouseOrderFlowStatus } from '../../models/whms/warehouseOrder.model.js';
import { transitionOrder } from './orderFlow.service.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const generateInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const last = await WhmsInvoice.findOne({ invoiceNumber: new RegExp(`^WH-INV-${year}-`) })
    .sort({ createdAt: -1 })
    .select('invoiceNumber');
  const match = String(last?.invoiceNumber || '').match(/^WH-INV-\d{4}-(\d+)$/);
  const seq = match ? parseInt(match[1], 10) + 1 : 1;
  return `WH-INV-${year}-${String(seq).padStart(5, '0')}`;
};

/**
 * Generate the invoice for an order from its completed scan session.
 * Requires flowStatus `sent-to-billing`; on success the order moves to `billed`.
 *
 * @param {string} orderId
 * @param {object} user
 * @param {object} [body]
 * @param {Array<{styleCode: string, rate: number}>} [body.rates] - optional per-styleCode rates
 * @param {string} [body.remarks]
 */
export const createInvoiceFromOrder = async (orderId, user, body = {}) => {
  const order = await WarehouseOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Warehouse order not found');

  if (order.flowStatus !== WarehouseOrderFlowStatus.SENT_TO_BILLING) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Order must be in "sent-to-billing" to generate an invoice (current: "${order.flowStatus}")`
    );
  }

  const existing = await WhmsInvoice.findOne({ orderId, status: { $ne: WhmsInvoiceStatus.CANCELLED } });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Invoice ${existing.invoiceNumber} already exists for this order`);
  }

  const scanSession = await ScanSession.findOne({ orderId, status: ScanSessionStatus.COMPLETED }).sort({
    completedAt: -1,
  });
  if (!scanSession) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No completed scan session found — billing uses scanned quantities');
  }

  const rateByStyleCode = new Map(
    (Array.isArray(body.rates) ? body.rates : [])
      .filter((r) => r && r.styleCode)
      .map((r) => [String(r.styleCode), Number(r.rate)])
  );

  const items = (scanSession.items || [])
    .filter((item) => Number(item.scannedQty || 0) > 0)
    .map((item) => {
      const quantity = Number(item.scannedQty || 0);
      const rate = rateByStyleCode.get(item.styleCode);
      return {
        styleCode: item.styleCode,
        skuCode: item.skuCode,
        size: item.size || '',
        shade: item.shade || '',
        quantity,
        ...(Number.isFinite(rate) ? { rate, amount: rate * quantity } : {}),
      };
    });

  if (!items.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Scan session has no scanned quantities to bill');
  }

  const invoice = await WhmsInvoice.create({
    invoiceNumber: await generateInvoiceNumber(),
    orderId: order._id,
    orderNumber: order.orderNumber,
    addonOrderId: order.addonOrderId,
    scanSessionId: scanSession._id,
    clientType: order.clientType,
    clientId: order.clientId,
    clientName: order.clientName,
    items,
    totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
    totalAmount: items.reduce((s, i) => s + Number(i.amount || 0), 0),
    status: WhmsInvoiceStatus.FINAL,
    remarks: String(body.remarks || '').trim(),
    createdBy: user?._id ?? user?.id ?? null,
    createdByName: user?.name || user?.email || '',
  });

  order.invoiceId = invoice._id;
  await order.save();

  await transitionOrder(
    String(order._id),
    WarehouseOrderFlowStatus.BILLED,
    user,
    { remarks: `Invoice ${invoice.invoiceNumber} generated` },
    { system: true, viaInvoice: true }
  );

  return invoice;
};

export const buildInvoiceFilter = (query) => {
  const filter = {};
  if (query.orderId) filter.orderId = query.orderId;
  if (query.status) filter.status = query.status;
  if (query.invoiceNumber && String(query.invoiceNumber).trim()) {
    filter.invoiceNumber = new RegExp(`^${escapeRegex(String(query.invoiceNumber).trim())}`, 'i');
  }
  if (query.q && String(query.q).trim()) {
    const regex = new RegExp(escapeRegex(String(query.q).trim()), 'i');
    filter.$or = [{ invoiceNumber: regex }, { orderNumber: regex }, { clientName: regex }, { addonOrderId: regex }];
  }
  return filter;
};

export const queryInvoices = async (filter, options) => {
  return WhmsInvoice.paginate(filter, { sortBy: 'createdAt:desc', ...options });
};

export const getInvoiceById = async (invoiceId) => {
  const invoice = await WhmsInvoice.findById(invoiceId);
  if (!invoice) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found');
  return invoice;
};

/** Print-ready payload; rendering (browser print / PDF) happens on the frontend. */
export const buildInvoicePrintPayload = async (invoiceId) => {
  const invoice = await WhmsInvoice.findById(invoiceId).populate('clientId');
  if (!invoice) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found');

  const json = invoice.toJSON();
  return {
    ...json,
    items: (json.items || []).map((item, index) => ({ srNo: index + 1, ...item })),
    generatedAt: new Date(),
  };
};

/**
 * Cancel an invoice. If the order is still in `billed`, it reverts to
 * `sent-to-billing` and the invoice link is cleared so a new one can be made.
 */
export const cancelInvoice = async (invoiceId, user, { reason = '' } = {}) => {
  const invoice = await WhmsInvoice.findById(invoiceId);
  if (!invoice) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found');
  if (invoice.status === WhmsInvoiceStatus.CANCELLED) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invoice is already cancelled');
  }

  invoice.status = WhmsInvoiceStatus.CANCELLED;
  invoice.cancelledAt = new Date();
  invoice.cancelReason = String(reason || '').trim();
  await invoice.save();

  const order = await WarehouseOrder.findById(invoice.orderId);
  if (order && order.flowStatus === WarehouseOrderFlowStatus.BILLED) {
    order.invoiceId = null;
    order.flowStatus = WarehouseOrderFlowStatus.SENT_TO_BILLING;
    order.flowHistory.push({
      from: WarehouseOrderFlowStatus.BILLED,
      to: WarehouseOrderFlowStatus.SENT_TO_BILLING,
      byUserId: user?._id ?? user?.id ?? null,
      byName: user?.name || user?.email || '',
      remarks: `Invoice ${invoice.invoiceNumber} cancelled${invoice.cancelReason ? `: ${invoice.cancelReason}` : ''}`,
      at: new Date(),
    });
    await order.save();
  }

  return invoice;
};
