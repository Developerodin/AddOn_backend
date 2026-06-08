import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { yarnPoReturnChallanStatuses } from '../models/yarnReq/yarnPoReturnChallan.model.js';

export const listChallans = {
  query: Joi.object().keys({
    challanNumber: Joi.string().trim(),
    poNumber: Joi.string().trim(),
    purchaseOrder: Joi.string().custom(objectId),
    supplierName: Joi.string().trim(),
    from: Joi.date().iso(),
    to: Joi.date().iso(),
    status: Joi.string().valid(...yarnPoReturnChallanStatuses),
    sortBy: Joi.string(),
    limit: Joi.number().integer().min(1).max(200),
    page: Joi.number().integer().min(1),
  }),
};

export const getChallan = {
  params: Joi.object().keys({
    challanId: Joi.string().custom(objectId).required(),
  }),
};

export const getChallanByNumber = {
  params: Joi.object().keys({
    challanNumber: Joi.string().trim().required(),
  }),
};

export const getChallansByPo = {
  params: Joi.object().keys({
    purchaseOrderId: Joi.string().custom(objectId).required(),
  }),
};

export const patchChallanTransport = {
  params: Joi.object().keys({
    challanId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      vehicleNo: Joi.string().allow('').max(80),
      driverName: Joi.string().allow('').max(120),
      dispatchDate: Joi.date().iso().allow(null, ''),
      transportNotes: Joi.string().allow('').max(2000),
    })
    .unknown(false)
    .default({}),
};
