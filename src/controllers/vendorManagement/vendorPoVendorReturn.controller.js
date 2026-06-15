import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import * as vendorPoVendorReturnService from '../../services/vendorManagement/vendorPoVendorReturn.service.js';

export const createSession = catchAsync(async (req, res) => {
  const result = await vendorPoVendorReturnService.createVendorReturnSession({
    ...req.body,
    user: req.user,
  });
  res.status(httpStatus.CREATED).send(result);
});

export const getSession = catchAsync(async (req, res) => {
  const result = await vendorPoVendorReturnService.getVendorReturnSession(req.params.sessionId);
  res.send(result);
});

export const scanBarcode = catchAsync(async (req, res) => {
  const result = await vendorPoVendorReturnService.scanVendorReturnBarcode({
    sessionId: req.params.sessionId,
    barcode: req.body.barcode,
  });
  res.send(result);
});

export const removeBarcode = catchAsync(async (req, res) => {
  const result = await vendorPoVendorReturnService.removePendingVendorReturnBarcode({
    sessionId: req.params.sessionId,
    barcode: req.query.barcode,
  });
  res.send(result);
});

export const addM4Line = catchAsync(async (req, res) => {
  const result = await vendorPoVendorReturnService.addM4LineToSession({
    sessionId: req.params.sessionId,
    ...req.body,
  });
  res.send(result);
});

export const finalizeSession = catchAsync(async (req, res) => {
  const result = await vendorPoVendorReturnService.finalizeVendorReturnSession({
    sessionId: req.params.sessionId,
    idempotencyKey: req.body?.idempotencyKey,
    user: req.user,
  });
  res.send(result);
});

export const getHistory = catchAsync(async (req, res) => {
  const result = await vendorPoVendorReturnService.listVendorReturnHistory(req.query);
  res.send({ results: result });
});

export const getM4Candidates = catchAsync(async (req, res) => {
  const results = await vendorPoVendorReturnService.getM4ReturnCandidates(req.query.vpoNumber);
  res.send({ results });
});

export const getArticleCandidates = catchAsync(async (req, res) => {
  const results = await vendorPoVendorReturnService.getArticleReturnCandidates(req.query.vpoNumber);
  res.send({ results });
});

export const addArticleQtyLine = catchAsync(async (req, res) => {
  const result = await vendorPoVendorReturnService.addArticleQtyLineToSession({
    sessionId: req.params.sessionId,
    ...req.body,
  });
  res.send(result);
});

export const removeArticleQtyLine = catchAsync(async (req, res) => {
  const result = await vendorPoVendorReturnService.removePendingArticleQtyLine({
    sessionId: req.params.sessionId,
    vendorProductionFlowId: req.query.vendorProductionFlowId,
  });
  res.send(result);
});

export const removeM4Line = catchAsync(async (req, res) => {
  const result = await vendorPoVendorReturnService.removePendingM4Line({
    sessionId: req.params.sessionId,
    vendorProductionFlowId: req.query.vendorProductionFlowId,
  });
  res.send(result);
});
