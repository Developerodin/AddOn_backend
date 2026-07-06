import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import * as scanningService from '../../services/whms/scanning.service.js';

const createSession = catchAsync(async (req, res) => {
  const session = await scanningService.createSession(req.body.orderId, req.user);
  res.status(httpStatus.CREATED).send(session);
});

const getSessions = catchAsync(async (req, res) => {
  const query = pick(req.query, ['orderId', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await scanningService.querySessions(query, options);
  res.send(result);
});

const getSession = catchAsync(async (req, res) => {
  const session = await scanningService.getSessionById(req.params.sessionId);
  res.send(session);
});

const scanBarcode = catchAsync(async (req, res) => {
  const result = await scanningService.scanBarcode(req.params.sessionId, req.body);
  res.send(result);
});

const updateScanItem = catchAsync(async (req, res) => {
  const session = await scanningService.updateScanItem(req.params.sessionId, req.params.itemId, req.body);
  res.send(session);
});

const completeSession = catchAsync(async (req, res) => {
  const session = await scanningService.completeSession(req.params.sessionId, req.user, req.body);
  res.send(session);
});

const cancelSession = catchAsync(async (req, res) => {
  const session = await scanningService.cancelSession(req.params.sessionId, req.user, req.body);
  res.send(session);
});

export { createSession, getSessions, getSession, scanBarcode, updateScanItem, completeSession, cancelSession };
