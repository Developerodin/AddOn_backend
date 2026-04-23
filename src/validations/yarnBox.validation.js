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
      yarnCatalogId: Joi.string().custom(objectId).optional(),
      shadeCode: Joi.string().trim().optional(),
      orderQty: Joi.number().min(0).optional(),
      lotNumber: Joi.string().trim().optional(),
      boxWeight: Joi.number().min(0).optional(),
      grossWeight: Joi.number().min(0).optional(),
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
      yarnCatalogId: Joi.string().custom(objectId).allow(null),
      shadeCode: Joi.string().trim().allow('', null),
      orderQty: Joi.number().min(0).allow(null),
      lotNumber: Joi.string().trim().allow('', null),
      boxWeight: Joi.number().min(0).allow(null),
      grossWeight: Joi.number().min(0).allow(null),
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

/** Bulk match boxes by (lotNumber, poNumber, yarnName, shadeCode, boxWeight, numberOfCones) and update barcode + boxId */
export const bulkMatchUpdateYarnBoxes = {
  body: Joi.object()
    .keys({
      items: Joi.array()
        .items(
          Joi.object()
            .keys({
              lotNumber: Joi.string().trim().required(),
              poNumber: Joi.string().trim().required(),
              yarnName: Joi.string().trim().required(),
              shadeCode: Joi.string().trim().required(),
              boxWeight: Joi.number().min(0).required(),
              numberOfCones: Joi.number().min(0).required(),
              barcode: Joi.string().trim().required(),
              boxId: Joi.string().trim().required(),
            })
            .required()
        )
        .min(1)
        .required(),
    })
    .required(),
};

export const getBoxesByStorageLocation = {
  params: Joi.object().keys({
    storageLocation: Joi.string().trim().required(),
  }),
};

export const bulkSetBoxStorageLocation = {
  body: Joi.object()
    .keys({
      boxIds: Joi.array().items(Joi.string().trim()).min(1).required(),
      storageLocation: Joi.string().trim().required(),
    })
    .required(),
};

export const resetBoxesWeightToZeroIfStConesPresent = {
  body: Joi.object()
    .keys({
      poNumber: Joi.string().trim().required(),
      dryRun: Joi.boolean().default(false),
    })
    .required(),
};

export const backfillLtBoxWeightFromStCones = {
  body: Joi.object()
    .keys({
      dryRun: Joi.boolean().default(false),
      limit: Joi.number().integer().min(1).max(50000).optional().options({ convert: true }),
      onlyBoxId: Joi.string().trim().optional(),
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
    stored_status: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false')).optional(),
    /** When true, returns boxes hidden by the default active filter; each row includes `isActiveForProcessing`. */
    include_inactive: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false')).optional(),
    limit: Joi.number().integer().min(1).max(10000).optional().options({ convert: true }),
  }),
};


