import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const createVendorReturnSession = {
  body: Joi.object().keys({
    vpoNumber: Joi.string().required(),
    remark: Joi.string().allow('', null),
    cancellationIntent: Joi.string().valid('partial', 'full_vpo').required(),
  }),
};

export const getVendorReturnSession = {
  params: Joi.object().keys({
    sessionId: Joi.string().custom(objectId).required(),
  }),
};

export const scanVendorReturnBarcode = {
  params: Joi.object().keys({
    sessionId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    barcode: Joi.string().required(),
  }),
};

export const removeVendorReturnBarcode = {
  params: Joi.object().keys({
    sessionId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    barcode: Joi.string().required(),
  }),
};

export const addVendorReturnM4Line = {
  params: Joi.object().keys({
    sessionId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    vendorProductionFlowId: Joi.string().custom(objectId).required(),
    m4Quantity: Joi.number().integer().min(1).required(),
    lotNumber: Joi.string().allow('', null),
  }),
};

export const finalizeVendorReturnSession = {
  params: Joi.object().keys({
    sessionId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    idempotencyKey: Joi.string().allow('', null),
  }),
};

export const listVendorReturnHistory = {
  query: Joi.object().keys({
    vpoNumber: Joi.string(),
    limit: Joi.number().integer(),
  }),
};

export const getM4ReturnCandidates = {
  query: Joi.object().keys({
    vpoNumber: Joi.string().required(),
  }),
};

export const getArticleReturnCandidates = {
  query: Joi.object().keys({
    vpoNumber: Joi.string().required(),
  }),
};

export const getArticleReturnBoxes = {
  query: Joi.object().keys({
    vpoNumber: Joi.string().required(),
    vendorProductionFlowId: Joi.string().custom(objectId).required(),
  }),
};

export const addVendorReturnArticleQtyLine = {
  params: Joi.object().keys({
    sessionId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    vendorProductionFlowId: Joi.string().custom(objectId).required(),
    quantity: Joi.number().integer().min(1).required(),
    lotNumber: Joi.string().allow('', null),
  }),
};

export const removeVendorReturnArticleQtyLine = {
  params: Joi.object().keys({
    sessionId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    vendorProductionFlowId: Joi.string().custom(objectId).required(),
  }),
};

export const removeVendorReturnM4Line = {
  params: Joi.object().keys({
    sessionId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    vendorProductionFlowId: Joi.string().custom(objectId).required(),
  }),
};
