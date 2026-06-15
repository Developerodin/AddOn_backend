import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const listVendorPoReturnChallans = {
  query: Joi.object().keys({
    challanNumber: Joi.string(),
    vpoNumber: Joi.string(),
    vendorPurchaseOrder: Joi.string().custom(objectId),
    vendorName: Joi.string(),
    from: Joi.date().iso(),
    to: Joi.date().iso(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getVendorPoReturnChallan = {
  params: Joi.object().keys({
    challanId: Joi.string().custom(objectId).required(),
  }),
};

export const getVendorPoReturnChallanByNumber = {
  params: Joi.object().keys({
    challanNumber: Joi.string().required(),
  }),
};

export const getVendorPoReturnChallansByVpo = {
  params: Joi.object().keys({
    vpoId: Joi.string().custom(objectId).required(),
  }),
};

export const patchVendorPoReturnChallanTransport = {
  params: Joi.object().keys({
    challanId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      vehicleNo: Joi.string().allow('', null),
      driverName: Joi.string().allow('', null),
      dispatchDate: Joi.date().iso().allow(null),
      transportNotes: Joi.string().allow('', null),
    })
    .min(1),
};
