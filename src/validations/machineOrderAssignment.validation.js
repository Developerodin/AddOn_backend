import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { OrderStatus, YarnIssueStatus, YarnReturnStatus } from '../models/production/enums.js';

const productionOrderItemCreateSchema = Joi.object({
  productionOrder: Joi.string().custom(objectId).required(),
  article: Joi.string().custom(objectId).required(),
  status: Joi.string()
    .valid(...Object.values(OrderStatus))
    .default(OrderStatus.PENDING),
  yarnIssueStatus: Joi.string()
    .valid(...Object.values(YarnIssueStatus))
    .default(YarnIssueStatus.PENDING),
  yarnReturnStatus: Joi.string()
    .valid(...Object.values(YarnReturnStatus))
    .default(YarnReturnStatus.PENDING),
  priority: Joi.number().integer().min(1).optional(),
});

/** PATCH merge: omitting yarn/status fields leaves them untouched in service merge (never inject defaults onto partial updates). */
const productionOrderItemPatchSchema = Joi.object({
  productionOrder: Joi.string().custom(objectId).required(),
  article: Joi.string().custom(objectId).required(),
  status: Joi.string().valid(...Object.values(OrderStatus)),
  yarnIssueStatus: Joi.string().valid(...Object.values(YarnIssueStatus)),
  yarnReturnStatus: Joi.string().valid(...Object.values(YarnReturnStatus)),
  priority: Joi.number().integer().min(1),
});

const createMachineOrderAssignment = {
  body: Joi.object().keys({
    machine: Joi.string().custom(objectId).required(),
    activeNeedle: Joi.string().trim().required(),
    productionOrderItems: Joi.array().items(productionOrderItemCreateSchema).default([]),
    isActive: Joi.boolean().default(true),
  }),
};

const getMachineOrderAssignments = {
  query: Joi.object().keys({
    machine: Joi.string().custom(objectId),
    activeNeedle: Joi.string(),
    isActive: Joi.boolean(),
    sortBy: Joi.string(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getMachineOrderAssignment = {
  params: Joi.object().keys({
    assignmentId: Joi.string().custom(objectId).required(),
  }),
};

const updateMachineOrderAssignment = {
  params: Joi.object().keys({
    assignmentId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      machine: Joi.string().custom(objectId),
      activeNeedle: Joi.string().trim(),
      productionOrderItems: Joi.array().items(productionOrderItemPatchSchema),
      addProductionOrderItems: Joi.array().items(productionOrderItemPatchSchema),
      isActive: Joi.boolean(),
      remarks: Joi.string().allow('').optional(),
    })
    .min(1),
};

/** Single item: body { priority } */
const updateProductionOrderItemPriority = {
  params: Joi.object().keys({
    assignmentId: Joi.string().custom(objectId).required(),
    itemId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      priority: Joi.number().integer().min(1).required(),
    })
    .min(1),
};

/** Single item status: body { status [, yarnIssueStatus ] } - yarnIssueStatus optional, applied first when both sent */
const updateProductionOrderItemStatus = {
  params: Joi.object().keys({
    assignmentId: Joi.string().custom(objectId).required(),
    itemId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      status: Joi.string()
        .valid(...Object.values(OrderStatus))
        .required(),
      yarnIssueStatus: Joi.string()
        .valid(...Object.values(YarnIssueStatus))
        .optional(),
    })
    .min(1),
};

/** Single item yarn issue status: body { yarnIssueStatus } */
const updateProductionOrderItemYarnIssueStatus = {
  params: Joi.object().keys({
    assignmentId: Joi.string().custom(objectId).required(),
    itemId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      yarnIssueStatus: Joi.string()
        .valid(...Object.values(YarnIssueStatus))
        .required(),
    })
    .min(1),
};

/** Delete single production order item: params assignmentId, itemId */
const deleteProductionOrderItem = {
  params: Joi.object().keys({
    assignmentId: Joi.string().custom(objectId).required(),
    itemId: Joi.string().custom(objectId).required(),
  }),
};

/** Single item yarn return status: body { yarnReturnStatus } */
const updateProductionOrderItemYarnReturnStatus = {
  params: Joi.object().keys({
    assignmentId: Joi.string().custom(objectId).required(),
    itemId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      yarnReturnStatus: Joi.string()
        .valid(...Object.values(YarnReturnStatus))
        .required(),
    })
    .min(1),
};

/** Multiple items: body { items: [{ itemId, priority }, ...] } */
const updateProductionOrderItemPriorities = {
  params: Joi.object().keys({
    assignmentId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      items: Joi.array()
        .items(
          Joi.object().keys({
            itemId: Joi.string().custom(objectId).required(),
            priority: Joi.number().integer().min(1).required(),
          })
        )
        .min(1)
        .required(),
    })
    .required(),
};

const resetMachineOrderAssignment = {
  params: Joi.object().keys({
    assignmentId: Joi.string().custom(objectId).required(),
  }),
};

const deleteMachineOrderAssignment = {
  params: Joi.object().keys({
    assignmentId: Joi.string().custom(objectId).required(),
  }),
};

const getAssignmentLogs = {
  params: Joi.object().keys({
    assignmentId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    action: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getAssignmentLogsByUser = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
    action: Joi.string(),
    assignmentId: Joi.string().custom(objectId),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export {
  createMachineOrderAssignment,
  getMachineOrderAssignments,
  getMachineOrderAssignment,
  updateMachineOrderAssignment,
  updateProductionOrderItemPriority,
  updateProductionOrderItemPriorities,
  updateProductionOrderItemStatus,
  updateProductionOrderItemYarnIssueStatus,
  updateProductionOrderItemYarnReturnStatus,
  deleteProductionOrderItem,
  resetMachineOrderAssignment,
  deleteMachineOrderAssignment,
  getAssignmentLogs,
  getAssignmentLogsByUser,
};
