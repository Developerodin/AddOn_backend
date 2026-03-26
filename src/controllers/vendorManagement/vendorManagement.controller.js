import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import catchAsync from '../../utils/catchAsync.js';
import * as vendorManagementService from '../../services/vendorManagement/vendorManagement.service.js';
import * as vendorProductionFlowService from '../../services/vendorManagement/vendorProductionFlow.service.js';

export const createVendorManagement = catchAsync(async (req, res) => {
  const doc = await vendorManagementService.createVendorManagement(req.body);
  res.status(httpStatus.CREATED).send(doc);
});

export const getVendorManagements = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['vendorName', 'vendorCode', 'status', 'city', 'state']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const { search } = req.query;
  const result = await vendorManagementService.queryVendorManagements(filter, options, search);
  res.send(result);
});

export const getVendorProductionFlows = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['vendor', 'vendorPurchaseOrder', 'product', 'currentFloorKey']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const { search } = req.query;
  const result = await vendorManagementService.queryVendorProductionFlows(filter, options, search);
  res.send(result);
});

export const getVendorProductionFlow = catchAsync(async (req, res) => {
  const doc = await vendorManagementService.getVendorProductionFlowById(req.params.vendorProductionFlowId);
  res.send(doc);
});

export const updateVendorProductionFlowFloor = catchAsync(async (req, res) => {
  const { vendorProductionFlowId, floorKey } = req.params;
  const result = await vendorProductionFlowService.updateVendorProductionFlowFloorById(
    vendorProductionFlowId,
    floorKey,
    req.body
  );
  res.send(result);
});

export const transferVendorProductionFlow = catchAsync(async (req, res) => {
  const { vendorProductionFlowId } = req.params;
  const { fromFloorKey, toFloorKey, quantity } = req.body;
  const result = await vendorProductionFlowService.transferVendorProductionFlowQuantity(
    vendorProductionFlowId,
    fromFloorKey,
    toFloorKey,
    quantity
  );
  res.send(result);
});

export const confirmVendorProductionFlow = catchAsync(async (req, res) => {
  const { vendorProductionFlowId } = req.params;
  const { remarks } = req.body || {};
  const result = await vendorProductionFlowService.confirmVendorProductionFlowById(vendorProductionFlowId, remarks);
  res.send(result);
});

export const transferFinalCheckingM2ForRework = catchAsync(async (req, res) => {
  const { vendorProductionFlowId } = req.params;
  const { toFloorKey, quantity } = req.body;
  const result = await vendorProductionFlowService.transferFinalCheckingM2ForRework(
    vendorProductionFlowId,
    toFloorKey,
    quantity
  );
  res.send(result);
});

export const getVendorManagement = catchAsync(async (req, res) => {
  const populateProducts = req.query.populate === 'products';
  const doc = await vendorManagementService.getVendorManagementById(req.params.vendorManagementId, {
    populateProducts,
  });
  if (!doc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor management record not found');
  }
  res.send(doc);
});

export const updateVendorManagement = catchAsync(async (req, res) => {
  const doc = await vendorManagementService.updateVendorManagementById(req.params.vendorManagementId, req.body);
  res.send(doc);
});

export const deleteVendorManagement = catchAsync(async (req, res) => {
  await vendorManagementService.deleteVendorManagementById(req.params.vendorManagementId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const addVendorProducts = catchAsync(async (req, res) => {
  const doc = await vendorManagementService.addProductsToVendor(req.params.vendorManagementId, req.body.productIds);
  res.send(doc);
});

export const removeVendorProducts = catchAsync(async (req, res) => {
  const doc = await vendorManagementService.removeProductsFromVendor(
    req.params.vendorManagementId,
    req.body.productIds
  );
  res.send(doc);
});
