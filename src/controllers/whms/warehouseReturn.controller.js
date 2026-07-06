import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import * as warehouseReturnService from '../../services/whms/warehouseReturn.service.js';

const createReturn = catchAsync(async (req, res) => {
  const doc = await warehouseReturnService.createReturn(req.body, req.user);
  res.status(httpStatus.CREATED).send(doc);
});

const getReturns = catchAsync(async (req, res) => {
  const filter = warehouseReturnService.buildReturnFilter(
    pick(req.query, ['type', 'status', 'reason', 'orderId', 'invoiceId', 'q'])
  );
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await warehouseReturnService.queryReturns(filter, options);
  res.send(result);
});

const getReturn = catchAsync(async (req, res) => {
  const doc = await warehouseReturnService.getReturnById(req.params.returnId);
  res.send(doc);
});

const scanReturnItem = catchAsync(async (req, res) => {
  const doc = await warehouseReturnService.scanReturnItem(req.params.returnId, req.body);
  res.send(doc);
});

const updateReturnItem = catchAsync(async (req, res) => {
  const doc = await warehouseReturnService.updateReturnItem(
    req.params.returnId,
    req.params.itemId,
    req.body,
    req.user
  );
  res.send(doc);
});

const getDifferenceReport = catchAsync(async (req, res) => {
  const report = await warehouseReturnService.buildDifferenceReport(req.params.returnId);
  res.send(report);
});

const submitReturn = catchAsync(async (req, res) => {
  const doc = await warehouseReturnService.submitReturnForApproval(req.params.returnId, req.user);
  res.send(doc);
});

const approveReturn = catchAsync(async (req, res) => {
  const doc = await warehouseReturnService.approveReturn(req.params.returnId, req.user);
  res.send(doc);
});

const rejectReturn = catchAsync(async (req, res) => {
  const doc = await warehouseReturnService.rejectReturn(req.params.returnId, req.user, req.body);
  res.send(doc);
});

export {
  createReturn,
  getReturns,
  getReturn,
  scanReturnItem,
  updateReturnItem,
  getDifferenceReport,
  submitReturn,
  approveReturn,
  rejectReturn,
};
