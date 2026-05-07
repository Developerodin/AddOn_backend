import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const createYarnCatalog = {
  body: Joi.object().keys({
    yarnName: Joi.string().trim().allow('', null),
    yarnType: Joi.string().custom(objectId).required(),
    yarnSubtype: Joi.string().custom(objectId).allow(null, ''),
    countSize: Joi.string().custom(objectId).required(),
    blend: Joi.string().custom(objectId).required(),
    colorFamily: Joi.string().custom(objectId).allow(null, ''),
    pantonShade: Joi.string().trim().allow('', null),
    pantonName: Joi.string().trim().allow('', null),
    season: Joi.string().trim().allow('', null),
    gst: Joi.number().min(0).max(100).allow(null),
    remark: Joi.string().trim().allow('', null),
    hsnCode: Joi.string().trim().uppercase().allow('', null),
    minQuantity: Joi.number().min(0).allow(null),
    status: Joi.string().valid('active', 'inactive', 'suspended'),
  }),
};

export const getYarnCatalogs = {
  query: Joi.object().keys({
    yarnName: Joi.string(),
    status: Joi.string(),
    yarnType: Joi.string().custom(objectId),
    countSize: Joi.string().custom(objectId),
    blend: Joi.string().custom(objectId),
    colorFamily: Joi.string().custom(objectId),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getYarnCatalog = {
  params: Joi.object().keys({
    yarnCatalogId: Joi.string().custom(objectId).required(),
  }),
};

export const updateYarnCatalog = {
  params: Joi.object().keys({
    yarnCatalogId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      yarnName: Joi.string().trim().allow('', null),
      yarnType: Joi.string().custom(objectId),
      yarnSubtype: Joi.string().custom(objectId).allow(null, ''),
      countSize: Joi.string().custom(objectId),
      blend: Joi.string().custom(objectId),
      colorFamily: Joi.string().custom(objectId).allow(null, ''),
      pantonShade: Joi.string().trim().allow('', null),
      pantonName: Joi.string().trim().allow('', null),
      season: Joi.string().trim().allow('', null),
      gst: Joi.number().min(0).max(100).allow(null),
      remark: Joi.string().trim().allow('', null),
      hsnCode: Joi.string().trim().uppercase().allow('', null),
      minQuantity: Joi.number().min(0).allow(null),
      status: Joi.string().valid('active', 'inactive', 'suspended'),
    })
    .min(1),
};

export const deleteYarnCatalog = {
  params: Joi.object().keys({
    yarnCatalogId: Joi.string().custom(objectId).required(),
  }),
};

export const findDuplicateYarns = {
  query: Joi.object().keys({}),
};

export const mergeYarns = {
  body: Joi.object()
    .keys({
      canonicalId: Joi.string().custom(objectId),
      canonicalName: Joi.string().trim(),
      duplicateIds: Joi.array().items(Joi.string().custom(objectId)).min(1).max(100),
      duplicateNames: Joi.array().items(Joi.string().trim()).min(1).max(100),
      /** When true, duplicateNames not found as YarnCatalog rows are migrated by yarnName anywhere in the system. */
      allowDuplicateNamesNotInCatalog: Joi.boolean().default(false),
      dryRun: Joi.boolean().default(false),
    })
    .or('canonicalId', 'canonicalName')
    .or('duplicateIds', 'duplicateNames')
    .messages({
      'object.missing': 'Provide either canonicalId or canonicalName, and either duplicateIds or duplicateNames',
    }),
};

const mergeItemSchema = Joi.object()
  .keys({
    canonicalId: Joi.string().custom(objectId),
    canonicalName: Joi.string().trim(),
    duplicateIds: Joi.array().items(Joi.string().custom(objectId)).min(1).max(100),
    duplicateNames: Joi.array().items(Joi.string().trim()).min(1).max(100),
    allowDuplicateNamesNotInCatalog: Joi.boolean().default(false),
  })
  .or('canonicalId', 'canonicalName')
  .or('duplicateIds', 'duplicateNames');

export const bulkMergeYarns = {
  body: Joi.object().keys({
    merges: Joi.array().items(mergeItemSchema).min(1).max(200).required().messages({
      'array.min': 'At least one merge entry is required',
      'array.max': 'Maximum 200 merge entries allowed per request',
    }),
    dryRun: Joi.boolean().default(false),
  }),
};

export const bulkImportYarnCatalogs = {
  body: Joi.object().keys({
    yarnCatalogs: Joi.array().items(
      Joi.object().keys({
        id: Joi.string().custom(objectId).optional().description('MongoDB ObjectId for updating existing yarn catalog'),
        yarnName: Joi.string().trim().allow('', null),
        yarnType: Joi.string().custom(objectId).required().messages({
          'string.empty': 'Yarn type is required',
          'any.required': 'Yarn type is required'
        }),
        yarnSubtype: Joi.string().custom(objectId).allow(null, ''),
        countSize: Joi.string().custom(objectId).required().messages({
          'string.empty': 'Count size is required',
          'any.required': 'Count size is required'
        }),
        blend: Joi.string().custom(objectId).required().messages({
          'string.empty': 'Blend is required',
          'any.required': 'Blend is required'
        }),
        colorFamily: Joi.string().custom(objectId).allow(null, ''),
        pantonShade: Joi.string().trim().allow('', null),
        pantonName: Joi.string().trim().allow('', null),
        season: Joi.string().trim().allow('', null),
        gst: Joi.number().min(0).max(100).allow(null),
        remark: Joi.string().trim().allow('', null),
        hsnCode: Joi.string().trim().uppercase().allow('', null),
        minQuantity: Joi.number().min(0).allow(null),
        status: Joi.string().valid('active', 'inactive', 'suspended').default('active'),
      })
    ).min(1).max(1000).messages({
      'array.min': 'At least one yarn catalog is required',
      'array.max': 'Maximum 1000 yarn catalogs allowed per request'
    }),
    batchSize: Joi.number().integer().min(1).max(100).default(50).messages({
      'number.min': 'Batch size must be at least 1',
      'number.max': 'Batch size cannot exceed 100'
    }),
  }),
};

