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
        materialId: Joi.string().custom(objectId),
        quantity: Joi.number().min(0),
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
    populate: Joi.string(),
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

const bulkImportProducts = {
  body: Joi.object().keys({
    products: Joi.array().items(
      Joi.object().keys({
        id: Joi.string().custom(objectId).optional(), // For updates
        name: Joi.string().required(),
        styleCode: Joi.string().required(),
        internalCode: Joi.string().optional().default(''),
        vendorCode: Joi.string().optional().default(''),
        factoryCode: Joi.string().optional().default(''),
        eanCode: Joi.string().optional().default(''),
        description: Joi.string().optional().default(''),
        category: Joi.string().custom(objectId).optional(),
        softwareCode: Joi.string().optional(), // Auto-generated if not provided
      })
    ).min(1).max(1000), // Limit batch size to 1000 products
    batchSize: Joi.number().integer().min(1).max(100).default(50), // Default batch size
  }),
};

export default {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  bulkImportProducts,
}; 