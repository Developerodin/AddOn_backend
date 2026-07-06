import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as invoiceValidation from '../../../validations/whms/invoice.validation.js';
import * as invoiceController from '../../../controllers/whms/invoice.controller.js';

const router = express.Router();

router
  .route('/')
  .get(
    auth('getOrders'),
    validate(invoiceValidation.getInvoices),
    invoiceController.getInvoices
  );

router
  .route('/from-order/:orderId')
  .post(
    auth('whmsBilling'),
    validate(invoiceValidation.createInvoiceFromOrder),
    invoiceController.createInvoiceFromOrder
  );

router
  .route('/:invoiceId')
  .get(
    auth('getOrders'),
    validate(invoiceValidation.getInvoice),
    invoiceController.getInvoice
  );

router
  .route('/:invoiceId/print')
  .get(
    auth('getOrders'),
    validate(invoiceValidation.getInvoice),
    invoiceController.getInvoicePrintPayload
  );

router
  .route('/:invoiceId/cancel')
  .post(
    auth('whmsBilling'),
    validate(invoiceValidation.cancelInvoice),
    invoiceController.cancelInvoice
  );

export default router;
