import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import pick from '../../utils/pick.js';
import * as yarnPurchaseOrderService from '../../services/yarnManagement/yarnPurchaseOrder.service.js';
import * as yarnReceivingPipelineService from '../../services/yarnManagement/yarnReceivingPipeline.service.js';
import * as yarnGrnService from '../../services/yarnManagement/yarnGrn.service.js';
import * as yarnPoVendorReturnService from '../../services/yarnManagement/yarnPoVendorReturn.service.js';

export const getPurchaseOrders = catchAsync(async (req, res) => {
  const query = pick(req.query, ['start_date', 'end_date', 'status_code']);

  const purchaseOrders = await yarnPurchaseOrderService.getPurchaseOrders({
    startDate: query.start_date,
    endDate: query.end_date,
    statusCode: query.status_code,
  });

  res.status(httpStatus.OK).send(purchaseOrders);
});

export const createPurchaseOrder = catchAsync(async (req, res) => {
  const purchaseOrder = await yarnPurchaseOrderService.createPurchaseOrder(req.body);
  res.status(httpStatus.CREATED).send(purchaseOrder);
});

export const getPurchaseOrder = catchAsync(async (req, res) => {
  const { purchaseOrderId } = req.params;
  const purchaseOrder = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);

  if (!purchaseOrder) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Purchase order not found' });
  }

  res.status(httpStatus.OK).send(purchaseOrder);
});

export const getPurchaseOrderByPoNumber = catchAsync(async (req, res) => {
  const { poNumber } = req.params;
  const purchaseOrder = await yarnPurchaseOrderService.getPurchaseOrderByPoNumber(poNumber);

  if (!purchaseOrder) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Purchase order not found' });
  }

  res.status(httpStatus.OK).send(purchaseOrder);
});

/** GET supplier tearweight by poNumber and yarnName (query params) */
export const getSupplierTearweightByPoAndYarnName = catchAsync(async (req, res) => {
  const { poNumber, yarnName } = req.query;
  const result = await yarnPurchaseOrderService.getSupplierTearweightByPoAndYarnName(poNumber, yarnName);
  res.status(httpStatus.OK).send(result);
});

