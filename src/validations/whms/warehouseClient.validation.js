import Joi from 'joi';
import { objectId } from '../custom.validation.js';

const clientTypes = ['Store', 'Trade', 'Departmental', 'Ecom'];
const statusValues = ['active', 'inactive'];

const storeProfileSchema = Joi.object().keys({
  billCode: Joi.string().allow('').trim(),
  sapCode: Joi.string().allow('').trim(),
  retekCode: Joi.string().allow('').trim(),
  classification: Joi.string().allow('').trim(),
  city: Joi.string().allow('').trim(),
  state: Joi.string().allow('').trim(),
  brand: Joi.string().allow('').trim(),
  brandSub: Joi.string().allow('').trim(),
  openingDate: Joi.date().allow(null),
  address: Joi.string().allow('').trim(),
  gst: Joi.string().allow('').trim(),
  storeLandlineNo: Joi.string().allow('').trim(),
  smNameAndContact: Joi.string().allow('').trim(),
  storeMailId: Joi.string().allow('').trim(),
});

const sharedFields = {
  slNo: Joi.number().integer().min(0).allow(null),
  distributorName: Joi.string().allow('').trim(),
  parentKeyCode: Joi.string().allow('').trim(),
  retailerName: Joi.string().allow('').trim(),
  contactPerson: Joi.string().allow('').trim(),
  mobilePhone: Joi.string().allow('').trim(),
  address: Joi.string().allow('').trim(),
  locality: Joi.string().allow('').trim(),
  city: Joi.string().allow('').trim(),
  zipCode: Joi.string().allow('').trim(),
  state: Joi.string().allow('').trim(),
  gstin: Joi.string().allow('').trim(),
  email: Joi.string().allow('').trim(),
  phone1: Joi.string().allow('').trim(),
  rsm: Joi.string().allow('').trim(),
  asm: Joi.string().allow('').trim(),
  se: Joi.string().allow('').trim(),
  dso: Joi.string().allow('').trim(),
  outlet: Joi.string().allow('').trim(),
  storeProfile: storeProfileSchema,
  status: Joi.string().valid(...statusValues),
  remarks: Joi.string().allow('').trim(),
};

export const createWarehouseClient = {
  body: Joi.object().keys({
    ...sharedFields,
    type: Joi.string()
      .valid(...clientTypes)
      .required(),
  }),
};

export const getWarehouseClients = {
  query: Joi.object().keys({
    type: Joi.string().valid(...clientTypes),
    status: Joi.string().valid(...statusValues),
    city: Joi.string().trim(),
    state: Joi.string().trim(),
    parentKeyCode: Joi.string().trim(),
    search: Joi.string().trim(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getWarehouseClient = {
  params: Joi.object().keys({
    clientId: Joi.string().custom(objectId).required(),
  }),
};

export const updateWarehouseClient = {
  params: Joi.object().keys({
    clientId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      ...sharedFields,
      type: Joi.string().valid(...clientTypes),
    })
    .min(1),
};

export const deleteWarehouseClient = {
  params: Joi.object().keys({
    clientId: Joi.string().custom(objectId).required(),
  }),
};
