import Joi from 'joi';
import { objectId } from './custom.validation.js';

const createProductAttribute = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    type: Joi.string().required().valid('select', 'radio', 'checkbox', 'text', 'textarea'),
    sortOrder: Joi.number().default(0),
    optionValues: Joi.array().items(
      Joi.object().keys({
        name: Joi.string().required(),
        image: Joi.string(),
        sortOrder: Joi.number().default(0),
      })
    ),
  }),
};

const getProductAttributes = {
  query: Joi.object().keys({
    name: Joi.string(),
    type: Joi.string(),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getProductAttribute = {
  params: Joi.object().keys({
    attributeId: Joi.string().custom(objectId),
  }),
};

const updateProductAttribute = {
  params: Joi.object().keys({
    attributeId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      type: Joi.string().valid('select', 'radio', 'checkbox', 'text', 'textarea'),
      sortOrder: Joi.number(),
      optionValues: Joi.array().items(
        Joi.object().keys({
          name: Joi.string().required(),
          image: Joi.string(),
          sortOrder: Joi.number(),
        })
      ),
    })
    .min(1),
};

const deleteProductAttribute = {
  params: Joi.object().keys({
    attributeId: Joi.string().custom(objectId),
  }),
};

export default {
  createProductAttribute,
  getProductAttributes,
  getProductAttribute,
  updateProductAttribute,
  deleteProductAttribute,
}; 