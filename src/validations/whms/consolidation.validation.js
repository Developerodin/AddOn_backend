import Joi from 'joi';
import { objectId } from '../custom.validation.js';

export const createBatch = {
  body: Joi.object().keys({
    batchCode: Joi.string().allow(''),
    orderIds: Joi.array().items(Joi.string().custom(objectId)).min(0),
  }),
};

export const getBatches = {
  query: Joi.object().keys({
    status: Joi.string().valid('draft', 'ready', 'dispatched'),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getBatch = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

export const updateBatch = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    orderIds: Joi.array().items(Joi.string().custom(objectId)),
    status: Joi.string().valid('draft', 'ready', 'dispatched'),
  }).min(1),
};

export const setBatchStatus = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    status: Joi.string().valid('draft', 'ready', 'dispatched').required(),
  }),
};
