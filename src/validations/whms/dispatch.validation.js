import Joi from 'joi';
import { objectId } from '../custom.validation.js';

const orderIdParams = Joi.object().keys({
  orderId: Joi.string().custom(objectId).required(),
});

export const setDispatchDetails = {
  params: orderIdParams,
  body: Joi.object()
    .keys({
      courierName: Joi.string().allow('').trim(),
      trackingNumber: Joi.string().allow('').trim(),
      vehicleDetails: Joi.string().allow('').trim(),
      dispatchDate: Joi.date(),
      boxCount: Joi.number().integer().min(0),
      shippingRemarks: Joi.string().allow('').trim().max(1000),
    }),
};

export const dispatchOrder = {
  params: orderIdParams,
  body: Joi.object().keys({
    mode: Joi.string().valid('dispatched', 'partial-dispatched', 'ready-for-pickup').required(),
    remarks: Joi.string().allow('').trim().max(1000),
  }),
};

export const setDeliveryStatus = {
  params: orderIdParams,
  body: Joi.object().keys({
    deliveredDate: Joi.date(),
    remarks: Joi.string().allow('').trim().max(1000),
  }),
};

export const printPayload = {
  params: orderIdParams,
};

export const bulkImportDispatchDetails = {
  body: Joi.object().keys({
    rows: Joi.array()
      .items(
        Joi.object().keys({
          rowNumber: Joi.number().integer().min(1),
          orderNumber: Joi.string().allow('').trim(),
          orderId: Joi.string().allow('').trim(),
          courierName: Joi.string().allow('').trim(),
          trackingNumber: Joi.string().allow('').trim(),
          vehicleDetails: Joi.string().allow('').trim(),
          boxCount: Joi.alternatives().try(Joi.number().integer().min(0), Joi.string().allow('')),
          shippingRemarks: Joi.string().allow('').trim().max(1000),
        })
      )
      .min(1)
      .required(),
  }),
};
