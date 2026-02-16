import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const createVendor = {
  body: Joi.object().keys({
    vendorName: Joi.string().required().trim(),
    vendorCode: Joi.string().trim().uppercase(),
    contactPerson: Joi.string().trim(),
    phone: Joi.string()
      .required()
      .pattern(/^\+?[\d\s\-\(\)]{10,15}$/)
      .messages({
        'string.pattern.base': 'Invalid phone number format',
      }),
    email: Joi.string().email().trim().lowercase().allow('', null),
    address: Joi.string().trim(),
    gstin: Joi.string()
      .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
      .uppercase()
      .allow('', null)
      .messages({
        'string.pattern.base': 'Invalid GSTIN format',
      }),
    remarks: Joi.string().trim().allow('', null),
    status: Joi.string().valid('active', 'inactive').insensitive(),
  }),
};

export const getVendors = {
  query: Joi.object().keys({
    vendorName: Joi.string(),
    vendorCode: Joi.string(),
    contactPerson: Joi.string(),
    phone: Joi.string(),
    email: Joi.string(),
    status: Joi.string(),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getVendor = {
  params: Joi.object().keys({
    vendorId: Joi.string().custom(objectId).required(),
  }),
};

export const updateVendor = {
  params: Joi.object().keys({
    vendorId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      vendorName: Joi.string().trim(),
      vendorCode: Joi.string().trim().uppercase(),
      contactPerson: Joi.string().trim(),
      phone: Joi.string()
        .pattern(/^\+?[\d\s\-\(\)]{10,15}$/)
        .messages({
          'string.pattern.base': 'Invalid phone number format',
        }),
      email: Joi.string().email().trim().lowercase().allow('', null),
      address: Joi.string().trim(),
      gstin: Joi.string()
        .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
        .uppercase()
        .allow('', null)
        .messages({
          'string.pattern.base': 'Invalid GSTIN format',
        }),
      remarks: Joi.string().trim().allow('', null),
      status: Joi.string().valid('active', 'inactive').insensitive(),
    })
    .min(1),
};

export const deleteVendor = {
  params: Joi.object().keys({
    vendorId: Joi.string().custom(objectId).required(),
  }),
};
