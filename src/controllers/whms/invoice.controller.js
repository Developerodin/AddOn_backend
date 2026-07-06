import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import * as invoiceService from '../../services/whms/invoice.service.js';

const createInvoiceFromOrder = catchAsync(async (req, res) => {
  const invoice = await invoiceService.createInvoiceFromOrder(req.params.orderId, req.user, req.body);
  res.status(httpStatus.CREATED).send(invoice);
});

const getInvoices = catchAsync(async (req, res) => {
  const filter = invoiceService.buildInvoiceFilter(pick(req.query, ['orderId', 'invoiceNumber', 'status', 'q']));
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await invoiceService.queryInvoices(filter, options);
  res.send(result);
});

const getInvoice = catchAsync(async (req, res) => {
  const invoice = await invoiceService.getInvoiceById(req.params.invoiceId);
  res.send(invoice);
});

const getInvoicePrintPayload = catchAsync(async (req, res) => {
  const payload = await invoiceService.buildInvoicePrintPayload(req.params.invoiceId);
  res.send(payload);
});

const cancelInvoice = catchAsync(async (req, res) => {
  const invoice = await invoiceService.cancelInvoice(req.params.invoiceId, req.user, req.body);
  res.send(invoice);
});

export { createInvoiceFromOrder, getInvoices, getInvoice, getInvoicePrintPayload, cancelInvoice };
