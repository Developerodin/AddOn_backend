import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import * as vendorGrnService from '../../services/vendorManagement/vendorGrn.service.js';

/**
 * Build Mongo filter for vendor GRN list queries.
 * @param {Object} query
 */
const buildListFilter = (query) => {
  const filter = {};
  if (query.grnNumber) filter.grnNumber = { $regex: query.grnNumber, $options: 'i' };
  if (query.vpoNumber) filter.vpoNumber = { $regex: query.vpoNumber, $options: 'i' };
  if (query.vendorPurchaseOrder) filter.vendorPurchaseOrder = query.vendorPurchaseOrder;
  if (query.lotNumber) filter['lots.lotNumber'] = query.lotNumber;
  if (query.vendorName) filter['vendor.vendorName'] = { $regex: query.vendorName, $options: 'i' };

  if (query.status) {
    filter.status = query.status;
  } else if (!query.includeSuperseded) {
    filter.status = 'active';
  }

  if (query.from || query.to) {
    filter.grnDate = {};
    if (query.from) filter.grnDate.$gte = new Date(query.from);
    if (query.to) {
      const to = new Date(query.to);
      to.setHours(23, 59, 59, 999);
      filter.grnDate.$lte = to;
    }
  }
  return filter;
};

export const listGrns = catchAsync(async (req, res) => {
  const filter = buildListFilter(req.query);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await vendorGrnService.queryGrns(filter, options);
  res.status(httpStatus.OK).send(result);
});

export const getGrn = catchAsync(async (req, res) => {
  const grn = await vendorGrnService.getGrnById(req.params.grnId);
  if (!grn) throw new ApiError(httpStatus.NOT_FOUND, 'GRN not found');
  res.status(httpStatus.OK).send(grn);
});

export const getGrnByNumber = catchAsync(async (req, res) => {
  const grn = await vendorGrnService.getGrnByNumber(req.params.grnNumber);
  if (!grn) throw new ApiError(httpStatus.NOT_FOUND, 'GRN not found');
  res.status(httpStatus.OK).send(grn);
});

export const getGrnsByVpo = catchAsync(async (req, res) => {
  const grns = await vendorGrnService.getGrnsByVpo(req.params.vpoId, {
    includeSuperseded: req.query.includeSuperseded === true || req.query.includeSuperseded === 'true',
  });
  res.status(httpStatus.OK).send({ results: grns });
});

export const getGrnsByLot = catchAsync(async (req, res) => {
  const grns = await vendorGrnService.getGrnsByLot(req.params.lotNumber, {
    includeSuperseded: req.query.includeSuperseded === true || req.query.includeSuperseded === 'true',
  });
  res.status(httpStatus.OK).send({ results: grns });
});

export const issueGrnFromFlow = catchAsync(async (req, res) => {
  const grn = await vendorGrnService.issueGrnFromFlow(req.params.flowId, req.user, req.body || {});
  res.status(httpStatus.CREATED).send(grn);
});

export const ensureGrnsForVpo = catchAsync(async (req, res) => {
  const grns = await vendorGrnService.ensureGrnsForVpo(req.params.vpoId, req.user);
  res.status(httpStatus.OK).send({ results: grns });
});

export const getGrnRevisions = catchAsync(async (req, res) => {
  const revisions = await vendorGrnService.getRevisionsOf(req.params.grnId);
  res.status(httpStatus.OK).send({ results: revisions });
});

export const updateGrnHeader = catchAsync(async (req, res) => {
  const grn = await vendorGrnService.updateGrnHeader(req.params.grnId, req.body);
  res.status(httpStatus.OK).send(grn);
});

export const getActiveGrnForFlow = catchAsync(async (req, res) => {
  const grn = await vendorGrnService.getActiveGrnForFlow(req.params.flowId);
  res.status(httpStatus.OK).send({ grn: grn || null });
});
