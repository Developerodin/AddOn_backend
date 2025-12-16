import Joi from 'joi';
import { objectId } from './custom.validation.js';

const createMachine = {
  body: Joi.object().keys({
    machineCode: Joi.string().required().trim(),
    machineNumber: Joi.string().required().trim(),
    needleSize: Joi.string().required().trim(),
    model: Joi.string().required().trim(),
    floor: Joi.string().required().trim(),
    company: Joi.string().trim().optional(),
    machineType: Joi.string().trim().optional(),
    status: Joi.string().valid('Active', 'Under Maintenance', 'Idle').default('Idle'),
    assignedSupervisor: Joi.string().custom(objectId).optional(),
    capacityPerShift: Joi.number().min(0).optional(),
    capacityPerDay: Joi.number().min(0).optional(),
    installationDate: Joi.date().required(),
    maintenanceRequirement: Joi.string().valid('1 month', '3 months', '6 months', '12 months').required(),
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
    needleSize: Joi.string(),
    isActive: Joi.boolean(),
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
      needleSize: Joi.string().trim(),
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
  getMachinesByStatus,
  getMachinesByFloor,
  getMachinesNeedingMaintenance,
};
