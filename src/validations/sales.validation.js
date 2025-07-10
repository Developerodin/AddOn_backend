import Joi from 'joi';
import { objectId } from './custom.validation.js';

const createSales = {
  body: Joi.object().keys({
    date: Joi.date().default(Date.now),
    plant: Joi.string().custom(objectId).required(),
    materialCode: Joi.string().custom(objectId).required(),
    quantity: Joi.number().min(0).required(),
    mrp: Joi.number().min(0).required(),
    discount: Joi.number().min(0).default(0),
    gsv: Joi.number().min(0).required(),
    nsv: Joi.number().min(0).required(),
    totalTax: Joi.number().min(0).default(0),
  }),
};

const getSales = {
  query: Joi.object().keys({
    plant: Joi.alternatives().try(Joi.string(), Joi.number()).optional(), // storeId can be string or number
    materialCode: Joi.string().trim(), // styleCode string
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    quantity: Joi.number().min(0),
    mrp: Joi.number().min(0),
    discount: Joi.number().min(0),
    gsv: Joi.number().min(0),
    nsv: Joi.number().min(0),
    totalTax: Joi.number().min(0),
    city: Joi.string().trim(), // Filter by city
    category: Joi.string().custom(objectId), // Filter by category
    sortBy: Joi.string(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    populate: Joi.string(),
  }),
};

const getSalesRecord = {
  params: Joi.object().keys({
    salesId: Joi.string().custom(objectId),
  }),
};

const updateSales = {
  params: Joi.object().keys({
    salesId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      date: Joi.date(),
      plant: Joi.string().custom(objectId),
      materialCode: Joi.string().custom(objectId),
      quantity: Joi.number().min(0),
      mrp: Joi.number().min(0),
      discount: Joi.number().min(0),
      gsv: Joi.number().min(0),
      nsv: Joi.number().min(0),
      totalTax: Joi.number().min(0),
    })
    .min(1),
};

const deleteSales = {
  params: Joi.object().keys({
    salesId: Joi.string().custom(objectId),
  }),
};

const bulkImportSales = {
  body: Joi.object().keys({
    salesRecords: Joi.array().items(
      Joi.object().keys({
        id: Joi.string().custom(objectId).optional(), // For updates
        date: Joi.date().default(Date.now),
        plant: Joi.string().trim().required(), // storeId string
        materialCode: Joi.string().trim().required(), // styleCode string
        quantity: Joi.number().min(0).required(),
        mrp: Joi.number().min(0).required(),
        discount: Joi.number().min(0).default(0),
        gsv: Joi.number().min(0).required(),
        nsv: Joi.number().min(0).required(),
        totalTax: Joi.number().min(0).default(0),
      })
    ).min(1).max(1000), // Limit batch size to 1000 records
    batchSize: Joi.number().integer().min(1).max(100).default(50), // Default batch size
  }),
};

const bulkDeleteSales = {
  body: Joi.object().keys({
    salesIds: Joi.array().items(
      Joi.string().custom(objectId)
    ).min(1).max(1000).required(), // Limit to 1000 records per request
  }),
};

export default {
  createSales,
  getSales,
  getSalesRecord,
  updateSales,
  deleteSales,
  bulkImportSales,
  bulkDeleteSales,
}; 