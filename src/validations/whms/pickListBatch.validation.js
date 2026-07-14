import Joi from 'joi';
import { objectId } from '../custom.validation.js';

const batchStatuses = ['picking', 'sent-to-scanning', 'cancelled'];
const batchTypes = ['single', 'combined'];

export const createBatch = {
  body: Joi.object()
    .keys({
      orderIds: Joi.array().items(Joi.string().custom(objectId)).min(1).required(),
    })
    .required(),
};

export const getBatches = {
  query: Joi.object().keys({
    status: Joi.string().valid(...batchStatuses),
    type: Joi.string().valid(...batchTypes),
    orderId: Joi.string().custom(objectId),
    q: Joi.string().trim(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getBatch = {
  params: Joi.object().keys({
    batchId: Joi.string().custom(objectId).required(),
  }),
};

export const updateBatchItem = {
  params: Joi.object().keys({
    batchId: Joi.string().custom(objectId).required(),
    itemKey: Joi.string().required(),
  }),
  body: Joi.object()
    .keys({
      pickedQty: Joi.number().min(0).required(),
    })
    .required(),
};

export const saveBatchPicks = {
  params: Joi.object().keys({
    batchId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      picks: Joi.array()
        .items(
          Joi.object().keys({
            itemKey: Joi.string().required(),
            pickedQty: Joi.number().min(0).required(),
          })
        )
        .min(1)
        .required(),
    })
    .required(),
};

export const setBatchPicker = {
  params: Joi.object().keys({
    batchId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      pickerName: Joi.string().trim().min(1).required(),
    })
    .required(),
};

export const getBatchBarcodes = {
  params: Joi.object().keys({
    batchId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    styleCode: Joi.string().trim(),
    extraQty: Joi.number().integer().min(0).default(0),
  }),
};

export const sendBatchToScanning = {
  params: Joi.object().keys({
    batchId: Joi.string().custom(objectId).required(),
  }),
};

export const cancelBatch = {
  params: Joi.object().keys({
    batchId: Joi.string().custom(objectId).required(),
  }),
};

export const getBatchForOrder = {
  params: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
  }),
};
