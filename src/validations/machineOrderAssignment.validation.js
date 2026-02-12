import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { OrderStatus } from '../models/production/enums.js';

const productionOrderItemSchema = Joi.object({
  productionOrder: Joi.string().custom(objectId).required(),
  article: Joi.string().custom(objectId).required(),
  status: Joi.string()
    .valid(...Object.values(OrderStatus))
    .default(OrderStatus.PENDING),
  priority: Joi.number().integer().min(1).optional(),
});

const createMachineOrderAssignment = {
  body: Joi.object().keys({
    machine: Joi.string().custom(objectId).required(),
    activeNeedle: Joi.string().trim().required(),
    productionOrderItems: Joi.array().items(productionOrderItemSchema).default([]),
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
      productionOrderItems: Joi.array().items(productionOrderItemSchema),
      addProductionOrderItems: Joi.array().items(productionOrderItemSchema),
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
  resetMachineOrderAssignment,
  deleteMachineOrderAssignment,
  getAssignmentLogs,
  getAssignmentLogsByUser,
};
