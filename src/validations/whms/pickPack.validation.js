import Joi from 'joi';
import { objectId } from '../custom.validation.js';

export const getPickList = {
  query: Joi.object().keys({
    batchId: Joi.string().allow(''),
  }),
};

export const generatePickList = {
  body: Joi.object().keys({
    orderIds: Joi.array().items(Joi.string().custom(objectId)).min(1),
    batchId: Joi.string().allow(''),
  }),
};

export const updatePickListItem = {
  params: Joi.object().keys({
    listId: Joi.string().custom(objectId).required(),
    itemId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    pickedQty: Joi.number().min(0),
    status: Joi.string().valid('pending', 'partial', 'picked', 'verified', 'skipped'),
  }).min(1),
};

export const confirmPick = {
  body: Joi.object().keys({
    itemId: Joi.string().custom(objectId).required(),
    pickedQty: Joi.number().min(0),
  }),
};

export const skipPickItem = {
  body: Joi.object().keys({
    itemId: Joi.string().custom(objectId).required(),
  }),
};

export const scanPick = {
  body: Joi.object().keys({
    skuOrBarcode: Joi.string().required(),
    rackLocation: Joi.object({
      zone: Joi.string(),
      row: Joi.string(),
      column: Joi.string(),
      bin: Joi.string(),
    }),
  }),
};

export const getPackList = {
  query: Joi.object().keys({
    batchId: Joi.string().allow(''),
  }),
};

export const createPackBatch = {
  body: Joi.object().keys({
    orderIds: Joi.array().items(Joi.string().custom(objectId)).min(1),
  }),
};

export const getPackBatch = {
  params: Joi.object().keys({
    batchId: Joi.string().required(),
  }),
};

export const updatePackItemQty = {
  params: Joi.object().keys({
    batchId: Joi.string().custom(objectId).required(),
    orderId: Joi.string().custom(objectId).required(),
    itemId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    packedQty: Joi.number().min(0).required(),
  }),
};

export const addCarton = {
  params: Joi.object().keys({
    batchId: Joi.string().custom(objectId).required(),
  }),
};

export const updateCarton = {
  params: Joi.object().keys({
    batchId: Joi.string().custom(objectId).required(),
    cartonId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    cartonBarcode: Joi.string().allow(''),
  }),
};

export const completePackBatch = {
  params: Joi.object().keys({
    batchId: Joi.string().custom(objectId).required(),
  }),
};

export const generateBarcodes = {
  body: Joi.object().keys({
    batchId: Joi.string().custom(objectId).required(),
    orderId: Joi.string().custom(objectId),
    itemIds: Joi.array().items(Joi.string().custom(objectId)),
    types: Joi.array().items(Joi.string().valid('item', 'carton', 'order')),
    quantity: Joi.number().integer().min(1),
  }),
};

export const createDamageMissingReport = {
  body: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
    orderNumber: Joi.string().allow(''),
    sku: Joi.string().required(),
    itemName: Joi.string().allow(''),
    type: Joi.string().valid('damage', 'missing').required(),
    quantity: Joi.number().min(0).required(),
    reason: Joi.string().allow(''),
    notes: Joi.string().allow(''),
  }),
};

export const getDamageMissingReports = {
  query: Joi.object().keys({
    orderId: Joi.string().custom(objectId),
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const scanPack = {
  body: Joi.object().keys({
    barcode: Joi.string().required(),
    batchId: Joi.string().custom(objectId).required(),
    orderId: Joi.string().custom(objectId),
  }),
};
