import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import * as inwardReceiveService from '../../services/whms/inwardReceive.service.js';

const createInwardReceive = catchAsync(async (req, res) => {
  const record = await inwardReceiveService.createInwardReceive(req.body);
  const populated = await inwardReceiveService.getInwardReceiveById(record._id);
  res.status(httpStatus.CREATED).send(populated);
});

const getInwardReceives = catchAsync(async (req, res) => {
  const filter = inwardReceiveService.buildInwardReceiveFilter(req.query);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await inwardReceiveService.queryInwardReceives(filter, options);
  res.send(result);
});

const getInwardReceive = catchAsync(async (req, res) => {
  const record = await inwardReceiveService.getInwardReceiveById(req.params.id);
  if (!record) throw new ApiError(httpStatus.NOT_FOUND, 'Inward receive not found');
  res.send(record);
});

const updateInwardReceive = catchAsync(async (req, res) => {
  const record = await inwardReceiveService.updateInwardReceiveById(req.params.id, req.body);
  res.send(record);
});

const deleteInwardReceive = catchAsync(async (req, res) => {
  await inwardReceiveService.deleteInwardReceiveById(req.params.id);
  res.status(httpStatus.NO_CONTENT).send();
});

const promoteVendorDispatchToInwardReceive = catchAsync(async (req, res) => {
  const { vendorProductionFlowId, containerBarcode } = req.body;
  const result = await inwardReceiveService.promoteVendorDispatchToInwardReceive(vendorProductionFlowId, {
    containerBarcode,
  });
  res.status(httpStatus.OK).send(result);
});

export {
  createInwardReceive,
  getInwardReceives,
  getInwardReceive,
  updateInwardReceive,
  deleteInwardReceive,
  promoteVendorDispatchToInwardReceive,
};
