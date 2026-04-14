import Joi from 'joi';
import { objectId } from '../custom.validation.js';

const statusValues = ['pending', 'accepted', 'rejected', 'onhold'];

const optionalObjectId = Joi.alternatives().try(
  Joi.string().custom(objectId),
  Joi.valid(null, '')
);

const sharedCreateFields = {
  articleNumber: Joi.string().required().trim(),
  QuantityFromFactory: Joi.number().min(0).required(),
  receivedQuantity: Joi.number().min(0).default(0),
  styleCode: Joi.string().allow('').trim(),
  brand: Joi.string().allow('').trim(),
  status: Joi.string().valid(...statusValues),
  orderData: Joi.object().unknown(true),
  receivedAt: Joi.date(),
  receivedInContainerId: Joi.string().custom(objectId).allow(null, ''),
  warehouseReceivedLineId: Joi.string().custom(objectId).allow(null, ''),
};

/** Production: Article + ProductionOrder required. */
const createBodyProduction = Joi.object({
  inwardSource: Joi.string().valid('production').default('production'),
  articleId: Joi.string().custom(objectId).required(),
  orderId: Joi.string().custom(objectId).required(),
  vendorProductionFlowId: optionalObjectId.optional(),
  vendorPurchaseOrderId: optionalObjectId.optional(),
  vendorDispatchReceivedLineId: optionalObjectId.optional(),
  ...sharedCreateFields,
});

/** Vendor: flow required; article/order optional / null. */
const createBodyVendor = Joi.object({
  inwardSource: Joi.string().valid('vendor').required(),
  articleId: optionalObjectId.optional(),
  orderId: optionalObjectId.optional(),
  vendorProductionFlowId: Joi.string().custom(objectId).required(),
  vendorPurchaseOrderId: Joi.string().custom(objectId).allow(null, '').optional(),
  vendorDispatchReceivedLineId: Joi.string().custom(objectId).allow(null, '').optional(),
  ...sharedCreateFields,
});

export const createInwardReceive = {
  body: Joi.alternatives().try(createBodyProduction, createBodyVendor),
};

/** Pull vendor dispatch lines into WHMS inward queue (idempotent per dispatch line id). */
export const promoteVendorDispatchToInwardReceive = {
  body: Joi.object()
    .keys({
      vendorProductionFlowId: Joi.string().custom(objectId).required(),
      containerBarcode: Joi.string().trim().allow('', null).optional(),
    })
    .required(),
};

export const getInwardReceives = {
  query: Joi.object().keys({
    status: Joi.string().valid(...statusValues),
    inwardSource: Joi.string().valid('production', 'vendor'),
    articleId: Joi.string().custom(objectId),
    orderId: Joi.string().custom(objectId),
    vendorProductionFlowId: Joi.string().custom(objectId),
    vendorPurchaseOrderId: Joi.string().custom(objectId),
    articleNumber: Joi.string().trim(),
    styleCode: Joi.string().trim(),
    brand: Joi.string().trim(),
    /** Filter by createdAt (default) or receivedAt */
    dateField: Joi.string().valid('createdAt', 'receivedAt'),
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    receivedAtFrom: Joi.date(),
    receivedAtTo: Joi.date(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getInwardReceive = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

/** WHMS PATCH — typical: receivedQuantity + status from UI. */
export const updateInwardReceive = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      receivedQuantity: Joi.number().min(0),
      status: Joi.string().valid(...statusValues),
      styleCode: Joi.string().allow('').trim(),
      brand: Joi.string().allow('').trim(),
      QuantityFromFactory: Joi.number().min(0),
      orderData: Joi.object().unknown(true),
      receivedAt: Joi.date(),
    })
    .min(1),
};

export const deleteInwardReceive = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};
