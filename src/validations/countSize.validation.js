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

export const bulkImportCountSizes = {
  body: Joi.object().keys({
    countSizes: Joi.array().items(
      Joi.object().keys({
        id: Joi.string().custom(objectId).optional().description('MongoDB ObjectId for updating existing count size'),
        name: Joi.string().required().trim().messages({
          'string.empty': 'Count size name is required',
          'any.required': 'Count size name is required'
        }),
        status: Joi.string().valid('active', 'inactive').default('active'),
      })
    ).min(1).max(1000).messages({
      'array.min': 'At least one count size is required',
      'array.max': 'Maximum 1000 count sizes allowed per request'
    }),
    batchSize: Joi.number().integer().min(1).max(100).default(50).messages({
      'number.min': 'Batch size must be at least 1',
      'number.max': 'Batch size cannot exceed 100'
    }),
  }),
};

