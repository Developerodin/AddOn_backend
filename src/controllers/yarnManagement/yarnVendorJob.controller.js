import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import * as yarnVendorJobService from '../../services/yarnManagement/yarnVendorJob.service.js';

/**
 * POST /preview — classify a scanned box for send or receive.
 */
export const previewBox = catchAsync(async (req, res) => {
  const result = await yarnVendorJobService.previewBox(req.body.barcode);
  res.status(httpStatus.OK).send(result);
});

/**
 * POST /send — dispatch boxes to a yarn supplier.
 */
export const sendBoxes = catchAsync(async (req, res) => {
  const shipment = await yarnVendorJobService.sendBoxesToVendor(req.body, req.user);
  res.status(httpStatus.CREATED).send(shipment);
});

/**
 * POST /receive — restock boxes onto a scanned LT rack.
 */
export const receiveBoxes = catchAsync(async (req, res) => {
  const result = await yarnVendorJobService.receiveBoxesFromVendor(req.body, req.user);
  res.status(httpStatus.OK).send(result);
});

/**
 * POST /:id/void — reverse an unreceived send.
 */
export const voidShipment = catchAsync(async (req, res) => {
  const shipment = await yarnVendorJobService.voidShipment(req.params.id, req.user);
  res.status(httpStatus.OK).send(shipment);
});

/**
 * GET / — paginated send notes.
 */
export const listShipments = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'supplierId']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await yarnVendorJobService.queryShipments(filter, options);
  res.status(httpStatus.OK).send(result);
});

/**
 * GET /at-vendor — boxes currently at a processor.
 */
export const listAtVendor = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['supplierId']);
  const result = await yarnVendorJobService.listAtVendor(filter);
  res.status(httpStatus.OK).send(result);
});

/**
 * GET /:id — one shipment with receives.
 */
export const getShipment = catchAsync(async (req, res) => {
  const shipment = await yarnVendorJobService.getShipmentById(req.params.id);
  res.status(httpStatus.OK).send(shipment);
});
