import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import * as yarnGrnService from '../../services/yarnManagement/yarnGrn.service.js';

/**
 * Translate query string filters into the Mongo filter shape expected by
 * yarnGrnService.queryGrns. Supplier name is regex'd (case-insensitive) so
 * partial matches work; date range maps to grnDate {$gte,$lte}.
 * @param {Object} query - req.query already validated
 */
const buildListFilter = (query) => {
  const filter = {};
  if (query.grnNumber) filter.grnNumber = { $regex: query.grnNumber, $options: 'i' };
  if (query.poNumber) filter.poNumber = { $regex: query.poNumber, $options: 'i' };
  if (query.purchaseOrder) filter.purchaseOrder = query.purchaseOrder;
  if (query.lotNumber) filter['lots.lotNumber'] = query.lotNumber;
  if (query.supplierName) filter['supplier.name'] = { $regex: query.supplierName, $options: 'i' };
  if (query.createdBy) filter['createdBy.user'] = query.createdBy;
  if (typeof query.isLegacy === 'boolean') filter.isLegacy = query.isLegacy;

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
  const result = await yarnGrnService.queryGrns(filter, options);
  res.status(httpStatus.OK).send(result);
});

export const getGrn = catchAsync(async (req, res) => {
  const grn = await yarnGrnService.getGrnById(req.params.grnId);
  if (!grn) throw new ApiError(httpStatus.NOT_FOUND, 'GRN not found');
  res.status(httpStatus.OK).send(grn);
});

export const getGrnRevisions = catchAsync(async (req, res) => {
  const revisions = await yarnGrnService.getRevisionsOf(req.params.grnId);
  res.status(httpStatus.OK).send({ results: revisions });
});

export const getGrnByNumber = catchAsync(async (req, res) => {
  const grn = await yarnGrnService.getGrnByNumber(req.params.grnNumber);
  if (!grn) throw new ApiError(httpStatus.NOT_FOUND, 'GRN not found');
  res.status(httpStatus.OK).send(grn);
});

export const getGrnsByPo = catchAsync(async (req, res) => {
  const grns = await yarnGrnService.getGrnsByPurchaseOrder(req.params.purchaseOrderId, {
    includeSuperseded: req.query.includeSuperseded === true || req.query.includeSuperseded === 'true',
  });
  res.status(httpStatus.OK).send({ results: grns });
});

export const getGrnsByLot = catchAsync(async (req, res) => {
  const grns = await yarnGrnService.getGrnsByLot(req.params.lotNumber, {
    includeSuperseded: req.query.includeSuperseded === true || req.query.includeSuperseded === 'true',
  });
  res.status(httpStatus.OK).send({ results: grns });
});

/**
 * POST /yarn-grns/by-po/:purchaseOrderId/ensure
 * Idempotent: returns the latest GRN, issuing one for any unGRN'd received
 * lots first. Used by Print Summary so the user never sees blank GRN no/date.
 */
export const ensureGrnForPo = catchAsync(async (req, res) => {
  const result = await yarnGrnService.ensureGrnForPo(
    req.params.purchaseOrderId,
    req.user,
    req.body || {}
  );
  res.status(httpStatus.OK).send(result);
});

/**
 * PATCH /yarn-grns/:grnId/header
 * Update header-only metadata on an existing GRN (vendor invoice no/date,
 * discrepancy notes, narration). Does NOT mint a revision because none of
 * these fields are part of the materially-immutable lot snapshot.
 */
export const updateGrnHeader = catchAsync(async (req, res) => {
  const grn = await yarnGrnService.updateGrnHeader(req.params.grnId, req.body || {});
  if (!grn) throw new ApiError(httpStatus.NOT_FOUND, 'GRN not found');
  res.status(httpStatus.OK).send(grn);
});
