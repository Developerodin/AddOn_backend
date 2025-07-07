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
        id: Joi.string().custom(objectId).optional(), // For updates
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
        creditRating: Joi.string().valid('A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F').default('C'),
        isActive: Joi.boolean().default(true),
      })
    ).min(1).max(1000), // Limit batch size to 1000 stores
    batchSize: Joi.number().integer().min(1).max(100).default(50), // Default batch size
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