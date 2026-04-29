import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { yarnGrnStatuses } from '../models/yarnReq/yarnGrn.model.js';

export const listGrns = {
  query: Joi.object().keys({
    grnNumber: Joi.string().trim(),
    poNumber: Joi.string().trim(),
    purchaseOrder: Joi.string().custom(objectId),
    lotNumber: Joi.string().trim(),
    supplierName: Joi.string().trim(),
    createdBy: Joi.string().custom(objectId),
    from: Joi.date().iso(),
    to: Joi.date().iso(),
    status: Joi.string().valid(...yarnGrnStatuses),
    includeSuperseded: Joi.boolean(),
    isLegacy: Joi.boolean(),
    sortBy: Joi.string(),
    limit: Joi.number().integer().min(1).max(200),
    page: Joi.number().integer().min(1),
  }),
};

export const getGrn = {
  params: Joi.object().keys({
    grnId: Joi.string().custom(objectId).required(),
  }),
};

export const getGrnRevisions = {
  params: Joi.object().keys({
    grnId: Joi.string().custom(objectId).required(),
  }),
};

export const getGrnByNumber = {
  params: Joi.object().keys({
    grnNumber: Joi.string().trim().required(),
  }),
};

export const getGrnsByPo = {
  params: Joi.object().keys({
    purchaseOrderId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    includeSuperseded: Joi.boolean(),
  }),
};

export const getGrnsByLot = {
  params: Joi.object().keys({
    lotNumber: Joi.string().trim().required(),
  }),
  query: Joi.object().keys({
    includeSuperseded: Joi.boolean(),
  }),
};

export const ensureGrnForPo = {
  params: Joi.object().keys({
    purchaseOrderId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      vendorInvoiceNo: Joi.string().allow('').max(120),
      vendorInvoiceDate: Joi.date().iso().allow(null, ''),
      discrepancyDetails: Joi.string().allow('').max(2000),
      notes: Joi.string().allow('').max(2000),
    })
    .unknown(false)
    .default({}),
};

export const updateGrnHeader = {
  params: Joi.object().keys({
    grnId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      vendorInvoiceNo: Joi.string().allow('').max(120),
      vendorInvoiceDate: Joi.date().iso().allow(null, ''),
      discrepancyDetails: Joi.string().allow('').max(2000),
      notes: Joi.string().allow('').max(2000),
    })
    .min(1)
    .unknown(false),
};
