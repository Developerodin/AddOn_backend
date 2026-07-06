import Joi from 'joi';
import { objectId } from '../custom.validation.js';

const returnIdParams = Joi.object().keys({
  returnId: Joi.string().custom(objectId).required(),
});

export const createReturn = {
  body: Joi.object()
    .keys({
      type: Joi.string().valid('rto', 'rtv').required(),
      invoiceId: Joi.string().custom(objectId),
      invoiceNumber: Joi.string().trim(),
      reason: Joi.string()
        .valid('damage', 'wrong-item', 'size-issue', 'delivery-issue', 'courier-rto', 'other')
        .required(),
      remarks: Joi.string().allow('').trim().max(1000),
    })
    .or('invoiceId', 'invoiceNumber'),
};

export const getReturns = {
  query: Joi.object().keys({
    type: Joi.string().valid('rto', 'rtv'),
    status: Joi.string().valid('scanning', 'pending-approval', 'approved', 'rejected'),
    reason: Joi.string().valid('damage', 'wrong-item', 'size-issue', 'delivery-issue', 'courier-rto', 'other'),
    orderId: Joi.string().custom(objectId),
    invoiceId: Joi.string().custom(objectId),
    q: Joi.string().trim(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getReturn = {
  params: returnIdParams,
};

export const scanReturnItem = {
  params: returnIdParams,
  body: Joi.object().keys({
    barcode: Joi.string().trim().required(),
    qty: Joi.number().integer().min(1).default(1),
  }),
};

export const updateReturnItem = {
  params: Joi.object().keys({
    returnId: Joi.string().custom(objectId).required(),
    itemId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      scannedQty: Joi.number().integer().min(0),
      verifiedQty: Joi.number().integer().min(0),
      condition: Joi.string().valid('saleable', 'damaged', 'repair', ''),
      decision: Joi.string().valid('restock', 'damaged-stock', 'repair', 'reject', ''),
      remarks: Joi.string().allow('').trim().max(1000),
    })
    .min(1),
};

export const submitReturn = {
  params: returnIdParams,
};

export const approveReturn = {
  params: returnIdParams,
};

export const rejectReturn = {
  params: returnIdParams,
  body: Joi.object().keys({
    reason: Joi.string().allow('').trim().max(1000),
  }),
};