export const deletePurchaseOrder = catchAsync(async (req, res) => {
  const { purchaseOrderId } = req.params;
  await yarnPurchaseOrderService.deletePurchaseOrderById(purchaseOrderId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const updatePurchaseOrder = catchAsync(async (req, res) => {
  const { purchaseOrderId } = req.params;

  // Snapshot lot state BEFORE the update so we can diff to detect (a) brand-new
  // lots (=> new GRN) vs (b) edits to lots that already had a GRN (=> revision).
  const beforePo = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);
  const beforeLotsByNumber = new Map(
    (beforePo?.receivedLotDetails || []).map((l) => [String(l.lotNumber).trim(), l])
  );

  await yarnPurchaseOrderService.updatePurchaseOrderById(purchaseOrderId, req.body);
  // Re-fetch with full population so the snapshot builder has yarn names/shades.
  const updatedPo = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);

  const newLotNumbers = [];
  const changedLotNumbers = [];
  for (const lot of updatedPo?.receivedLotDetails || []) {
    const key = String(lot.lotNumber).trim();
    const prior = beforeLotsByNumber.get(key);
    if (!prior) {
      newLotNumbers.push(key);
    } else if (yarnGrnService.lotMaterialChange(prior, lot)) {
      changedLotNumbers.push(key);
    }
  }

  const grnExtras = {
    vendorInvoiceNo: req.body.vendorInvoiceNo,
    vendorInvoiceDate: req.body.vendorInvoiceDate,
    discrepancyDetails: req.body.discrepancyDetails,
    grnDate: req.body.grnDate,
  };

  const createdGrn = newLotNumbers.length
    ? await yarnGrnService.createGrnFromNewLots(updatedPo, newLotNumbers, req.user, grnExtras)
    : null;

  const revisedGrns = changedLotNumbers.length
    ? await yarnGrnService.reviseAffectedGrns(
        updatedPo,
        changedLotNumbers,
        req.user,
        req.body.editReason || 'Lot data edited via PO update'
      )
    : [];

  // When receivedLotDetails are present: create/update boxes via the existing pipeline.
  // Manual entry = no box weight fill, no QC auto-approve (matches prior behaviour).
  if (updatedPo?.receivedLotDetails?.length > 0) {
    const runPipeline = req.body.run_pipeline === true;
    const updatedBy = {
      username: req.user?.email || req.user?.username || 'system',
      user_id: req.user?.id || req.user?._id?.toString?.() || '',
    };
    const result = await yarnReceivingPipelineService.processFromExistingPo({
      purchaseOrderId,
      updatedBy,
      autoApproveQc: runPipeline,
      fillBoxWeight: runPipeline,
    });
    return res.status(httpStatus.OK).send({ ...result, createdGrn, revisedGrns });
  }

  res.status(httpStatus.OK).send({ purchaseOrder: updatedPo, createdGrn, revisedGrns });
});

export const updatePurchaseOrderStatus = catchAsync(async (req, res) => {
  const { purchaseOrderId } = req.params;
  const { status_code: statusCode, updated_by: updatedBy, notes } = req.body;

  const purchaseOrder = await yarnPurchaseOrderService.updatePurchaseOrderStatus(
    purchaseOrderId,
    statusCode,
    updatedBy,
    notes
  );

  res.status(httpStatus.OK).send(purchaseOrder);
});

export const updateLotStatus = catchAsync(async (req, res) => {
  const { poNumber, lotNumber, lotStatus } = req.body;

  const purchaseOrder = await yarnPurchaseOrderService.updateLotStatus(
    poNumber,
    lotNumber,
    lotStatus
  );

  res.status(httpStatus.OK).send(purchaseOrder);
});

export const updateLotStatusAndQcApprove = catchAsync(async (req, res) => {
  const { poNumber, lotNumber, lotStatus, updated_by: updatedBy, notes, remarks, mediaUrl } = req.body;

  const qcData = {
    remarks,
    mediaUrl,
  };

  const result = await yarnPurchaseOrderService.updateLotStatusAndQcApprove(
    poNumber,
    lotNumber,
    lotStatus,
    updatedBy,
    notes,
    qcData
  );

  res.status(httpStatus.OK).send(result);
});

/** PATCH /:purchaseOrderId/qc-approve-all - QC approve all lots in a PO at once */
export const qcApproveAllLots = catchAsync(async (req, res) => {
  const { purchaseOrderId } = req.params;
  const { updated_by: updatedBy, notes, remarks } = req.body;
  const resolvedUpdatedBy =
    updatedBy ||
    {
      username: req.user?.email || req.user?.username || 'system',
      user_id: req.user?.id || req.user?._id?.toString?.() || '',
    };

  const result = await yarnPurchaseOrderService.qcApproveAllLotsForPo(
    purchaseOrderId,
    resolvedUpdatedBy,
    notes || 'QC approved all lots',
    remarks || ''
  );

  res.status(httpStatus.OK).send(result);
});

/** DELETE lot by poNumber and lotNumber (cones → boxes → lot entry) */
export const deleteLot = catchAsync(async (req, res) => {
  const { poNumber, lotNumber } = req.body;
  const result = await yarnPurchaseOrderService.deleteLotByPoAndLotNumber(poNumber, lotNumber);
  res.status(httpStatus.OK).send(result);
});

/**
 * Authenticated user for vendor-return audit trails.
 * @param {import('express').Request} req
 * @returns {{ username: string, userId: string }}
 */
const vendorReturnActor = (req) => ({
  username: req.user?.email || req.user?.username || 'system',
  userId: req.user?.id || req.user?._id?.toString?.() || '',
});

/**
 * POST vendor return session (scan workflow).
 */
export const createVendorReturnSessionController = catchAsync(async (req, res) => {
  const session = await yarnPoVendorReturnService.createVendorReturnSession({
    poNumber: req.body.poNumber,
    remark: req.body.remark,
    cancellationIntent: req.body.cancellationIntent,
    user: vendorReturnActor(req),
  });
  res.status(httpStatus.CREATED).send(session);
});

/**
 * POST add scanned cone barcode to pending list.
 */
export const scanVendorReturnSessionBarcode = catchAsync(async (req, res) => {
  const payload = await yarnPoVendorReturnService.scanVendorReturnBarcode({
    sessionId: req.params.sessionId,
    barcode: req.body.barcode,
  });
  res.status(httpStatus.OK).send(payload);
});

/**
 * DELETE remove a pending barcode from session.
 */
export const removeVendorReturnSessionBarcode = catchAsync(async (req, res) => {
  const session = await yarnPoVendorReturnService.removePendingVendorReturnBarcode({
    sessionId: req.params.sessionId,
    barcode: req.query.barcode,
  });
  res.status(httpStatus.OK).send(session);
});

/**
 * POST finalize vendor return (archive cones, PO patch, inventory sync).
 */
export const finalizeVendorReturnSessionController = catchAsync(async (req, res) => {
  const result = await yarnPoVendorReturnService.finalizeVendorReturnSession({
    sessionId: req.params.sessionId,
    idempotencyKey: req.body?.idempotencyKey,
    user: vendorReturnActor(req),
  });
  const status = result.idempotent ? httpStatus.OK : httpStatus.CREATED;
  res.status(status).send(result);
});

/**
 * GET vendor return history (completed returns).
 */
export const getVendorReturnHistory = catchAsync(async (req, res) => {
  const { po_number: poNumber, limit } = req.query;
  const rows = await yarnPoVendorReturnService.listVendorReturns({
    poNumber,
    limit: limit != null ? Number(limit) : undefined,
  });
  res.status(httpStatus.OK).send(rows);
});
