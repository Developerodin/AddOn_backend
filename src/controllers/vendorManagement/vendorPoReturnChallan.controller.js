import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import * as vendorPoReturnChallanService from '../../services/vendorManagement/vendorPoReturnChallan.service.js';

/**
 * Build list filter from query params.
 * @param {Object} query
 */
const buildListFilter = (query) => {
  const filter = { status: 'active' };
  if (query.challanNumber) filter.challanNumber = { $regex: query.challanNumber, $options: 'i' };
  if (query.vpoNumber) filter.vpoNumber = { $regex: query.vpoNumber, $options: 'i' };
  if (query.vendorPurchaseOrder) filter.vendorPurchaseOrder = query.vendorPurchaseOrder;
  if (query.vendorName) filter['vendor.name'] = { $regex: query.vendorName, $options: 'i' };
  if (query.from || query.to) {
    filter.challanDate = {};
    if (query.from) filter.challanDate.$gte = new Date(query.from);
    if (query.to) {
      const to = new Date(query.to);
      to.setHours(23, 59, 59, 999);
      filter.challanDate.$lte = to;
    }
  }
  return filter;
};

export const listChallans = catchAsync(async (req, res) => {
  const filter = buildListFilter(req.query);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await vendorPoReturnChallanService.queryChallans(filter, options);
  res.send(result);
});

export const getChallan = catchAsync(async (req, res) => {
  const challan = await vendorPoReturnChallanService.getChallanById(req.params.challanId);
  if (!challan) throw new ApiError(httpStatus.NOT_FOUND, 'Challan not found');
  res.send(challan);
});

export const getChallanByNumber = catchAsync(async (req, res) => {
  const challan = await vendorPoReturnChallanService.getChallanByNumber(req.params.challanNumber);
  if (!challan) throw new ApiError(httpStatus.NOT_FOUND, 'Challan not found');
  res.send(challan);
});

export const getChallansByVpo = catchAsync(async (req, res) => {
  const results = await vendorPoReturnChallanService.getChallansByVpo(req.params.vpoId);
  res.send({ results });
});

export const patchTransport = catchAsync(async (req, res) => {
  const challan = await vendorPoReturnChallanService.patchChallanTransport(
    req.params.challanId,
    req.body
  );
  res.send(challan);
});

export const patchBoxes = catchAsync(async (req, res) => {
  const challan = await vendorPoReturnChallanService.patchChallanReturnBoxes(
    req.params.challanId,
    req.body.boxes
  );
  res.send(challan);
});
