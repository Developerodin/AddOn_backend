import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as processService from '../services/process.service.js';

export const createProcess = catchAsync(async (req, res) => {
  const process = await processService.createProcess(req.body);
  res.status(httpStatus.CREATED).send(process);
});

export const getProcesses = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'type', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await processService.queryProcesses(filter, options);
  res.send(result);
});

export const getProcess = catchAsync(async (req, res) => {
  const process = await processService.getProcessById(req.params.processId);
  if (!process) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Process not found');
  }
  res.send(process);
});

export const updateProcess = catchAsync(async (req, res) => {
  const process = await processService.updateProcessById(req.params.processId, req.body);
  res.send(process);
});

export const deleteProcess = catchAsync(async (req, res) => {
  await processService.deleteProcessById(req.params.processId);
  res.status(httpStatus.NO_CONTENT).send();
}); 