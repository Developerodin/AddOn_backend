import Joi from 'joi';
import { objectId } from './custom.validation.js';

const yarnDetailsSchema = Joi.object().keys({
  yarnName: Joi.string().trim().allow('', null),
  yarnType: Joi.string().custom(objectId).when('yarnName', {
    is: Joi.string().min(1),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  yarnsubtype: Joi.string().custom(objectId).allow(null, ''),
  color: Joi.string().custom(objectId).required(),
  shadeNumber: Joi.string().allow('', null).trim(),
  tearweight: Joi.number().required(),
}).or('yarnName', 'yarnType').messages({
  'object.missing': 'Either yarnName or yarnType must be provided',
});

export const createSupplier = {
  body: Joi.object().keys({
    brandName: Joi.string().required().trim(),
    contactPersonName: Joi.string().required().trim(),
    contactNumber: Joi.string()
      .required()
      .pattern(/^\+?[\d\s\-\(\)]{10,15}$/)
      .messages({
        'string.pattern.base': 'Invalid contact number format',
      }),
    email: Joi.string().required().email().trim().lowercase(),
    address: Joi.string().required().trim(),
    city: Joi.string().required().trim(),
    state: Joi.string().required().trim(),
    pincode: Joi.string()
      .required()
      .pattern(/^[0-9]{6}$/)
      .messages({
        'string.pattern.base': 'Invalid pincode format. Must be 6 digits',
      }),
    country: Joi.string().required().trim(),
    gstNo: Joi.string()
      .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
      .uppercase()
      .allow('', null)
      .messages({
        'string.pattern.base': 'Invalid GST number format',
      }),
    yarnDetails: Joi.array().items(yarnDetailsSchema),
    status: Joi.string().valid('active', 'inactive', 'suspended'),
  }),
};

export const getSuppliers = {
  query: Joi.object().keys({
    brandName: Joi.string(),
    email: Joi.string(),
    status: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getSupplier = {
  params: Joi.object().keys({
    supplierId: Joi.string().custom(objectId).required(),
  }),
};

/** GET supplier yarn tearweight: query yarnName (string or array) */
export const getSupplierYarnTearweight = {
  params: Joi.object().keys({
    supplierId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    yarnName: Joi.alternatives()
      .try(Joi.string().trim().min(1), Joi.array().items(Joi.string().trim().min(1)).min(1))
      .required()
      .messages({ 'any.required': 'At least one yarnName is required' }),
  }),
};

export const updateSupplier = {
  params: Joi.object().keys({
    supplierId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      brandName: Joi.string().trim(),
      contactPersonName: Joi.string().trim(),
      contactNumber: Joi.string()
        .pattern(/^\+?[\d\s\-\(\)]{10,15}$/)
        .messages({
          'string.pattern.base': 'Invalid contact number format',
        }),
      email: Joi.string().email().trim().lowercase(),
      address: Joi.string().trim(),
      city: Joi.string().trim(),
      state: Joi.string().trim(),
      pincode: Joi.string()
        .pattern(/^[0-9]{6}$/)
        .messages({
          'string.pattern.base': 'Invalid pincode format. Must be 6 digits',
        }),
      country: Joi.string().trim(),
      gstNo: Joi.string()
        .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
        .uppercase()
        .allow('', null)
        .messages({
          'string.pattern.base': 'Invalid GST number format',
        }),
      yarnDetails: Joi.array().items(yarnDetailsSchema),
      status: Joi.string().valid('active', 'inactive', 'suspended'),
    })
    .min(1),
};

export const deleteSupplier = {
  params: Joi.object().keys({
    supplierId: Joi.string().custom(objectId).required(),
  }),
};

export const bulkImportSuppliers = {
  body: Joi.object().keys({
    suppliers: Joi.array().items(
      Joi.object().keys({
        id: Joi.string().custom(objectId).optional().description('MongoDB ObjectId for updating existing supplier'),
        brandName: Joi.string().required().trim(),
        contactPersonName: Joi.string().required().trim(),
        contactNumber: Joi.string()
          .required()
          .pattern(/^\+?[\d\s\-\(\)]{10,15}$/)
          .messages({
            'string.pattern.base': 'Invalid contact number format',
          }),
        email: Joi.string().required().email().trim().lowercase(),
        address: Joi.string().required().trim(),
        city: Joi.string().required().trim(),
        state: Joi.string().required().trim(),
        pincode: Joi.string()
          .required()
          .pattern(/^[0-9]{6}$/)
          .messages({
            'string.pattern.base': 'Invalid pincode format. Must be 6 digits',
          }),
        country: Joi.string().required().trim(),
        gstNo: Joi.string()
          .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
          .uppercase()
          .allow('', null)
          .messages({
            'string.pattern.base': 'Invalid GST number format',
          }),
        yarnDetails: Joi.array().items(yarnDetailsSchema),
        status: Joi.string().valid('active', 'inactive', 'suspended').default('active'),
      })
    ).min(1).max(1000).messages({
      'array.min': 'At least one supplier is required',
      'array.max': 'Maximum 1000 suppliers allowed per request'
    }),
    batchSize: Joi.number().integer().min(1).max(100).default(50).messages({
      'number.min': 'Batch size must be at least 1',
      'number.max': 'Batch size cannot exceed 100'
    }),
  }),
};

