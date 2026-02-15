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
    'company',
    'machineType',
    'status',
    'assignedSupervisor',
    'needleSizeConfig',
    'isActive',
  ]);
  const options = pick(req.query, ['sortBy', 'sortOrder', 'limit', 'page', 'search']);
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

const getMachineUsageAnalytics = catchAsync(async (req, res) => {
  const { machineId } = req.params;
  const { startDate, endDate, period } = req.query;
  const analytics = await machineService.getMachineUsageAnalytics(machineId, { startDate, endDate, period });
  res.send(analytics);
});

const getMachineCurrentStatus = catchAsync(async (req, res) => {
  const { machineId } = req.params;
  const status = await machineService.getMachineCurrentStatus(machineId);
  res.send(status);
});

const getMachineWorkload = catchAsync(async (req, res) => {
  const { machineId } = req.params;
  const { date } = req.query;
  const workload = await machineService.getMachineWorkload(machineId, date);
  res.send(workload);
});

const getMachinePerformanceMetrics = catchAsync(async (req, res) => {
  const { machineId } = req.params;
  const { startDate, endDate } = req.query;
  const metrics = await machineService.getMachinePerformanceMetrics(machineId, { startDate, endDate });
  res.send(metrics);
});

const getAllMachinesUsageOverview = catchAsync(async (req, res) => {
  const { floor, status } = req.query;
  const overview = await machineService.getAllMachinesUsageOverview({ floor, status });
  res.send(overview);
});

const deleteMachine = catchAsync(async (req, res) => {
  await machineService.deleteMachineById(req.params.machineId);
  res.status(httpStatus.NO_CONTENT).send();
});

const bulkDeleteMachines = catchAsync(async (req, res) => {
  const { machineIds } = req.body;
  if (!Array.isArray(machineIds) || machineIds.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'machineIds array is required and cannot be empty');
  }
  const results = await machineService.bulkDeleteMachines(machineIds);
  res.status(httpStatus.OK).json({
    success: true,
    message: results.message,
    data: results
  });
});

const bulkImportMachines = catchAsync(async (req, res) => {
  const { machines, batchSize } = req.body;
  const results = await machineService.bulkImportMachines(machines, batchSize);
  res.status(httpStatus.OK).json({
    success: true,
    message: `Imported ${results.total} machines: ${results.created} created, ${results.updated} updated. ${results.failed} failed.`,
    data: results,
  });
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
  getMachineUsageAnalytics,
  getMachineCurrentStatus,
  getMachineWorkload,
  getMachinePerformanceMetrics,
  getAllMachinesUsageOverview,
  deleteMachine,
  bulkDeleteMachines,
  bulkImportMachines,
};
