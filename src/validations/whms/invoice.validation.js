import Joi from 'joi';
import { objectId } from '../custom.validation.js';

export const createInvoiceFromOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    rates: Joi.array().items(
      Joi.object({
        styleCode: Joi.string().trim().required(),
        rate: Joi.number().min(0).required(),
      })
    ),
    remarks: Joi.string().allow('').trim().max(1000),
  }),
};

export const getInvoices = {
  query: Joi.object().keys({
    orderId: Joi.string().custom(objectId),
    invoiceNumber: Joi.string().trim(),
    status: Joi.string().valid('draft', 'final', 'cancelled'),
    q: Joi.string().trim(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getInvoice = {
  params: Joi.object().keys({
    invoiceId: Joi.string().custom(objectId).required(),
  }),
};

export const cancelInvoice = {
  params: Joi.object().keys({
    invoiceId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    reason: Joi.string().allow('').trim().max(1000),
  }),
};
