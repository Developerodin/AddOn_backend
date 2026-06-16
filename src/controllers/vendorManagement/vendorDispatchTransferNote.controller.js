import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import catchAsync from '../../utils/catchAsync.js';
import * as vendorDispatchTransferNoteService from '../../services/vendorManagement/vendorDispatchTransferNote.service.js';

/**
 * POST /vendor-management/dispatch/transfer-notes
 */
export const createVendorDispatchTransferNote = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['search']);
  const note = await vendorDispatchTransferNoteService.createVendorDispatchTransferNote(
    req.body,
    filter,
    req.user
  );
  res.status(httpStatus.CREATED).send(note);
});

/**
 * GET /vendor-management/dispatch/transfer-notes/preview
 */
export const previewVendorDispatchTransferNote = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['search']);
  const preview = await vendorDispatchTransferNoteService.previewVendorDispatchTransferNoteLines(filter);
  res.send(preview);
});

/**
 * GET /vendor-management/dispatch/transfer-notes
 */
export const getVendorDispatchTransferNotes = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['startDate', 'endDate', 'search']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  if (options.limit) options.limit = parseInt(options.limit, 10);
  if (options.page) options.page = parseInt(options.page, 10);
  const result = await vendorDispatchTransferNoteService.queryVendorDispatchTransferNotes(filter, options);
  res.send(result);
});

/**
 * GET /vendor-management/dispatch/transfer-notes/report
 */
export const getVendorDispatchTransferNoteReport = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['startDate', 'endDate', 'search']);
  const rows = await vendorDispatchTransferNoteService.getVendorDispatchTransferNoteReportRows(filter);
  res.send({ results: rows, totalResults: rows.length });
});

/**
 * GET /vendor-management/dispatch/transfer-notes/:transferNoteId
 */
export const getVendorDispatchTransferNote = catchAsync(async (req, res) => {
  const note = await vendorDispatchTransferNoteService.getVendorDispatchTransferNoteById(
    req.params.transferNoteId
  );
  res.send(note);
});
