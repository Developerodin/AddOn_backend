import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import Machine from '../models/machine.model.js';

/**
 * Create a machine
 * @param {Object} machineBody
 * @returns {Promise<Machine>}
 */
const createMachine = async (machineBody) => {
  if (await Machine.isMachineCodeTaken(machineBody.machineCode)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Machine code already taken');
  }
  
  if (await Machine.isMachineNumberTaken(machineBody.machineNumber)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Machine number already taken');
  }

  // Calculate next maintenance date if last maintenance date is provided
  if (machineBody.lastMaintenanceDate && machineBody.maintenanceRequirement) {
    const machine = new Machine(machineBody);
    machineBody.nextMaintenanceDate = machine.calculateNextMaintenanceDate(
      machineBody.lastMaintenanceDate,
      machineBody.maintenanceRequirement
    );
  }

  return Machine.create(machineBody);
};

/**
 * Query for machines
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryMachines = async (filter, options) => {
  const machines = await Machine.paginate(filter, options);
  return machines;
};

/**
 * Get machine by id
 * @param {ObjectId} id
 * @returns {Promise<Machine>}
 */
const getMachineById = async (id) => {
  return Machine.findById(id).populate('assignedSupervisor', 'name email role');
};

/**
 * Get machine by machine code
 * @param {string} machineCode
 * @returns {Promise<Machine>}
 */
const getMachineByCode = async (machineCode) => {
  return Machine.findOne({ machineCode }).populate('assignedSupervisor', 'name email role');
};

/**
 * Get machine by machine number
 * @param {string} machineNumber
 * @returns {Promise<Machine>}
 */
const getMachineByNumber = async (machineNumber) => {
  return Machine.findOne({ machineNumber }).populate('assignedSupervisor', 'name email role');
};

/**
 * Update machine by id
 * @param {ObjectId} machineId
 * @param {Object} updateBody
 * @returns {Promise<Machine>}
 */
const updateMachineById = async (machineId, updateBody) => {
  const machine = await getMachineById(machineId);
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }
  
  if (updateBody.machineCode && (await Machine.isMachineCodeTaken(updateBody.machineCode, machineId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Machine code already taken');
  }
  
  if (updateBody.machineNumber && (await Machine.isMachineNumberTaken(updateBody.machineNumber, machineId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Machine number already taken');
  }

  // Recalculate next maintenance date if maintenance details are updated
  if (updateBody.lastMaintenanceDate && updateBody.maintenanceRequirement) {
    updateBody.nextMaintenanceDate = machine.calculateNextMaintenanceDate(
      updateBody.lastMaintenanceDate,
      updateBody.maintenanceRequirement
    );
  } else if (updateBody.lastMaintenanceDate && machine.maintenanceRequirement) {
    updateBody.nextMaintenanceDate = machine.calculateNextMaintenanceDate(
      updateBody.lastMaintenanceDate,
      machine.maintenanceRequirement
    );
  } else if (updateBody.maintenanceRequirement && machine.lastMaintenanceDate) {
    updateBody.nextMaintenanceDate = machine.calculateNextMaintenanceDate(
      machine.lastMaintenanceDate,
      updateBody.maintenanceRequirement
    );
  }

  Object.assign(machine, updateBody);
  await machine.save();
  return machine;
};

/**
 * Update machine status
 * @param {ObjectId} machineId
 * @param {Object} statusBody
 * @returns {Promise<Machine>}
 */
const updateMachineStatus = async (machineId, statusBody) => {
  const machine = await getMachineById(machineId);
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }

  Object.assign(machine, statusBody);
  await machine.save();
  return machine;
};

/**
 * Update machine maintenance
 * @param {ObjectId} machineId
 * @param {Object} maintenanceBody
 * @returns {Promise<Machine>}
 */
const updateMachineMaintenance = async (machineId, maintenanceBody) => {
  const machine = await getMachineById(machineId);
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }

  // Calculate next maintenance date
  const nextMaintenanceDate = machine.calculateNextMaintenanceDate(
    maintenanceBody.lastMaintenanceDate,
    machine.maintenanceRequirement
  );

  Object.assign(machine, {
    ...maintenanceBody,
    nextMaintenanceDate,
  });
  await machine.save();
  return machine;
};

/**
 * Assign supervisor to machine
 * @param {ObjectId} machineId
 * @param {ObjectId} supervisorId
 * @returns {Promise<Machine>}
 */
const assignSupervisor = async (machineId, supervisorId) => {
  const machine = await getMachineById(machineId);
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }

  machine.assignedSupervisor = supervisorId;
  await machine.save();
  return machine;
};

/**
 * Get machines by status
 * @param {string} status
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
const getMachinesByStatus = async (status, options = {}) => {
  const filter = { status, isActive: true };
  return Machine.paginate(filter, options);
};

/**
 * Get machines by floor
 * @param {string} floor
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
const getMachinesByFloor = async (floor, options = {}) => {
  const filter = { floor, isActive: true };
  return Machine.paginate(filter, options);
};

/**
 * Get machines needing maintenance
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
const getMachinesNeedingMaintenance = async (options = {}) => {
  const filter = {
    isActive: true,
    nextMaintenanceDate: { $lte: new Date() },
  };
  return Machine.paginate(filter, options);
};

/**
 * Get machines by supervisor
 * @param {ObjectId} supervisorId
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
const getMachinesBySupervisor = async (supervisorId, options = {}) => {
  const filter = { assignedSupervisor: supervisorId, isActive: true };
  return Machine.paginate(filter, options);
};

/**
 * Get machine statistics
 * @returns {Promise<Object>}
 */
const getMachineStatistics = async () => {
  const totalMachines = await Machine.countDocuments({ isActive: true });
  const activeMachines = await Machine.countDocuments({ status: 'Active', isActive: true });
  const maintenanceMachines = await Machine.countDocuments({ status: 'Under Maintenance', isActive: true });
  const idleMachines = await Machine.countDocuments({ status: 'Idle', isActive: true });
  const maintenanceDue = await Machine.countDocuments({
    isActive: true,
    nextMaintenanceDate: { $lte: new Date() },
  });

  return {
    totalMachines,
    activeMachines,
    maintenanceMachines,
    idleMachines,
    maintenanceDue,
  };
};

/**
 * Delete machine by id
 * @param {ObjectId} machineId
 * @returns {Promise<Machine>}
 */
const deleteMachineById = async (machineId) => {
  const machine = await getMachineById(machineId);
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }
  
  // Soft delete by setting isActive to false
  machine.isActive = false;
  await machine.save();
  return machine;
};

export {
  createMachine,
  queryMachines,
  getMachineById,
  getMachineByCode,
  getMachineByNumber,
  updateMachineById,
  updateMachineStatus,
  updateMachineMaintenance,
  assignSupervisor,
  getMachinesByStatus,
  getMachinesByFloor,
  getMachinesNeedingMaintenance,
  getMachinesBySupervisor,
  getMachineStatistics,
  deleteMachineById,
};
