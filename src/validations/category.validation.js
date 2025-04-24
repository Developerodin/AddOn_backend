import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const createCategory = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    parent: Joi.string().custom(objectId).allow(null),
    description: Joi.string(),
    image: Joi.string(),
    sortOrder: Joi.number().integer(),
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getCategories = {
  query: Joi.object().keys({
    name: Joi.string(),
    parent: Joi.string().custom(objectId),
    status: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getCategory = {
  params: Joi.object().keys({
    categoryId: Joi.string().custom(objectId),
  }),
};

export const updateCategory = {
  params: Joi.object().keys({
    categoryId: Joi.string().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      parent: Joi.string().custom(objectId).allow(null),
      description: Joi.string(),
      image: Joi.string(),
      sortOrder: Joi.number().integer(),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

export const deleteCategory = {
  params: Joi.object().keys({
    categoryId: Joi.string().custom(objectId),
  }),
}; 