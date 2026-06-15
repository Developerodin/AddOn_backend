import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const listVendorGrns = {
  query: Joi.object().keys({
    grnNumber: Joi.string(),
    vpoNumber: Joi.string(),
    vendorPurchaseOrder: Joi.string().custom(objectId),
    lotNumber: Joi.string(),
    vendorName: Joi.string(),
    from: Joi.date().iso(),
    to: Joi.date().iso(),
    status: Joi.string().valid('active', 'superseded', 'voided'),
    includeSuperseded: Joi.boolean(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getVendorGrn = {
  params: Joi.object().keys({
    grnId: Joi.string().custom(objectId).required(),
  }),
};

export const getVendorGrnByNumber = {
  params: Joi.object().keys({
    grnNumber: Joi.string().required(),
  }),
};

export const getVendorGrnsByVpo = {
  params: Joi.object().keys({
    vpoId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    includeSuperseded: Joi.boolean(),
  }),
};

export const getVendorGrnsByLot = {
  params: Joi.object().keys({
    lotNumber: Joi.string().required(),
  }),
  query: Joi.object().keys({
    includeSuperseded: Joi.boolean(),
  }),
};

export const issueVendorGrnFromFlow = {
  params: Joi.object().keys({
    flowId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    allowIncomplete: Joi.boolean(),
    discrepancyDetails: Joi.string().allow('', null),
    notes: Joi.string().allow('', null),
    revisionReason: Joi.string().allow('', null),
  }),
};

export const ensureVendorGrnsForVpo = {
  params: Joi.object().keys({
    vpoId: Joi.string().custom(objectId).required(),
  }),
};

export const getVendorGrnRevisions = {
  params: Joi.object().keys({
    grnId: Joi.string().custom(objectId).required(),
  }),
};

export const updateVendorGrnHeader = {
  params: Joi.object().keys({
    grnId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      notes: Joi.string().allow('', null),
      discrepancyDetails: Joi.string().allow('', null),
    })
    .min(1),
};

export const getActiveVendorGrnForFlow = {
  params: Joi.object().keys({
    flowId: Joi.string().custom(objectId).required(),
  }),
};
