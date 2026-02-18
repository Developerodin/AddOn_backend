import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as yarnReceivingPipelineService from '../../services/yarnManagement/yarnReceivingPipeline.service.js';

/**
 * POST /v1/yarn-management/yarn-receiving/process-from-po/:purchaseOrderId
 * Single button: goods received + process.
 * PO must already have packListDetails and receivedLotDetails (from PATCH).
 * Creates boxes, updates box weight/cones, auto-approves QC when data matches.
 */
export const processFromExistingPo = catchAsync(async (req, res) => {
  const { purchaseOrderId } = req.params;
  const { packListDetails, receivedLotDetails, notes, autoApproveQc } = req.body;
  const updatedBy = {
    username: req.user?.email || req.user?.username || 'system',
    user_id: req.user?.id || req.user?._id?.toString?.() || '',
  };

  const result = await yarnReceivingPipelineService.processFromExistingPo({
    purchaseOrderId,
    updatedBy,
    packListDetails,
    receivedLotDetails,
    notes,
    autoApproveQc: autoApproveQc ?? true,
  });

  res.status(httpStatus.OK).send(result);
});

/**
 * POST /v1/yarn-management/yarn-receiving/process
 * Normal flow (e.g. step-by-step or multi-PO with append). Appends pack list and received lots per PO.
 * Body: { items: [{ poNumber, packing?, lots, notes? }], notes?, autoApproveQc? }
 */
export const processReceiving = catchAsync(async (req, res) => {
  const { items, notes, autoApproveQc } = req.body;
  const updatedBy = {
    username: req.user?.email || req.user?.username || 'system',
    user_id: req.user?.id || req.user?._id?.toString?.() || '',
  };

  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (const item of items || []) {
    const poNumber = (item.poNumber || '').trim();
    if (!poNumber) {
      results.push({
        poNumber: null,
        success: false,
        message: 'Missing poNumber',
        errors: [],
      });
      failCount += 1;
      continue;
    }

    try {
      const r = await yarnReceivingPipelineService.runReceivingPipelineForPo({
        poNumber,
        packing: item.packing || {},
        lots: item.lots || [],
        updatedBy,
        notes: item.notes ?? notes,
        autoApproveQc: item.autoApproveQc ?? autoApproveQc ?? true,
        replacePackListAndLots: false,
      });
      results.push({
        poNumber,
        success: r.success,
        message: r.message,
        purchaseOrder: r.purchaseOrder,
        boxesCreated: r.boxesCreated,
        boxesUpdated: r.boxesUpdated,
        errors: r.errors || [],
      });
      if (r.success) successCount += 1;
      else failCount += 1;
    } catch (err) {
      results.push({
        poNumber,
        success: false,
        message: err.message || String(err),
        errors: [{ error: err.message || String(err) }],
      });
      failCount += 1;
    }
  }

  res.status(httpStatus.OK).send({
    results,
    summary: {
      total: results.length,
      success: successCount,
      failed: failCount,
    },
  });
});

/**
 * POST /v1/yarn-management/yarn-receiving/process-excel
 * Excel process flow only. Replaces pack list and received lots for each PO (no append → no duplicate).
 * Body: same as /process — { items: [{ poNumber, packing?, lots, notes? }], notes?, autoApproveQc? }
 */
export const processExcel = catchAsync(async (req, res) => {
  const { items, notes, autoApproveQc } = req.body;
  const updatedBy = {
    username: req.user?.email || req.user?.username || 'system',
    user_id: req.user?.id || req.user?._id?.toString?.() || '',
  };

  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (const item of items || []) {
    const poNumber = (item.poNumber || '').trim();
    if (!poNumber) {
      results.push({
        poNumber: null,
        success: false,
        message: 'Missing poNumber',
        errors: [],
      });
      failCount += 1;
      continue;
    }

    try {
      const r = await yarnReceivingPipelineService.runReceivingPipelineForPo({
        poNumber,
        packing: item.packing || {},
        lots: item.lots || [],
        updatedBy,
        notes: item.notes ?? notes,
        autoApproveQc: item.autoApproveQc ?? autoApproveQc ?? true,
        replacePackListAndLots: true,
      });
      results.push({
        poNumber,
        success: r.success,
        message: r.message,
        purchaseOrder: r.purchaseOrder,
        boxesCreated: r.boxesCreated,
        boxesUpdated: r.boxesUpdated,
        errors: r.errors || [],
      });
      if (r.success) successCount += 1;
      else failCount += 1;
    } catch (err) {
      results.push({
        poNumber,
        success: false,
        message: err.message || String(err),
        errors: [{ error: err.message || String(err) }],
      });
      failCount += 1;
    }
  }

  res.status(httpStatus.OK).send({
    results,
    summary: {
      total: results.length,
      success: successCount,
      failed: failCount,
    },
  });
});

/**
 * POST /v1/yarn-management/yarn-receiving/process-step-by-step
 * Body: { step, poNumber, packing?, lots?, lotNumber?, updated_by?, notes?, qcData? }
 * Process a specific step (1-7) of the receiving workflow.
 * Step 1: Update PO to in_transit with packing details
 * Step 2: Add lot details
 * Step 3: Process/generate barcodes
 * Step 4: Update box details
 * Step 5: Send for QC
 * Step 6: Get box by barcode (use GET /yarn-boxes/barcode/:barcode)
 * Step 7: Approve QC
 */
export const processReceivingStepByStep = catchAsync(async (req, res) => {
  const { step, poNumber, packing, lots, lotNumber, updated_by, notes, qcData } = req.body;
  
  const updatedBy = updated_by || {
    username: req.user?.email || req.user?.username || 'system',
    user_id: req.user?.id || req.user?._id?.toString?.() || '',
  };

  const result = await yarnReceivingPipelineService.processReceivingStepByStep({
    step: Number(step),
    poNumber,
    packing,
    lots,
    lotNumber,
    updatedBy,
    notes,
    qcData,
  });

  res.status(httpStatus.OK).send(result);
});

/**
 * POST /v1/yarn-management/yarn-receiving/step/:stepNumber
 * Same as processReceivingStepByStep but step comes from URL param
 */
export const processReceivingStep = catchAsync(async (req, res) => {
  const { stepNumber } = req.params;
  const { poNumber, packing, lots, lotNumber, updated_by, notes, qcData } = req.body;
  
  const updatedBy = updated_by || {
    username: req.user?.email || req.user?.username || 'system',
    user_id: req.user?.id || req.user?._id?.toString?.() || '',
  };

  const result = await yarnReceivingPipelineService.processReceivingStepByStep({
    step: Number(stepNumber),
    poNumber,
    packing,
    lots,
    lotNumber,
    updatedBy,
    notes,
    qcData,
  });

  res.status(httpStatus.OK).send(result);
});
