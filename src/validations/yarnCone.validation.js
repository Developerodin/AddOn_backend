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

export const createYarnCone = {
  body: Joi.object()
    .keys({
      poNumber: Joi.string().trim().required(),
      boxId: Joi.string().trim().required(),
      coneWeight: Joi.number().min(0).allow(null),
      tearWeight: Joi.number().min(0).allow(null),
      yarnName: Joi.string().trim().allow('', null),
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
      coneWeight: Joi.number().min(0).allow(null),
      tearWeight: Joi.number().min(0).allow(null),
      yarnName: Joi.string().trim().allow('', null),
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
    .min(1),
};

export const getYarnCones = {
  query: Joi.object().keys({
    po_number: Joi.string().trim().optional(),
    box_id: Joi.string().trim().optional(),
    issue_status: issueStatusField.optional(),
    return_status: returnStatusField.optional(),
    storage_id: Joi.string().trim().optional(),
    yarn_name: Joi.string().trim().optional(),
    yarn_id: Joi.string().custom(objectId).optional(),
    shade_code: Joi.string().trim().optional(),
    barcode: Joi.string().trim().optional(),
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
    .optional(),
};


