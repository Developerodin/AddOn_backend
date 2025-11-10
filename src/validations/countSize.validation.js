import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const createCountSize = {
  body: Joi.object().keys({
    name: Joi.string().required().trim(),
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getCountSizes = {
  query: Joi.object().keys({
    name: Joi.string(),
    status: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getCountSize = {
  params: Joi.object().keys({
    countSizeId: Joi.string().custom(objectId).required(),
  }),
};

export const updateCountSize = {
  params: Joi.object().keys({
    countSizeId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string().trim(),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

export const deleteCountSize = {
  params: Joi.object().keys({
    countSizeId: Joi.string().custom(objectId).required(),
  }),
};

