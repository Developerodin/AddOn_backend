import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import * as yarnPoReturnChallanService from '../../services/yarnManagement/yarnPoReturnChallan.service.js';

/**
 * Builds Mongo filter for challan list queries.
 * @param {object} query
 */
const buildListFilter = (query) => {
  const filter = {};
  if (query.challanNumber) filter.challanNumber = { $regex: query.challanNumber, $options: 'i' };
  if (query.poNumber) filter.poNumber = { $regex: query.poNumber, $options: 'i' };
  if (query.purchaseOrder) filter.purchaseOrder = query.purchaseOrder;
  if (query.supplierName) filter['consignee.name'] = { $regex: query.supplierName, $options: 'i' };
  filter.status = query.status || 'active';

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
  const result = await yarnPoReturnChallanService.queryChallans(filter, options);
  res.status(httpStatus.OK).send(result);
});

export const getChallan = catchAsync(async (req, res) => {
  const challan = await yarnPoReturnChallanService.getChallanById(req.params.challanId);
  if (!challan) throw new ApiError(httpStatus.NOT_FOUND, 'Return challan not found');
  res.status(httpStatus.OK).send(challan);
});

export const getChallanByNumber = catchAsync(async (req, res) => {
  const challan = await yarnPoReturnChallanService.getChallanByNumber(req.params.challanNumber);
  if (!challan) throw new ApiError(httpStatus.NOT_FOUND, 'Return challan not found');
  res.status(httpStatus.OK).send(challan);
});

export const getChallansByPo = catchAsync(async (req, res) => {
  const challans = await yarnPoReturnChallanService.getChallansByPurchaseOrder(req.params.purchaseOrderId);
  res.status(httpStatus.OK).send({ results: challans });
});

export const patchChallanTransport = catchAsync(async (req, res) => {
  const challan = await yarnPoReturnChallanService.patchChallanTransport(req.params.challanId, req.body || {});
  if (!challan) throw new ApiError(httpStatus.NOT_FOUND, 'Return challan not found');
  res.status(httpStatus.OK).send(challan);
});
