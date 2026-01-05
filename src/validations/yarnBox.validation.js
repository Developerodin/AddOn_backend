import Joi from 'joi';
import { objectId } from './custom.validation.js';

const qcDataSchema = Joi.object()
  .keys({
    user: Joi.string().custom(objectId),
    username: Joi.string().trim().allow('', null),
    date: Joi.date().iso().allow(null),
    remarks: Joi.string().trim().allow('', null),
    status: Joi.string().trim().allow('', null),
    mediaUrl: Joi.object().pattern(Joi.string(), Joi.string().uri()).allow(null),
  })
  .optional();

const coneDataSchema = Joi.object()
  .keys({
    conesIssued: Joi.boolean().optional(),
    coneIssueDate: Joi.date().iso().allow(null),
    coneIssueBy: Joi.object()
      .keys({
        username: Joi.string().trim().allow('', null),
        user: Joi.string().custom(objectId).allow(null),
      })
      .optional(),
    numberOfCones: Joi.number().min(0).allow(null),
  })
  .optional();

export const createYarnBox = {
  body: Joi.object()
    .keys({
      boxId: Joi.string().trim(),
      poNumber: Joi.string().trim().required(),
      receivedDate: Joi.date().iso().required(),
      orderDate: Joi.date().iso().required(),
      yarnName: Joi.string().trim().optional(),
      shadeCode: Joi.string().trim().optional(),
      orderQty: Joi.number().min(0).optional(),
      lotNumber: Joi.string().trim().optional(),
      boxWeight: Joi.number().min(0).optional(),
      barcode: Joi.string().trim().optional(),
      numberOfCones: Joi.number().min(0).optional(),
      tearweight: Joi.number().min(0).optional(),
      qcData: qcDataSchema,
      storageLocation: Joi.string().trim().optional(),
      storedStatus: Joi.boolean().optional(),
      coneData: coneDataSchema,
    })
    .required(),
};

export const getYarnBoxById = {
  params: Joi.object().keys({
    yarnBoxId: Joi.string().custom(objectId).required(),
  }),
};

export const getYarnBoxByBarcode = {
  params: Joi.object().keys({
    barcode: Joi.string().trim().required(),
  }),
};

export const updateYarnBox = {
  params: Joi.object().keys({
    yarnBoxId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      boxId: Joi.string().trim(),
      poNumber: Joi.string().trim(),
      receivedDate: Joi.date().iso().allow(null),
      orderDate: Joi.date().iso().allow(null),
      yarnName: Joi.string().trim().allow('', null),
      shadeCode: Joi.string().trim().allow('', null),
      orderQty: Joi.number().min(0).allow(null),
      lotNumber: Joi.string().trim().allow('', null),
      boxWeight: Joi.number().min(0).allow(null),
      barcode: Joi.string().trim(),
      numberOfCones: Joi.number().min(0).allow(null),
      tearweight: Joi.number().min(0).allow(null),
      qcData: qcDataSchema,
      storageLocation: Joi.string().trim().allow('', null),
      storedStatus: Joi.boolean().allow(null),
      coneData: coneDataSchema,
    })
    .min(1),
};

export const bulkCreateYarnBoxes = {
  body: Joi.object()
    .keys({
      poNumber: Joi.string().trim().required(),
      lotDetails: Joi.array()
        .items(
          Joi.object().keys({
            lotNumber: Joi.string().trim().required(),
            numberOfBoxes: Joi.number().min(1).required(),
          })
        )
        .min(1)
        .required(),
    })
    .required(),
};

export const updateQcStatusByPoNumber = {
  body: Joi.object()
    .keys({
      poNumber: Joi.string().trim().required(),
      status: Joi.string().valid('qc_approved', 'qc_rejected').required(),
      user: Joi.string().custom(objectId).optional(),
      username: Joi.string().trim().optional(),
      date: Joi.date().iso().optional(),
      remarks: Joi.string().trim().allow('', null).optional(),
      mediaUrl: Joi.object().pattern(Joi.string(), Joi.string().uri()).allow(null).optional(),
    })
    .required(),
};

export const getYarnBoxes = {
  query: Joi.object().keys({
    po_number: Joi.string().trim().optional(),
    yarn_name: Joi.string().trim().optional(),
    shade_code: Joi.string().trim().optional(),
    storage_location: Joi.string().trim().optional(),
    cones_issued: Joi.boolean().optional(),
  }),
};


