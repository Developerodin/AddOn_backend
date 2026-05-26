import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import catchAsync from '../../utils/catchAsync.js';
import * as dispatchTransferNoteService from '../../services/production/dispatchTransferNote.service.js';

/**
 * POST /production/floors/Dispatch/transfer-notes
 */
export const createDispatchTransferNote = catchAsync(async (req, res) => {
  const allowedFilterFields = ['status', 'priority', 'search', 'machineId'];
  const filter = pick(req.query, allowedFilterFields);
  const note = await dispatchTransferNoteService.createDispatchTransferNote(req.body, filter, req.user);
  res.status(httpStatus.CREATED).send(note);
});

/**
 * GET /production/floors/Dispatch/transfer-notes/preview
 */
export const previewDispatchTransferNote = catchAsync(async (req, res) => {
  const allowedFilterFields = ['status', 'priority', 'search', 'machineId'];
  const filter = pick(req.query, allowedFilterFields);
  const preview = await dispatchTransferNoteService.previewDispatchTransferNoteLines(filter);
  res.send(preview);
});

/**
 * GET /production/floors/Dispatch/transfer-notes
 */
export const getDispatchTransferNotes = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['startDate', 'endDate', 'search']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  if (options.limit) options.limit = parseInt(options.limit, 10);
  if (options.page) options.page = parseInt(options.page, 10);
  const result = await dispatchTransferNoteService.queryDispatchTransferNotes(filter, options);
  res.send(result);
});

/**
 * GET /production/floors/Dispatch/transfer-notes/report
 */
export const getDispatchTransferNoteReport = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['startDate', 'endDate', 'search']);
  const rows = await dispatchTransferNoteService.getDispatchTransferNoteReportRows(filter);
  res.send({ results: rows, totalResults: rows.length });
});

/**
 * GET /production/floors/Dispatch/transfer-notes/:transferNoteId
 */
export const getDispatchTransferNote = catchAsync(async (req, res) => {
  const note = await dispatchTransferNoteService.getDispatchTransferNoteById(req.params.transferNoteId);
  res.send(note);
});
