import Joi from 'joi';
import { objectId } from './custom.validation.js';

const createProduct = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    softwareCode: Joi.string().required(),
    internalCode: Joi.string().required(),
    vendorCode: Joi.string().required(),
    factoryCode: Joi.string().required(),
    knittingCode: Joi.string().optional().allow('').default(''),
    styleCodes: Joi.array().items(
      Joi.object().keys({
        styleCode: Joi.string().required().trim(),
        eanCode: Joi.string().required().trim(),
        mrp: Joi.number().required().min(0),
        brand: Joi.string().trim().allow(''),
        pack: Joi.string().trim().allow(''),
      })
    ).min(1).required(),
    description: Joi.string().required(),
    category: Joi.string().custom(objectId).required(),
    image: Joi.string(),
    attributes: Joi.object().pattern(Joi.string(), Joi.string()),
    bom: Joi.array().items(
      Joi.object().keys({
        yarnCatalogId: Joi.string().custom(objectId),
        yarnName: Joi.string().trim(),
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
    knittingCode: Joi.string(),
    styleCode: Joi.string(),
    eanCode: Joi.string(),
    brand: Joi.string(),
    pack: Joi.string(),
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
      knittingCode: Joi.string(),
      styleCodes: Joi.array().items(
        Joi.object().keys({
          styleCode: Joi.string().required().trim(),
          eanCode: Joi.string().required().trim(),
          mrp: Joi.number().required().min(0),
          brand: Joi.string().trim().allow(''),
          pack: Joi.string().trim().allow(''),
        })
      ),
      description: Joi.string(),
      category: Joi.string().custom(objectId),
      image: Joi.string(),
      attributes: Joi.object().pattern(Joi.string(), Joi.string()),
      bom: Joi.array().items(
        Joi.object().keys({
          yarnCatalogId: Joi.string().custom(objectId),
          yarnName: Joi.string().trim(),
          quantity: Joi.number().min(0),
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
        styleCodes: Joi.array().items(
          Joi.object().keys({
            styleCode: Joi.string().required().trim(),
            eanCode: Joi.string().required().trim(),
            mrp: Joi.number().required().min(0),
            brand: Joi.string().trim().allow(''),
            pack: Joi.string().trim().allow(''),
          })
        ).min(1).required(),
        internalCode: Joi.string().optional().default(''),
        vendorCode: Joi.string().optional().default(''),
        factoryCode: Joi.string().optional().default(''),
        knittingCode: Joi.string().optional().default(''),
        description: Joi.string().optional().default(''),
        category: Joi.string().custom(objectId).optional(),
        softwareCode: Joi.string().optional(), // Auto-generated if not provided
      })
    ).min(1).max(10000), // Limit batch size to 10000 products
    batchSize: Joi.number().integer().min(1).max(100).default(50), // Default batch size
  }),
};

const getProductByCode = {
  query: Joi.object()
    .keys({
      factoryCode: Joi.string().trim().optional(),
      internalCode: Joi.string().trim().optional(),
    })
    .or('factoryCode', 'internalCode')
    .messages({
      'object.missing': 'Either factoryCode or internalCode must be provided',
    }),
};

export default {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  bulkImportProducts,
  getProductByCode,
}; 