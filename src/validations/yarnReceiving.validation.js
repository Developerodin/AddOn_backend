import Joi from 'joi';
import { objectId } from './custom.validation.js';

const packingSchema = Joi.object().keys({
  packingNumber: Joi.string().trim().allow('', null),
  courierName: Joi.string().trim().allow('', null),
  courierNumber: Joi.string().trim().allow('', null),
  vehicleNumber: Joi.string().trim().allow('', null),
  challanNumber: Joi.string().trim().allow('', null),
  dispatchDate: Joi.date().iso().allow(null),
  estimatedDeliveryDate: Joi.date().iso().allow(null),
  notes: Joi.string().trim().allow('', null),
});

const poItemReceivedSchema = Joi.object().keys({
  poItem: Joi.string().custom(objectId).required(),
  receivedQuantity: Joi.number().min(0).required(),
});

const boxUpdateSchema = Joi.object().keys({
  yarnName: Joi.string().trim().allow('', null),
  shadeCode: Joi.string().trim().allow('', null),
  boxWeight: Joi.number().min(0).allow(null),
  numberOfCones: Joi.number().min(0).allow(null),
});

const lotSchema = Joi.object().keys({
  lotNumber: Joi.string().trim().required(),
  numberOfCones: Joi.number().min(0).allow(null),
  totalWeight: Joi.number().min(0).allow(null),
  numberOfBoxes: Joi.number().min(1).allow(null),
  poItems: Joi.array().items(poItemReceivedSchema).default([]),
  boxUpdates: Joi.array().items(boxUpdateSchema).default([]),
});

const itemSchema = Joi.object().keys({
  poNumber: Joi.string().trim().required(),
  packing: packingSchema.default({}),
  lots: Joi.array().items(lotSchema).min(1).required(),
  notes: Joi.string().trim().allow('', null),
});

const packListDetailsSchema = Joi.array()
  .items(
    Joi.object().keys({
      poItems: Joi.array().items(Joi.string().custom(objectId)).default([]),
      packingNumber: Joi.string().trim().allow('', null),
      courierName: Joi.string().trim().allow('', null),
      courierNumber: Joi.string().trim().allow('', null),
      vehicleNumber: Joi.string().trim().allow('', null),
      challanNumber: Joi.string().trim().allow('', null),
      dispatchDate: Joi.date().iso().allow(null),
      estimatedDeliveryDate: Joi.date().iso().allow(null),
      notes: Joi.string().trim().allow('', null),
      totalWeight: Joi.number().min(0).allow(null),
      numberOfBoxes: Joi.number().min(0).allow(null),
      files: Joi.array().default([]),
    })
  )
  .allow(null);

const receivedLotDetailsSchema = Joi.array()
  .items(
    Joi.object().keys({
      lotNumber: Joi.string().trim().required(),
      numberOfCones: Joi.number().min(0).allow(null),
      totalWeight: Joi.number().min(0).allow(null),
      numberOfBoxes: Joi.number().min(1).allow(null),
      poItems: Joi.array()
        .items(
          Joi.object().keys({
            poItem: Joi.alternatives().try(Joi.string().custom(objectId), Joi.object()).required(),
            receivedQuantity: Joi.number().min(0).required(),
          })
        )
        .default([]),
      status: Joi.string().trim().allow('', null),
    })
  )
  .allow(null);

export const processFromExistingPo = {
  params: Joi.object()
    .keys({
      purchaseOrderId: Joi.string().custom(objectId).required(),
    })
    .required(),
  body: Joi.object()
    .keys({
      packListDetails: packListDetailsSchema,
      receivedLotDetails: receivedLotDetailsSchema,
      notes: Joi.string().trim().allow('', null),
      autoApproveQc: Joi.boolean().default(true),
    })
    .default({}),
};

export const processReceiving = {
  body: Joi.object()
    .keys({
      items: Joi.array().items(itemSchema).min(1).required(),
      notes: Joi.string().trim().allow('', null),
      autoApproveQc: Joi.boolean().default(true),
    })
    .required(),
};

