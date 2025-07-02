import Joi from 'joi';
import { objectId } from './custom.validation.js';

const createStore = {
  body: Joi.object().keys({
    storeId: Joi.string().required(),
    storeName: Joi.string().required(),
    city: Joi.string().required(),
    addressLine1: Joi.string().required(),
    addressLine2: Joi.string().optional().default(''),
    storeNumber: Joi.string().required(),
    pincode: Joi.string().pattern(/^\d{6}$/).required(),
    contactPerson: Joi.string().required(),
    contactEmail: Joi.string().email().required(),
    contactPhone: Joi.string().pattern(/^\+?[\d\s\-\(\)]{10,15}$/).required(),
    creditRating: Joi.string().valid('A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F').default('C'),
    isActive: Joi.boolean().default(true),
  }),
};

const getStores = {
  query: Joi.object().keys({
    storeId: Joi.string(),
    storeName: Joi.string(),
    city: Joi.string(),
    contactPerson: Joi.string(),
    contactEmail: Joi.string().email(),
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
      city: Joi.string(),
      addressLine1: Joi.string(),
      addressLine2: Joi.string(),
      storeNumber: Joi.string(),
      pincode: Joi.string().pattern(/^\d{6}$/),
      contactPerson: Joi.string(),
      contactEmail: Joi.string().email(),
      contactPhone: Joi.string().pattern(/^\+?[\d\s\-\(\)]{10,15}$/),
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
        city: Joi.string().required(),
        addressLine1: Joi.string().required(),
        addressLine2: Joi.string().optional().default(''),
        storeNumber: Joi.string().required(),
        pincode: Joi.string().pattern(/^\d{6}$/).required(),
        contactPerson: Joi.string().required(),
        contactEmail: Joi.string().email().required(),
        contactPhone: Joi.string().pattern(/^\+?[\d\s\-\(\)]{10,15}$/).required(),
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