import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const createColor = {
  body: Joi.object().keys({
    name: Joi.string().required().trim(),
    colorCode: Joi.string()
      .required()
      .pattern(/^#[0-9A-F]{6}$/i)
      .messages({
        'string.pattern.base': 'Color code must be a valid hex color (e.g., #FF5733)',
      }),
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getColors = {
  query: Joi.object().keys({
    name: Joi.string(),
    status: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getColor = {
  params: Joi.object().keys({
    colorId: Joi.string().custom(objectId).required(),
  }),
};

export const updateColor = {
  params: Joi.object().keys({
    colorId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string().trim(),
      colorCode: Joi.string()
        .pattern(/^#[0-9A-F]{6}$/i)
        .messages({
          'string.pattern.base': 'Color code must be a valid hex color (e.g., #FF5733)',
        }),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

export const deleteColor = {
  params: Joi.object().keys({
    colorId: Joi.string().custom(objectId).required(),
  }),
};

export const bulkImportColors = {
  body: Joi.object().keys({
    colors: Joi.array().items(
      Joi.object().keys({
        id: Joi.string().custom(objectId).optional().description('MongoDB ObjectId for updating existing color'),
        name: Joi.string().required().trim().messages({
          'string.empty': 'Color name is required',
          'any.required': 'Color name is required'
        }),
        colorCode: Joi.string()
          .required()
          .pattern(/^#[0-9A-F]{6}$/i)
          .messages({
            'string.pattern.base': 'Color code must be a valid hex color (e.g., #FF5733)',
            'string.empty': 'Color code is required',
            'any.required': 'Color code is required'
          }),
        status: Joi.string().valid('active', 'inactive').default('active'),
      })
    ).min(1).max(1000).messages({
      'array.min': 'At least one color is required',
      'array.max': 'Maximum 1000 colors allowed per request'
    }),
    batchSize: Joi.number().integer().min(1).max(100).default(50).messages({
      'number.min': 'Batch size must be at least 1',
      'number.max': 'Batch size cannot exceed 100'
    }),
  }),
};

