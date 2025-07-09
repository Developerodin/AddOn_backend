import Joi from 'joi';
import { objectId } from './custom.validation.js';

const createStore = {
  body: Joi.object().keys({
    storeId: Joi.string().required(),
    storeName: Joi.string().required(),
    bpCode: Joi.string().optional(),
    oldStoreCode: Joi.string().optional(),
    bpName: Joi.string().optional(),
    street: Joi.string().optional(),
    block: Joi.string().optional(),
    city: Joi.string().required(),
    addressLine1: Joi.string().required(),
    addressLine2: Joi.string().optional().default(''),
    zipCode: Joi.string().optional(),
    state: Joi.string().optional(),
    country: Joi.string().optional(),
    storeNumber: Joi.string().required(),
    pincode: Joi.string().pattern(/^\d{6}$/).required(),
    contactPerson: Joi.string().required(),
    contactEmail: Joi.string().email().required(),
    contactPhone: Joi.string().pattern(/^\+?[\d\s\-\(\)]{10,15}$/).required(),
    telephone: Joi.string().pattern(/^\+?[\d\s\-\(\)]{10,15}$/).optional(),
    internalSapCode: Joi.string().optional(),
    internalSoftwareCode: Joi.string().optional(),
    brandGrouping: Joi.string().optional(),
    brand: Joi.string().optional(),
    hankyNorms: Joi.number().min(0).optional(),
    socksNorms: Joi.number().min(0).optional(),
    towelNorms: Joi.number().min(0).optional(),
    totalNorms: Joi.number().min(0).optional(),
    creditRating: Joi.string().valid('A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F').default('C'),
    isActive: Joi.boolean().default(true),
  }),
};

