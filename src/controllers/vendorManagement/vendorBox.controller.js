import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import catchAsync from '../../utils/catchAsync.js';
import * as vendorBoxService from '../../services/vendorManagement/vendorBox.service.js';

export const createVendorBox = catchAsync(async (req, res) => {
  const doc = await vendorBoxService.createVendorBox(req.body);
  res.status(httpStatus.CREATED).send(doc);
});

export const bulkCreateVendorBoxes = catchAsync(async (req, res) => {
  const result = await vendorBoxService.bulkCreateVendorBoxes(req.body);
  res.status(httpStatus.CREATED).send(result);
});

export const getVendorBoxes = catchAsync(async (req, res) => {
  const filter = pick(req.query, [
    'vpoNumber',
    'vendorPurchaseOrderId',
    'vendor',
    'productName',
    'lotNumber',
    'storedStatus',
  ]);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const { search } = req.query;
  const result = await vendorBoxService.queryVendorBoxes(filter, options, search);
  res.send(result);
});

export const getVendorBox = catchAsync(async (req, res) => {
  const doc = await vendorBoxService.getVendorBoxById(req.params.vendorBoxId);
  res.send(doc);
});

export const updateVendorBox = catchAsync(async (req, res) => {
  const doc = await vendorBoxService.updateVendorBoxById(req.params.vendorBoxId, req.body);
  res.send(doc);
});

export const processVendorLot = catchAsync(async (req, res) => {
  const result = await vendorBoxService.processVendorLot(req.body);
  res.status(httpStatus.CREATED).send(result);
});

export const deleteVendorBox = catchAsync(async (req, res) => {
  await vendorBoxService.deleteVendorBoxById(req.params.vendorBoxId);
  res.status(httpStatus.NO_CONTENT).send();
});
