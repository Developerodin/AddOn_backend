import Joi from 'joi';
import { objectId } from '../custom.validation.js';

export const createSession = {
  body: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
};

export const getSessions = {
  query: Joi.object().keys({
    orderId: Joi.string().custom(objectId),
    status: Joi.string().valid('open', 'completed', 'cancelled'),
    q: Joi.string().allow('').trim(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getSession = {
  params: Joi.object().keys({
    sessionId: Joi.string().custom(objectId).required(),
  }),
};

export const scanBarcode = {
  params: Joi.object().keys({
    sessionId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    barcode: Joi.string().trim().required(),
    qty: Joi.number().integer().min(1).default(1),
  }),
};

export const updateScanItem = {
  params: Joi.object().keys({
    sessionId: Joi.string().custom(objectId).required(),
    itemId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    scannedQty: Joi.number().integer().min(0).required(),
  }),
};

export const completeSession = {
  params: Joi.object().keys({
    sessionId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    force: Joi.boolean().default(false),
    closeWithShortQty: Joi.boolean().default(false),
    remarks: Joi.string().allow('').trim().max(1000),
  }),
};

export const cancelSession = {
  params: Joi.object().keys({
    sessionId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    remarks: Joi.string().allow('').trim().max(1000),
  }),
};
