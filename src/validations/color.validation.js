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