export const processReceivingStepByStep = {
  body: Joi.object()
    .keys({
      step: Joi.number().integer().min(1).max(7).required(),
      poNumber: Joi.string().trim().required(),
      packing: packingSchema.optional(),
      lots: Joi.array().items(lotSchema).optional(),
      lotNumber: Joi.string().trim().optional(),
      updated_by: Joi.object()
        .keys({
          username: Joi.string().trim().required(),
          user_id: Joi.string().custom(objectId).required(),
        })
        .optional(),
      notes: Joi.string().trim().allow('', null).optional(),
      qcData: Joi.object()
        .keys({
          remarks: Joi.string().trim().allow('', null),
          mediaUrl: Joi.object().pattern(Joi.string(), Joi.string()).allow(null),
        })
        .optional(),
    })
    .custom((value, helpers) => {
      const { step, packing, lots, lotNumber } = value;
      
      // Step 1 requires packing and lots
      if (step === 1 && (!packing || !lots || lots.length === 0)) {
        return helpers.error('any.custom', { message: 'Step 1 requires packing and lots' });
      }
      
      // Step 2 requires lots
      if (step === 2 && (!lots || lots.length === 0)) {
        return helpers.error('any.custom', { message: 'Step 2 requires lots' });
      }
      
      // Step 3 requires lots
      if (step === 3 && (!lots || lots.length === 0)) {
        return helpers.error('any.custom', { message: 'Step 3 requires lots' });
      }
      
      // Step 4 requires lots
      if (step === 4 && (!lots || lots.length === 0)) {
        return helpers.error('any.custom', { message: 'Step 4 requires lots' });
      }
      
      // Step 5 requires lotNumber
      if (step === 5 && !lotNumber) {
        return helpers.error('any.custom', { message: 'Step 5 requires lotNumber' });
      }
      
      // Step 7 requires lotNumber
      if (step === 7 && !lotNumber) {
        return helpers.error('any.custom', { message: 'Step 7 requires lotNumber' });
      }
      
      return value;
    }, 'step validation')
    .required(),
};

export const processReceivingStep = {
  params: Joi.object()
    .keys({
      stepNumber: Joi.number().integer().min(1).max(7).required(),
    })
    .required(),
  body: Joi.object()
    .keys({
      poNumber: Joi.string().trim().required(),
      packing: packingSchema.optional(),
      lots: Joi.array().items(lotSchema).optional(),
      lotNumber: Joi.string().trim().optional(),
      updated_by: Joi.object()
        .keys({
          username: Joi.string().trim().required(),
          user_id: Joi.string().custom(objectId).required(),
        })
        .optional(),
      notes: Joi.string().trim().allow('', null).optional(),
      qcData: Joi.object()
        .keys({
          remarks: Joi.string().trim().allow('', null),
          mediaUrl: Joi.object().pattern(Joi.string(), Joi.string()).allow(null),
        })
        .optional(),
    })
    .custom((value, helpers) => {
      const step = Number(helpers.state.ancestors[0]?.params?.stepNumber);
      const { packing, lots, lotNumber } = value;
      
      // Step 1 requires packing and lots
      if (step === 1 && (!packing || !lots || lots.length === 0)) {
        return helpers.error('any.custom', { message: 'Step 1 requires packing and lots' });
      }
      
      // Step 2 requires lots
      if (step === 2 && (!lots || lots.length === 0)) {
        return helpers.error('any.custom', { message: 'Step 2 requires lots' });
      }
      
      // Step 3 requires lots
      if (step === 3 && (!lots || lots.length === 0)) {
        return helpers.error('any.custom', { message: 'Step 3 requires lots' });
      }
      
      // Step 4 requires lots
      if (step === 4 && (!lots || lots.length === 0)) {
        return helpers.error('any.custom', { message: 'Step 4 requires lots' });
      }
      
      // Step 5 requires lotNumber
      if (step === 5 && !lotNumber) {
        return helpers.error('any.custom', { message: 'Step 5 requires lotNumber' });
      }
      
      // Step 7 requires lotNumber
      if (step === 7 && !lotNumber) {
        return helpers.error('any.custom', { message: 'Step 7 requires lotNumber' });
      }
      
      return value;
    }, 'step validation')
    .required(),
};
