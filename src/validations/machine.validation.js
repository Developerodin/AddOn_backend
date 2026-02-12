import Joi from 'joi';
import { objectId } from './custom.validation.js';

const createMachine = {
  body: Joi.object().keys({
    machineCode: Joi.string().trim().optional(),
    machineNumber: Joi.string().trim().optional(),
    needleSizeConfig: Joi.array()
      .items(
        Joi.object({
          needleSize: Joi.string().trim(),
          cutoffQuantity: Joi.number().min(0).default(0),
        })
      )
      .optional(),
    model: Joi.string().trim().optional(),
    floor: Joi.string().trim().optional(),
    company: Joi.string().trim().optional(),
    machineType: Joi.string().trim().optional(),
    status: Joi.string().valid('Active', 'Under Maintenance', 'Idle').default('Idle'),
    assignedSupervisor: Joi.string().custom(objectId).optional(),
    capacityPerShift: Joi.number().min(0).optional(),
    capacityPerDay: Joi.number().min(0).optional(),
    installationDate: Joi.date().optional(),
    maintenanceRequirement: Joi.string().valid('1 month', '3 months', '6 months', '12 months').optional(),
    lastMaintenanceDate: Joi.date().optional(),
    nextMaintenanceDate: Joi.date().optional(),
    maintenanceNotes: Joi.string().trim().allow('').optional(),
    isActive: Joi.boolean().default(true),
  }),
};

const getMachines = {
  query: Joi.object().keys({
    machineCode: Joi.string(),
    machineNumber: Joi.string(),
    model: Joi.string(),
    floor: Joi.string(),
    company: Joi.string(),
    machineType: Joi.string(),
    status: Joi.string().valid('Active', 'Under Maintenance', 'Idle'),
    assignedSupervisor: Joi.string().custom(objectId),
    needleSizeConfig: Joi.array().items(Joi.object({ needleSize: Joi.string(), cutoffQuantity: Joi.number() })),
    isActive: Joi.boolean(),
    search: Joi.string(),
    sortBy: Joi.string(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getMachine = {
  params: Joi.object().keys({
    machineId: Joi.string().custom(objectId),
  }),
};

const updateMachine = {
  params: Joi.object().keys({
    machineId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      machineCode: Joi.string().trim(),
      machineNumber: Joi.string().trim(),
      needleSizeConfig: Joi.array()
        .items(
          Joi.object({
            needleSize: Joi.string().trim(),
            cutoffQuantity: Joi.number().min(0).default(0),
          })
        ),
      model: Joi.string().trim(),
      floor: Joi.string().trim(),
      company: Joi.string().trim().allow(null),
      machineType: Joi.string().trim().allow(null),
      status: Joi.string().valid('Active', 'Under Maintenance', 'Idle'),
      assignedSupervisor: Joi.string().custom(objectId).allow(null),
      capacityPerShift: Joi.number().min(0).allow(null),
      capacityPerDay: Joi.number().min(0).allow(null),
      installationDate: Joi.date(),
      maintenanceRequirement: Joi.string().valid('1 month', '3 months', '6 months', '12 months'),
      lastMaintenanceDate: Joi.date().allow(null),
      nextMaintenanceDate: Joi.date().allow(null),
      maintenanceNotes: Joi.string().trim().allow(''),
      isActive: Joi.boolean(),
    })
    .min(1),
};

const updateMachineStatus = {
  params: Joi.object().keys({
    machineId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      status: Joi.string().valid('Active', 'Under Maintenance', 'Idle').required(),
      maintenanceNotes: Joi.string().trim().allow('').optional(),
    })
    .min(1),
};

const updateMachineMaintenance = {
  params: Joi.object().keys({
    machineId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      lastMaintenanceDate: Joi.date().required(),
      maintenanceNotes: Joi.string().trim().allow('').optional(),
    })
    .min(1),
};

const assignSupervisor = {
  params: Joi.object().keys({
    machineId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      assignedSupervisor: Joi.string().custom(objectId).required(),
    })
    .min(1),
};

const deleteMachine = {
  params: Joi.object().keys({
    machineId: Joi.string().custom(objectId),
  }),
};

const bulkDeleteMachines = {
  body: Joi.object().keys({
    machineIds: Joi.array().items(Joi.string().custom(objectId)).min(1).required(),
  }),
};

const getMachinesByStatus = {
  query: Joi.object().keys({
    status: Joi.string().valid('Active', 'Under Maintenance', 'Idle').required(),
    floor: Joi.string().optional(),
    sortBy: Joi.string(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getMachinesByFloor = {
  query: Joi.object().keys({
    floor: Joi.string().required(),
    status: Joi.string().valid('Active', 'Under Maintenance', 'Idle').optional(),
    sortBy: Joi.string(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getMachinesNeedingMaintenance = {
  query: Joi.object().keys({
    floor: Joi.string().optional(),
    sortBy: Joi.string(),
    sortOrder: Joi.string().valid('asc', 'desc').default('asc'),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export {
  createMachine,
  getMachines,
  getMachine,
  updateMachine,
  updateMachineStatus,
  updateMachineMaintenance,
  assignSupervisor,
  deleteMachine,
  bulkDeleteMachines,
  getMachinesByStatus,
  getMachinesByFloor,
  getMachinesNeedingMaintenance,
};