const getStores = {
  query: Joi.object().keys({
    storeId: Joi.string(),
    storeName: Joi.string(),
    bpCode: Joi.string(),
    oldStoreCode: Joi.string(),
    bpName: Joi.string(),
    street: Joi.string(),
    block: Joi.string(),
    city: Joi.string(),
    zipCode: Joi.string(),
    state: Joi.string(),
    country: Joi.string(),
    contactPerson: Joi.string(),
    contactEmail: Joi.string().email(),
    telephone: Joi.string(),
    internalSapCode: Joi.string(),
    internalSoftwareCode: Joi.string(),
    brandGrouping: Joi.string(),
    brand: Joi.string(),
    hankyNorms: Joi.number().min(0),
    socksNorms: Joi.number().min(0),
    towelNorms: Joi.number().min(0),
    totalNorms: Joi.number().min(0),
    creditRating: Joi.string().valid('A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'),
    isActive: Joi.boolean(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    populate: Joi.string(),
  }),
};

const getStore = {
  params: Joi.object().keys({
    storeId: Joi.string().custom(objectId),
  }),
};

const updateStore = {
  params: Joi.object().keys({
    storeId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      storeId: Joi.string(),
      storeName: Joi.string(),
      bpCode: Joi.string(),
      oldStoreCode: Joi.string(),
      bpName: Joi.string(),
      street: Joi.string(),
      block: Joi.string(),
      city: Joi.string(),
      addressLine1: Joi.string(),
      addressLine2: Joi.string(),
      zipCode: Joi.string(),
      state: Joi.string(),
      country: Joi.string(),
      storeNumber: Joi.string(),
      pincode: Joi.string().pattern(/^\d{6}$/),
      contactPerson: Joi.string(),
      contactEmail: Joi.string().email(),
      contactPhone: Joi.string().pattern(/^\+?[\d\s\-\(\)]{10,15}$/),
      telephone: Joi.string().pattern(/^\+?[\d\s\-\(\)]{10,15}$/),
      internalSapCode: Joi.string(),
      internalSoftwareCode: Joi.string(),
      brandGrouping: Joi.string(),
      brand: Joi.string(),
      hankyNorms: Joi.number().min(0),
      socksNorms: Joi.number().min(0),
      towelNorms: Joi.number().min(0),
      totalNorms: Joi.number().min(0),
      creditRating: Joi.string().valid('A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'),
      isActive: Joi.boolean(),
    })
    .min(1),
};

const deleteStore = {
  params: Joi.object().keys({
    storeId: Joi.string().custom(objectId),
  }),
};

const bulkImportStores = {
  body: Joi.object().keys({
    stores: Joi.array().items(
      Joi.object().keys({
        // MongoDB ObjectId for updating existing store
        id: Joi.string().custom(objectId).optional().description('MongoDB ObjectId for updating existing store'),
        
        // Required fields from model
        storeId: Joi.string().required().trim().uppercase().messages({
          'string.empty': 'Store ID is required',
          'any.required': 'Store ID is required'
        }),
        storeName: Joi.string().required().trim().messages({
          'string.empty': 'Store name is required',
          'any.required': 'Store name is required'
        }),
        city: Joi.string().required().trim().messages({
          'string.empty': 'City is required',
          'any.required': 'City is required'
        }),
        addressLine1: Joi.string().required().trim().messages({
          'string.empty': 'Address line 1 is required',
          'any.required': 'Address line 1 is required'
        }),
        storeNumber: Joi.string().required().trim().messages({
          'string.empty': 'Store number is required',
          'any.required': 'Store number is required'
        }),
        pincode: Joi.string().pattern(/^\d{6}$/).required().trim().messages({
          'string.pattern.base': 'Pincode must be exactly 6 digits',
          'string.empty': 'Pincode is required',
          'any.required': 'Pincode is required'
        }),
        contactPerson: Joi.string().required().trim().messages({
          'string.empty': 'Contact person is required',
          'any.required': 'Contact person is required'
        }),
        contactEmail: Joi.string().email().required().trim().lowercase().messages({
          'string.email': 'Contact email must be a valid email address',
          'string.empty': 'Contact email is required',
          'any.required': 'Contact email is required'
        }),
        contactPhone: Joi.string().pattern(/^\+?[\d\s\-\(\)]{10,15}$/).required().trim().messages({
          'string.pattern.base': 'Contact phone must be 10-15 digits with optional +, spaces, dashes, or parentheses',
          'string.empty': 'Contact phone is required',
          'any.required': 'Contact phone is required'
        }),
        creditRating: Joi.string().valid('A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F').default('C').messages({
          'any.only': 'Credit rating must be one of: A+, A, A-, B+, B, B-, C+, C, C-, D, F'
        }),
        
        // Optional fields from model
        bpCode: Joi.string().optional().trim().allow('', null),
        oldStoreCode: Joi.string().optional().trim().allow('', null),
        bpName: Joi.string().optional().trim().allow('', null),
        street: Joi.string().optional().trim().allow('', null),
        block: Joi.string().optional().trim().allow('', null),
        addressLine2: Joi.string().optional().trim().default('').allow('', null),
        zipCode: Joi.string().optional().trim().allow('', null),
        state: Joi.string().optional().trim().allow('', null),
        country: Joi.string().optional().trim().allow('', null),
        telephone: Joi.string().pattern(/^\+?[\d\s\-\(\)]{10,15}$/).optional().trim().allow('', null).messages({
          'string.pattern.base': 'Telephone must be 10-15 digits with optional +, spaces, dashes, or parentheses'
        }),
        internalSapCode: Joi.string().optional().trim().allow('', null),
        internalSoftwareCode: Joi.string().optional().trim().allow('', null),
        brandGrouping: Joi.string().optional().trim().allow('', null),
        brand: Joi.string().optional().trim().allow('', null),
        hankyNorms: Joi.number().min(0).optional().allow(null).messages({
          'number.min': 'Hanky norms must be 0 or greater'
        }),
        socksNorms: Joi.number().min(0).optional().allow(null).messages({
          'number.min': 'Socks norms must be 0 or greater'
        }),
        towelNorms: Joi.number().min(0).optional().allow(null).messages({
          'number.min': 'Towel norms must be 0 or greater'
        }),
        totalNorms: Joi.number().min(0).optional().allow(null).messages({
          'number.min': 'Total norms must be 0 or greater'
        }),
        isActive: Joi.boolean().default(true),
      })
    ).min(1).max(1000).messages({
      'array.min': 'At least one store is required',
      'array.max': 'Maximum 1000 stores allowed per request'
    }),
    batchSize: Joi.number().integer().min(1).max(100).default(50).messages({
      'number.min': 'Batch size must be at least 1',
      'number.max': 'Batch size cannot exceed 100'
    }),
  }),
};

export default {
  createStore,
  getStores,
  getStore,
  updateStore,
  deleteStore,
  bulkImportStores,
}; 