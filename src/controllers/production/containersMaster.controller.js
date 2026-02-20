import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import catchAsync from '../../utils/catchAsync.js';
import * as containersMasterService from '../../services/production/containersMaster.service.js';

const createContainersMaster = catchAsync(async (req, res) => {
  const doc = await containersMasterService.createContainersMaster(req.body);
  res.status(httpStatus.CREATED).send(doc);
});

const getContainersMasters = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['containerName', 'status', 'search']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await containersMasterService.queryContainersMasters(filter, options);
  res.send(result);
});

const getContainersMaster = catchAsync(async (req, res) => {
  const doc = await containersMasterService.getContainersMasterById(req.params.containerId);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Container not found');
  res.send(doc);
});

const getContainerByBarcode = catchAsync(async (req, res) => {
  const doc = await containersMasterService.getContainerByBarcode(req.params.barcode);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Container not found for this barcode');
  res.send(doc);
});

const updateContainersMaster = catchAsync(async (req, res) => {
  const doc = await containersMasterService.updateContainersMasterById(req.params.containerId, req.body);
  res.send(doc);
});

const deleteContainersMaster = catchAsync(async (req, res) => {
  await containersMasterService.deleteContainersMasterById(req.params.containerId);
  res.status(httpStatus.NO_CONTENT).send();
});

export {
  createContainersMaster,
  getContainersMasters,
  getContainersMaster,
  getContainerByBarcode,
  updateContainersMaster,
  deleteContainersMaster,
};
