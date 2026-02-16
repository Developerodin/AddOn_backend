import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as vendorService from '../services/vendor.service.js';

export const createVendor = catchAsync(async (req, res) => {
  const vendor = await vendorService.createVendor(req.body);
  res.status(httpStatus.CREATED).send(vendor);
});

export const getVendors = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['vendorName', 'vendorCode', 'contactPerson', 'phone', 'email', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const search = req.query.search;
  const result = await vendorService.queryVendors(filter, options, search);
  res.send(result);
});

export const getVendor = catchAsync(async (req, res) => {
  const vendor = await vendorService.getVendorById(req.params.vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor not found');
  }
  res.send(vendor);
});

export const updateVendor = catchAsync(async (req, res) => {
  const vendor = await vendorService.updateVendorById(req.params.vendorId, req.body);
  res.send(vendor);
});

export const deleteVendor = catchAsync(async (req, res) => {
  await vendorService.deleteVendorById(req.params.vendorId);
  res.status(httpStatus.NO_CONTENT).send();
});
