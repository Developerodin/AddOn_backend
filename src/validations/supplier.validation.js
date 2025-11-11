import Joi from 'joi';
import { objectId } from './custom.validation.js';

const yarnDetailsSchema = Joi.object().keys({
  yarnType: Joi.string().custom(objectId).required(),
  yarnsubtype: Joi.string().custom(objectId).allow(null, ''),
  color: Joi.string().custom(objectId).required(),
  shadeNumber: Joi.string().required().trim(),
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

