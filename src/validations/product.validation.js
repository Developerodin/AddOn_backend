import Joi from 'joi';
import { objectId } from './custom.validation.js';

const createProduct = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    softwareCode: Joi.string().required(),
    internalCode: Joi.string().required(),
    vendorCode: Joi.string().required(),
    factoryCode: Joi.string().required(),
    styleCode: Joi.string().required(),
    eanCode: Joi.string().required(),
    description: Joi.string().required(),
    category: Joi.string().custom(objectId).required(),
    image: Joi.string(),
    attributes: Joi.object().pattern(Joi.string(), Joi.string()),
    bom: Joi.array().items(
      Joi.object().keys({
        materialId: Joi.string().custom(objectId).required(),
        quantity: Joi.number().min(0).required(),
      })
    ),
    processes: Joi.array().items(
      Joi.object().keys({
        processId: Joi.string().custom(objectId),
      })
    ),
    status: Joi.string().valid('active', 'inactive'),
  }),
};

const getProducts = {
  query: Joi.object().keys({
    name: Joi.string(),
    softwareCode: Joi.string(),
    internalCode: Joi.string(),
    vendorCode: Joi.string(),
    factoryCode: Joi.string(),
    styleCode: Joi.string(),
    eanCode: Joi.string(),
    category: Joi.string().custom(objectId),
    status: Joi.string().valid('active', 'inactive'),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getProduct = {
  params: Joi.object().keys({
    productId: Joi.string().custom(objectId),
  }),
};

const updateProduct = {
  params: Joi.object().keys({
    productId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      softwareCode: Joi.string(),
      internalCode: Joi.string(),
      vendorCode: Joi.string(),
      factoryCode: Joi.string(),
      styleCode: Joi.string(),
      eanCode: Joi.string(),
      description: Joi.string(),
      category: Joi.string().custom(objectId),
      image: Joi.string(),
      attributes: Joi.object().pattern(Joi.string(), Joi.string()),
      bom: Joi.array().items(
        Joi.object().keys({
          materialId: Joi.string().custom(objectId).required(),
          quantity: Joi.number().min(0).required(),
        })
      ),
      processes: Joi.array().items(
        Joi.object().keys({
          processId: Joi.string().custom(objectId),
        })
      ),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

const deleteProduct = {
  params: Joi.object().keys({
    productId: Joi.string().custom(objectId),
  }),
};

export default {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
}; 