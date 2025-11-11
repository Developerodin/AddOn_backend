import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const createBlend = {
  body: Joi.object().keys({
    name: Joi.string().required().trim(),
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getBlends = {
  query: Joi.object().keys({
    name: Joi.string(),
    status: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getBlend = {
  params: Joi.object().keys({
    blendId: Joi.string().custom(objectId).required(),
  }),
};

export const updateBlend = {
  params: Joi.object().keys({
    blendId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string().trim(),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

export const deleteBlend = {
  params: Joi.object().keys({
    blendId: Joi.string().custom(objectId).required(),
  }),
};

