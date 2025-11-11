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

export const bulkImportBlends = {
  body: Joi.object().keys({
    blends: Joi.array().items(
      Joi.object().keys({
        id: Joi.string().custom(objectId).optional().description('MongoDB ObjectId for updating existing blend'),
        name: Joi.string().required().trim().messages({
          'string.empty': 'Blend name is required',
          'any.required': 'Blend name is required'
        }),
        status: Joi.string().valid('active', 'inactive').default('active'),
      })
    ).min(1).max(1000).messages({
      'array.min': 'At least one blend is required',
      'array.max': 'Maximum 1000 blends allowed per request'
    }),
    batchSize: Joi.number().integer().min(1).max(100).default(50).messages({
      'number.min': 'Batch size must be at least 1',
      'number.max': 'Batch size cannot exceed 100'
    }),
  }),
};

