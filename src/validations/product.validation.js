import Joi from 'joi';
import { objectId } from './custom.validation.js';

const createProduct = {
  body: Joi.object().keys({
    name: Joi.string(),
    softwareCode: Joi.string(),
    internalCode: Joi.string(),
    vendorCode: Joi.string(),
    factoryCode: Joi.string(),
    knittingCode: Joi.string().optional().allow('').default(''),
    styleCodes: Joi.array().items(Joi.string().custom(objectId)),
    productionType: Joi.string().valid('internal', 'outsourced').default('internal'),
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
    rawMaterials: Joi.array().items(
      Joi.object().keys({
        rawMaterialId: Joi.string().custom(objectId),
        quantity: Joi.number().min(0),
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
    productionType: Joi.string().valid('internal', 'outsourced'),
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
      styleCodes: Joi.array().items(Joi.string().custom(objectId)),
      productionType: Joi.string().valid('internal', 'outsourced'),
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
      rawMaterials: Joi.array().items(
        Joi.object().keys({
          rawMaterialId: Joi.string().custom(objectId),
          quantity: Joi.number().min(0),
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
        id: Joi.string().custom(objectId).optional(),
        name: Joi.string().required(),
        styleCodes: Joi.array().items(Joi.string().custom(objectId)),
        internalCode: Joi.string().optional().default(''),
        vendorCode: Joi.string().optional().default(''),
        factoryCode: Joi.string().optional().default(''),
        knittingCode: Joi.string().optional().default(''),
        description: Joi.string().optional().default(''),
        category: Joi.string().custom(objectId).optional(),
        softwareCode: Joi.string().optional(),
        productionType: Joi.string().valid('internal', 'outsourced').optional(),
        rawMaterials: Joi.array().items(
          Joi.object().keys({
            rawMaterialId: Joi.string().custom(objectId),
            quantity: Joi.number().min(0),
          })
        ),
      })
    ).min(1).max(10000),
    batchSize: Joi.number().integer().min(1).max(100).default(50),
  }),
};

const bulkUpsertProducts = {
  body: Joi.object().keys({
    products: Joi.array().items(
      Joi.object()
        .keys({
          id: Joi.string().custom(objectId).optional(),
          name: Joi.string().required(),
          knittingCode: Joi.string().optional().allow(''),
          factoryCode: Joi.string().optional().allow(''),
          'Knitting Code': Joi.string().optional().allow(''),
          'Factory Code': Joi.string().optional().allow(''),
          Needles: Joi.string().optional().allow(''),
          styleCodeId1: Joi.alternatives().try(Joi.string().custom(objectId), Joi.string()).optional().allow(''),
          styleCodeId2: Joi.alternatives().try(Joi.string().custom(objectId), Joi.string()).optional().allow(''),
          styleCodeId3: Joi.alternatives().try(Joi.string().custom(objectId), Joi.string()).optional().allow(''),
          styleCodeId4: Joi.alternatives().try(Joi.string().custom(objectId), Joi.string()).optional().allow(''),
          styleCodeId5: Joi.alternatives().try(Joi.string().custom(objectId), Joi.string()).optional().allow(''),
          styleCodeId6: Joi.alternatives().try(Joi.string().custom(objectId), Joi.string()).optional().allow(''),
          styleCodeId7: Joi.alternatives().try(Joi.string().custom(objectId), Joi.string()).optional().allow(''),
          styleCodeId8: Joi.alternatives().try(Joi.string().custom(objectId), Joi.string()).optional().allow(''),
          styleCodeId9: Joi.alternatives().try(Joi.string().custom(objectId), Joi.string()).optional().allow(''),
          styleCodeId10: Joi.alternatives().try(Joi.string().custom(objectId), Joi.string()).optional().allow(''),
          description: Joi.string().optional().allow(''),
          category: Joi.string().custom(objectId).optional(),
        })
        .unknown(true)
    ).min(1).max(10000),
    batchSize: Joi.number().integer().min(1).max(100).default(50),
  }),
};

const bulkExportProducts = {
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
    productionType: Joi.string().valid('internal', 'outsourced'),
    sortBy: Joi.string(),
    limit: Joi.number().integer().min(1).max(10000),
    page: Joi.number().integer().min(1),
    search: Joi.string(),
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
  bulkUpsertProducts,
  bulkExportProducts,
  getProductByCode,
}; 