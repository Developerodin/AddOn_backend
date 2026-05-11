import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { yarnConeIssueStatuses, yarnConeReturnStatuses } from '../models/yarnReq/yarnCone.model.js';

const issueStatusField = Joi.string().valid(...yarnConeIssueStatuses);
const returnStatusField = Joi.string().valid(...yarnConeReturnStatuses);

const userRefSchema = Joi.object()
  .keys({
    username: Joi.string().trim().allow('', null),
    user: Joi.string().custom(objectId).allow(null),
  })
  .optional();

export const createFloorIssueBatch = {
  body: Joi.object()
    .keys({
      floor: Joi.string().valid('linking', 'sampling').required(),
    })
    .required(),
};

export const issueConeForFloor = {
  body: Joi.object()
    .keys({
      barcode: Joi.string().trim().required(),
      floor: Joi.string().valid('linking', 'sampling').required(),
      /** Server-generated batch id from POST /yarn-cones/floor-issue-batch */
      issueBatchId: Joi.string().trim().hex().length(24).required(),
      totalWeight: Joi.number().min(0).required(),
      totalTearWeight: Joi.number().min(0).default(0),
    })
    .required(),
};

export const createYarnCone = {
  body: Joi.object()
    .keys({
      poNumber: Joi.string().trim().required(),
      boxId: Joi.string().trim().required(),
      orderId: Joi.string().custom(objectId).allow(null),
      articleId: Joi.string().custom(objectId).allow(null),
      coneWeight: Joi.number().min(0).allow(null),
      tearWeight: Joi.number().min(0).allow(null),
      yarnName: Joi.string().trim().allow('', null),
      yarnCatalogId: Joi.string().custom(objectId).allow(null),
      yarn: Joi.string().custom(objectId).allow(null),
      shadeCode: Joi.string().trim().allow('', null),
      issueStatus: issueStatusField.default('not_issued'),
      issuedBy: userRefSchema,
      issueDate: Joi.date().iso().allow(null),
      issueWeight: Joi.number().min(0).allow(null),
      returnStatus: returnStatusField.default('not_returned'),
      returnDate: Joi.date().iso().allow(null),
      returnWeight: Joi.number().min(0).allow(null),
      returnBy: userRefSchema,
      coneStorageId: Joi.string().trim().allow('', null),
      barcode: Joi.string().trim().required(),
    })
    .custom((v) => {
      const id = v.yarnCatalogId || v.yarn;
      return id ? { ...v, yarnCatalogId: id } : v;
    })
    .required(),
};

export const updateYarnCone = {
  params: Joi.object().keys({
    yarnConeId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      poNumber: Joi.string().trim(),
      boxId: Joi.string().trim(),
      orderId: Joi.string().custom(objectId),
      articleId: Joi.string().custom(objectId),
      coneWeight: Joi.number().min(0).allow(null),
      tearWeight: Joi.number().min(0).allow(null),
      yarnName: Joi.string().trim().allow('', null),
      yarnCatalogId: Joi.string().custom(objectId).allow(null),
      yarn: Joi.string().custom(objectId).allow(null),
      shadeCode: Joi.string().trim().allow('', null),
      issueStatus: issueStatusField,
      issuedBy: userRefSchema,
      issueDate: Joi.date().iso().allow(null),
      issueWeight: Joi.number().min(0).allow(null),
      returnStatus: returnStatusField,
      returnDate: Joi.date().iso().allow(null),
      returnWeight: Joi.number().min(0).allow(null),
      returnBy: userRefSchema,
      coneStorageId: Joi.string().trim().allow('', null),
      barcode: Joi.string().trim(),
    })
    .min(1)
    .custom((v) => {
      if (v.yarnCatalogId == null && v.yarn != null) return { ...v, yarnCatalogId: v.yarn };
      return v;
    }),
};

export const getConesByStorageLocation = {
  params: Joi.object().keys({
    storageLocation: Joi.string().trim().required(),
  }),
};

export const bulkSetConeStorageLocation = {
  body: Joi.object()
    .keys({
      coneIds: Joi.array().items(Joi.string().trim()).min(1).required(),
      coneStorageId: Joi.string().trim().required(),
    })
    .required(),
};

export const getYarnCones = {
  query: Joi.object().keys({
    po_number: Joi.string().trim().optional(),
    box_id: Joi.string().trim().optional(),
    order_id: Joi.string().custom(objectId).optional(),
    article_id: Joi.string().custom(objectId).optional(),
    issue_status: issueStatusField.optional(),
    return_status: returnStatusField.optional(),
    storage_id: Joi.string().trim().optional(),
    yarn_name: Joi.string().trim().optional(),
    yarn_id: Joi.string().custom(objectId).optional(),
    shade_code: Joi.string().trim().optional(),
    barcode: Joi.string().trim().optional(),
  }),
};

export const getYarnConeByBarcode = {
  params: Joi.object().keys({
    barcode: Joi.string().trim().required(),
  }),
};

export const getShortTermConesByBoxId = {
  params: Joi.object().keys({
    boxId: Joi.string().trim().required(),
  }),
};

export const generateConesByBox = {
  params: Joi.object().keys({
    boxId: Joi.string().trim().required(),
  }),
  body: Joi.object()
    .keys({
      numberOfCones: Joi.number().integer().min(1).optional(),
      coneWeight: Joi.number().min(0).allow(null),
      tearWeight: Joi.number().min(0).allow(null),
      yarnName: Joi.string().trim().allow('', null),
      yarnCatalogId: Joi.string().custom(objectId).allow(null),
      yarn: Joi.string().custom(objectId).allow(null),
      shadeCode: Joi.string().trim().allow('', null),
      coneStorageId: Joi.string().trim().allow('', null),
      issueStatus: issueStatusField,
      issuedBy: userRefSchema,
      issueDate: Joi.date().iso().allow(null),
      issueWeight: Joi.number().min(0).allow(null),
      returnStatus: returnStatusField,
      returnDate: Joi.date().iso().allow(null),
      returnWeight: Joi.number().min(0).allow(null),
      returnBy: userRefSchema,
      coneIssueDate: Joi.date().iso().allow(null),
      coneIssueBy: userRefSchema,
      force: Joi.boolean().default(false),
    })
    .custom((v) => {
      const id = v.yarnCatalogId || v.yarn;
      return id ? { ...v, yarnCatalogId: id } : v;
    })
    .optional(),
};

export const returnYarnCone = {
  params: Joi.object().keys({
    barcode: Joi.string().trim().required(),
  }),
  body: Joi.object()
    .keys({
      returnWeight: Joi.number().min(0).optional(),
      returnBy: userRefSchema.optional(),
      returnDate: Joi.date().iso().optional(),
      coneStorageId: Joi.string().trim().optional(),
    })
    .optional(),
};


