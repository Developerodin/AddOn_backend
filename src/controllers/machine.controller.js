import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as machineService from '../services/machine.service.js';

const createMachine = catchAsync(async (req, res) => {
  const machine = await machineService.createMachine(req.body);
  res.status(httpStatus.CREATED).send(machine);
});

const getMachines = catchAsync(async (req, res) => {
  const filter = pick(req.query, [
    'machineCode',
    'machineNumber',
    'model',
    'floor',
    'status',
    'assignedSupervisor',
    'needleSize',
    'isActive',
  ]);
  const options = pick(req.query, ['sortBy', 'sortOrder', 'limit', 'page']);
  const result = await machineService.queryMachines(filter, options);
  res.send(result);
});

const getMachine = catchAsync(async (req, res) => {
  const machine = await machineService.getMachineById(req.params.machineId);
  if (!machine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Machine not found');
  }
  res.send(machine);
});

const updateMachine = catchAsync(async (req, res) => {
  const machine = await machineService.updateMachineById(req.params.machineId, req.body);
  res.send(machine);
});

const updateMachineStatus = catchAsync(async (req, res) => {
  const machine = await machineService.updateMachineStatus(req.params.machineId, req.body);
  res.send(machine);
});

const updateMachineMaintenance = catchAsync(async (req, res) => {
  const machine = await machineService.updateMachineMaintenance(req.params.machineId, req.body);
  res.send(machine);
});

const assignSupervisor = catchAsync(async (req, res) => {
  const machine = await machineService.assignSupervisor(req.params.machineId, req.body.assignedSupervisor);
  res.send(machine);
});

const getMachinesByStatus = catchAsync(async (req, res) => {
  const { status } = req.query;
  const filter = pick(req.query, ['floor']);
  const options = pick(req.query, ['sortBy', 'sortOrder', 'limit', 'page']);
  const result = await machineService.getMachinesByStatus(status, { ...options, ...filter });
  res.send(result);
});

const getMachinesByFloor = catchAsync(async (req, res) => {
  const { floor } = req.query;
  const filter = pick(req.query, ['status']);
  const options = pick(req.query, ['sortBy', 'sortOrder', 'limit', 'page']);
  const result = await machineService.getMachinesByFloor(floor, { ...options, ...filter });
  res.send(result);
});

const getMachinesNeedingMaintenance = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['floor']);
  const options = pick(req.query, ['sortBy', 'sortOrder', 'limit', 'page']);
  const result = await machineService.getMachinesNeedingMaintenance({ ...options, ...filter });
  res.send(result);
});

const getMachinesBySupervisor = catchAsync(async (req, res) => {
  const { supervisorId } = req.params;
  const options = pick(req.query, ['sortBy', 'sortOrder', 'limit', 'page']);
  const result = await machineService.getMachinesBySupervisor(supervisorId, options);
  res.send(result);
});

const getMachineStatistics = catchAsync(async (req, res) => {
  const statistics = await machineService.getMachineStatistics();
  res.send(statistics);
});

const deleteMachine = catchAsync(async (req, res) => {
  await machineService.deleteMachineById(req.params.machineId);
  res.status(httpStatus.NO_CONTENT).send();
});

export {
  createMachine,
  getMachines,
  getMachine,
  updateMachine,
  updateMachineStatus,
  updateMachineMaintenance,
  assignSupervisor,
  getMachinesByStatus,
  getMachinesByFloor,
  getMachinesNeedingMaintenance,
  getMachinesBySupervisor,
  getMachineStatistics,
  deleteMachine,
};
