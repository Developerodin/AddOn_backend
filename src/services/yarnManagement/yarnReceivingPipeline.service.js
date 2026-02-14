import { YarnBox } from '../../models/index.js';
import * as yarnPurchaseOrderService from './yarnPurchaseOrder.service.js';
import * as yarnBoxService from './yarnBox.service.js';

/** Default packing (fixed for now); request packing overrides these when provided. */
const DEFAULT_PACKING = {
  packingNumber: '0028360',
  courierName: 'countrywide logistics india pvt ltd',
  courierNumber: '6521393',
  vehicleNumber: 'gj05cw1835',
  challanNumber: '0028360',
  dispatchDate: '2026-01-14',
  estimatedDeliveryDate: '2026-02-14',
  notes: '',
};

/**
 * Merge request packing with defaults (request wins when non-empty).
 * @param {Object} requestPacking - packing from request (may be empty)
 * @returns {Object} packing with defaults filled in
 */
const mergePackingWithDefaults = (requestPacking) => {
  const p = requestPacking || {};
  const parseDate = (v) => {
    if (v == null || v === '') return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  return {
    packingNumber: (p.packingNumber?.trim() || DEFAULT_PACKING.packingNumber).trim(),
    courierName: (p.courierName?.trim() || DEFAULT_PACKING.courierName).trim(),
    courierNumber: (p.courierNumber?.trim() || DEFAULT_PACKING.courierNumber).trim(),
    vehicleNumber: (p.vehicleNumber?.trim() || DEFAULT_PACKING.vehicleNumber).trim(),
    challanNumber: (p.challanNumber?.trim() || DEFAULT_PACKING.challanNumber).trim(),
    dispatchDate: parseDate(p.dispatchDate) ?? parseDate(DEFAULT_PACKING.dispatchDate),
    estimatedDeliveryDate: parseDate(p.estimatedDeliveryDate) ?? parseDate(DEFAULT_PACKING.estimatedDeliveryDate),
    notes: (p.notes?.trim() ?? DEFAULT_PACKING.notes).trim(),
  };
};

/**
 * Check if received data matches expected PO data for auto-approval.
 * @param {Object} purchaseOrder - Purchase order document
 * @param {Array} lots - Received lot details
 * @returns {boolean} - true if all data matches, false otherwise
 */
const checkDataMatch = (purchaseOrder, lots) => {
  if (!purchaseOrder || !lots || lots.length === 0) return false;

  // Check if all PO items have matching received quantities
  const poItemMap = new Map();
  purchaseOrder.poItems.forEach((item) => {
    poItemMap.set(item._id.toString(), item.quantity || 0);
  });

  const receivedQuantityMap = new Map();
  lots.forEach((lot) => {
    (lot.poItems || []).forEach((receivedItem) => {
      const poItemId = typeof receivedItem.poItem === 'string' 
        ? receivedItem.poItem 
        : receivedItem.poItem?.toString?.();
      const current = receivedQuantityMap.get(poItemId) || 0;
      receivedQuantityMap.set(poItemId, current + (Number(receivedItem.receivedQuantity) || 0));
    });
  });

  // Check if received quantities match ordered quantities (allow small floating point differences from Excel)
  for (const [poItemId, orderedQty] of poItemMap.entries()) {
    const receivedQty = receivedQuantityMap.get(poItemId) || 0;
    if (Math.abs(receivedQty - orderedQty) > 0.05) {
      return false;
    }
  }

  // Check if all lots have valid data (allow numberOfCones = 0)
  for (const lot of lots) {
    if (!lot.lotNumber || lot.totalWeight == null || lot.totalWeight === '' || !lot.numberOfBoxes) {
      return false;
    }
    if (lot.numberOfCones == null || lot.numberOfCones === '') {
      return false;
    }
  }

  return true;
};

/**
 * Step 1: Update PO to in_transit with packing details
 * @param {Object} params
 * @param {string} params.poNumber - PO number
 * @param {Object} params.packing - Packing details
 * @param {Array} params.lots - Lot details for calculating totals
 * @param {Object} params.updatedBy - { username, user_id }
 * @param {string} [params.notes] - Optional notes
 * @returns {Promise<Object>} - { success, message, purchaseOrder, packListEntry }
 */
export const updatePoToInTransit = async ({ poNumber, packing, lots, updatedBy, notes }) => {
  const purchaseOrder = await yarnPurchaseOrderService.getPurchaseOrderByPoNumber(poNumber);
  if (!purchaseOrder) {
    throw new Error(`Purchase order not found: ${poNumber}`);
  }

  const poId = purchaseOrder._id.toString();
  const allPoItemIds = new Set();
  let totalWeight = 0;
  let totalBoxes = 0;

  for (const lot of lots || []) {
    const poItems = (lot.poItems || []).map((item) => ({
      poItem: typeof item.poItem === 'string' ? item.poItem : item.poItem?.toString?.(),
      receivedQuantity: Number(item.receivedQuantity) || 0,
    })).filter((item) => item.poItem);
    poItems.forEach((item) => allPoItemIds.add(item.poItem));
    totalWeight += Number(lot.totalWeight) || 0;
    totalBoxes += Number(lot.numberOfBoxes) || 0;
  }

  const mergedPacking = mergePackingWithDefaults(packing);
  const packListEntry = {
    poItems: Array.from(allPoItemIds),
    packingNumber: mergedPacking.packingNumber || '',
    courierName: mergedPacking.courierName || '',
    courierNumber: mergedPacking.courierNumber || '',
    vehicleNumber: mergedPacking.vehicleNumber || '',
    challanNumber: mergedPacking.challanNumber || '',
    dispatchDate: mergedPacking.dispatchDate || undefined,
    estimatedDeliveryDate: mergedPacking.estimatedDeliveryDate || undefined,
    notes: mergedPacking.notes || '',
    totalWeight,
    numberOfBoxes: totalBoxes,
    files: [],
  };

  const existingPackList = purchaseOrder.packListDetails || [];
  const newPackList = [...existingPackList, packListEntry];

  await yarnPurchaseOrderService.updatePurchaseOrderById(poId, {
    packListDetails: newPackList,
  });

  await yarnPurchaseOrderService.updatePurchaseOrderStatus(
    poId,
    'in_transit',
    updatedBy,
    notes || undefined
  );

  const updatedPo = await yarnPurchaseOrderService.getPurchaseOrderById(poId);
  return {
    success: true,
    message: `Updated PO ${poNumber} to in_transit with packing details`,
    purchaseOrder: updatedPo,
    packListEntry,
  };
};

/**
 * Step 2: Add lot details to receivedLotDetails
 * @param {Object} params
 * @param {string} params.poNumber - PO number
 * @param {Array} params.lots - Lot details
 * @returns {Promise<Object>} - { success, message, purchaseOrder, receivedLotDetails }
 */
export const addLotDetails = async ({ poNumber, lots }) => {
  const purchaseOrder = await yarnPurchaseOrderService.getPurchaseOrderByPoNumber(poNumber);
  if (!purchaseOrder) {
    throw new Error(`Purchase order not found: ${poNumber}`);
  }

  const poId = purchaseOrder._id.toString();
  const receivedLotDetails = [];

  for (const lot of lots || []) {
    const poItems = (lot.poItems || []).map((item) => ({
      poItem: typeof item.poItem === 'string' ? item.poItem : item.poItem?.toString?.(),
      receivedQuantity: Number(item.receivedQuantity) || 0,
    })).filter((item) => item.poItem);

    receivedLotDetails.push({
      lotNumber: (lot.lotNumber || '').trim(),
      numberOfCones: Number(lot.numberOfCones) || 0,
      totalWeight: Number(lot.totalWeight) || 0,
      numberOfBoxes: Number(lot.numberOfBoxes) || 1,
      poItems,
      status: 'lot_pending',
    });
  }

  const existingReceivedLots = purchaseOrder.receivedLotDetails || [];
  const newReceivedLots = [...existingReceivedLots, ...receivedLotDetails];

  await yarnPurchaseOrderService.updatePurchaseOrderById(poId, {
    receivedLotDetails: newReceivedLots,
  });

  const updatedPo = await yarnPurchaseOrderService.getPurchaseOrderById(poId);
  return {
    success: true,
    message: `Added ${receivedLotDetails.length} lot(s) to PO ${poNumber}`,
    purchaseOrder: updatedPo,
    receivedLotDetails,
  };
};

/**
 * Step 3: Process/Generate barcodes (Create boxes)
 * @param {Object} params
 * @param {string} params.poNumber - PO number
 * @param {Array} params.lots - Lot details with numberOfBoxes
 * @returns {Promise<Object>} - { success, message, bulkResult }
 */
export const processBarcodes = async ({ poNumber, lots }) => {
  const lotDetailsForBulk = (lots || []).map((lot) => ({
    lotNumber: (lot.lotNumber || '').trim(),
    numberOfBoxes: Math.max(1, Number(lot.numberOfBoxes) || 1),
  }));

  const bulkResult = await yarnBoxService.bulkCreateYarnBoxes({
    poNumber,
    lotDetails: lotDetailsForBulk,
  });

  return {
    success: true,
    message: `Generated barcodes for PO ${poNumber}`,
    bulkResult,
    boxesCreated: bulkResult.createdCount || 0,
  };
};

/**
 * Step 4: Update box details (weight, cones, yarnName, shadeCode)
 * @param {Object} params
 * @param {string} params.poNumber - PO number
 * @param {Array} params.lots - Lot details with boxUpdates
 * @returns {Promise<Object>} - { success, message, boxesUpdated, errors }
 */
export const updateBoxDetails = async ({ poNumber, lots }) => {
  const lotNumbers = (lots || []).map((l) => (l.lotNumber || '').trim()).filter(Boolean);
  const boxesByLot =
    lotNumbers.length > 0
      ? await YarnBox.find({ poNumber, lotNumber: { $in: lotNumbers } })
          .sort({ lotNumber: 1, createdAt: 1 })
          .lean()
      : [];

  const lotToBoxes = new Map();
  for (const box of boxesByLot) {
    const lot = box.lotNumber || '';
    if (!lotToBoxes.has(lot)) lotToBoxes.set(lot, []);
    lotToBoxes.get(lot).push(box);
  }

  let updatedCount = 0;
  const errors = [];

  for (const lot of lots || []) {
    const lotNumber = (lot.lotNumber || '').trim();
    const boxUpdates = lot.boxUpdates || [];
    const boxes = lotToBoxes.get(lotNumber) || [];
    for (let i = 0; i < boxUpdates.length && i < boxes.length; i++) {
      const update = boxUpdates[i];
      const box = boxes[i];
      if (!box || !box._id) continue;
      try {
        await yarnBoxService.updateYarnBoxById(box._id.toString(), {
          yarnName: (update.yarnName || box.yarnName || '').trim() || box.yarnName,
          shadeCode: (update.shadeCode != null ? update.shadeCode : box.shadeCode)?.trim?.() ?? box.shadeCode,
          boxWeight: update.boxWeight != null ? Number(update.boxWeight) : box.boxWeight,
          numberOfCones: update.numberOfCones != null ? Number(update.numberOfCones) : box.numberOfCones,
        });
        updatedCount += 1;
      } catch (err) {
        errors.push({
          lotNumber,
          boxIndex: i,
          boxId: box.boxId,
          error: err.message || String(err),
        });
      }
    }
  }

  return {
    success: true,
    message: `Updated ${updatedCount} box(es) for PO ${poNumber}`,
    boxesUpdated: updatedCount,
    errors,
  };
};

/**
 * Step 5: Send for QC (Update lot status to lot_qc_pending)
 * @param {Object} params
 * @param {string} params.poNumber - PO number
 * @param {string} params.lotNumber - Lot number
 * @returns {Promise<Object>} - { success, message, purchaseOrder }
 */
export const sendForQc = async ({ poNumber, lotNumber }) => {
  const purchaseOrder = await yarnPurchaseOrderService.updateLotStatus(
    poNumber,
    lotNumber,
    'lot_qc_pending'
  );

  return {
    success: true,
    message: `Sent lot ${lotNumber} for QC`,
    purchaseOrder,
  };
};

/**
 * Step 7: Approve QC (Update lot status to lot_accepted)
 * @param {Object} params
 * @param {string} params.poNumber - PO number
 * @param {string} params.lotNumber - Lot number
 * @param {Object} params.updatedBy - { username, user_id }
 * @param {string} [params.notes] - Optional notes
 * @param {Object} [params.qcData] - QC data (remarks, mediaUrl)
 * @returns {Promise<Object>} - { success, message, result }
 */
export const approveQc = async ({ poNumber, lotNumber, updatedBy, notes, qcData }) => {
  const result = await yarnPurchaseOrderService.updateLotStatusAndQcApprove(
    poNumber,
    lotNumber,
    'lot_accepted',
    updatedBy,
    notes,
    qcData || {}
  );

  return {
    success: true,
    message: `QC approved for lot ${lotNumber}`,
    ...result,
  };
};

/**
 * Run the full receiving pipeline for one PO: pack list + in_transit → received lot details →
 * create boxes → update each box with weight/cones/yarn.
 * Excel flow: when data matches PO, auto-adds pack list (destuka), lot details, boxes and auto-approves QC.
 *
 * @param {Object} params
 * @param {string} params.poNumber - PO number (e.g. PO-2026-257)
 * @param {Object} params.packing - packingNumber, courierName, courierNumber, vehicleNumber, challanNumber, dispatchDate, estimatedDeliveryDate, notes
 * @param {Array} params.lots - [{ lotNumber, numberOfCones, totalWeight, numberOfBoxes, poItems: [{ poItem, receivedQuantity }], boxUpdates: [{ yarnName, shadeCode, boxWeight, numberOfCones }] }]
 * @param {Object} params.updatedBy - { username, user_id }
 * @param {string} [params.notes] - optional notes for status log
 * @param {boolean} [params.autoApproveQc] - if true and data matches, auto-approve QC (default true for Excel flow)
 * @returns {Promise<Object>} - { success, message, purchaseOrder, boxesCreated, boxesUpdated, errors }
 */
export const runReceivingPipelineForPo = async ({ poNumber, packing, lots, updatedBy, notes, autoApproveQc = true }) => {
  const result = {
    success: false,
    message: '',
    purchaseOrder: null,
    boxesCreated: 0,
    boxesUpdated: 0,
    errors: [],
  };

  if (!lots || lots.length === 0) {
    result.message = 'No lots provided';
    return result;
  }

  const purchaseOrder = await yarnPurchaseOrderService.getPurchaseOrderByPoNumber(poNumber);
  if (!purchaseOrder) {
    result.message = `Purchase order not found: ${poNumber}`;
    return result;
  }

  const poId = purchaseOrder._id.toString();
  const allPoItemIds = new Set();
  let totalWeight = 0;
  let totalBoxes = 0;
  const receivedLotDetails = [];
  const lotDetailsForBulk = [];

  for (const lot of lots) {
    const poItems = (lot.poItems || []).map((item) => ({
      poItem: typeof item.poItem === 'string' ? item.poItem : item.poItem?.toString?.(),
      receivedQuantity: Number(item.receivedQuantity) || 0,
    })).filter((item) => item.poItem);
    poItems.forEach((item) => allPoItemIds.add(item.poItem));
    totalWeight += Number(lot.totalWeight) || 0;
    totalBoxes += Number(lot.numberOfBoxes) || 0;
    receivedLotDetails.push({
      lotNumber: (lot.lotNumber || '').trim(),
      numberOfCones: Number(lot.numberOfCones) || 0,
      totalWeight: Number(lot.totalWeight) || 0,
      numberOfBoxes: Number(lot.numberOfBoxes) || 1,
      poItems,
      status: 'lot_pending',
    });
    lotDetailsForBulk.push({
      lotNumber: (lot.lotNumber || '').trim(),
      numberOfBoxes: Math.max(1, Number(lot.numberOfBoxes) || 1),
    });
  }

  const mergedPacking = mergePackingWithDefaults(packing);
  const packListEntry = {
    poItems: Array.from(allPoItemIds),
    packingNumber: mergedPacking.packingNumber || '',
    courierName: mergedPacking.courierName || '',
    courierNumber: mergedPacking.courierNumber || '',
    vehicleNumber: mergedPacking.vehicleNumber || '',
    challanNumber: mergedPacking.challanNumber || '',
    dispatchDate: mergedPacking.dispatchDate || undefined,
    estimatedDeliveryDate: mergedPacking.estimatedDeliveryDate || undefined,
    notes: mergedPacking.notes || '',
    totalWeight,
    numberOfBoxes: totalBoxes,
    files: [],
  };

  try {
    // Step 1a: PATCH PO with packListDetails and receivedLotDetails (both at root)
    const existingPackList = purchaseOrder.packListDetails || [];
    const existingReceivedLots = purchaseOrder.receivedLotDetails || [];
    const newPackList = [...existingPackList, packListEntry];
    const newReceivedLots = [...existingReceivedLots, ...receivedLotDetails];

    await yarnPurchaseOrderService.updatePurchaseOrderById(poId, {
      packListDetails: newPackList,
      receivedLotDetails: newReceivedLots,
    });

    // Step 1b: PATCH status to in_transit
    await yarnPurchaseOrderService.updatePurchaseOrderStatus(
      poId,
      'in_transit',
      updatedBy,
      notes || undefined
    );

    // Step 3: Create boxes (barcode generation)
    const bulkResult = await yarnBoxService.bulkCreateYarnBoxes({
      poNumber,
      lotDetails: lotDetailsForBulk,
    });

    result.boxesCreated = bulkResult.createdCount || 0;

    // Step 4: Update each box with yarnName, shadeCode, boxWeight, numberOfCones
    const lotNumbers = lots.map((l) => (l.lotNumber || '').trim()).filter(Boolean);
    const boxesByLot =
      lotNumbers.length > 0
        ? await YarnBox.find({ poNumber, lotNumber: { $in: lotNumbers } })
            .sort({ lotNumber: 1, createdAt: 1 })
            .lean()
        : [];

    const lotToBoxes = new Map();
    for (const box of boxesByLot) {
      const lot = box.lotNumber || '';
      if (!lotToBoxes.has(lot)) lotToBoxes.set(lot, []);
      lotToBoxes.get(lot).push(box);
    }

    let updatedCount = 0;
    for (const lot of lots) {
      const lotNumber = (lot.lotNumber || '').trim();
      const boxUpdates = lot.boxUpdates || [];
      const boxes = lotToBoxes.get(lotNumber) || [];
      for (let i = 0; i < boxUpdates.length && i < boxes.length; i++) {
        const update = boxUpdates[i];
        const box = boxes[i];
        if (!box || !box._id) continue;
        try {
          await yarnBoxService.updateYarnBoxById(box._id.toString(), {
            yarnName: (update.yarnName || box.yarnName || '').trim() || box.yarnName,
            shadeCode: (update.shadeCode != null ? update.shadeCode : box.shadeCode)?.trim?.() ?? box.shadeCode,
            boxWeight: update.boxWeight != null ? Number(update.boxWeight) : box.boxWeight,
            numberOfCones: update.numberOfCones != null ? Number(update.numberOfCones) : box.numberOfCones,
          });
          updatedCount += 1;
        } catch (err) {
          result.errors.push({
            lotNumber,
            boxIndex: i,
            boxId: box.boxId,
            error: err.message || String(err),
          });
        }
      }
    }
    result.boxesUpdated = updatedCount;

    // Step 5 & 7: Auto-approve QC if enabled and data matches
    if (autoApproveQc) {
      const purchaseOrderForCheck = await yarnPurchaseOrderService.getPurchaseOrderById(poId);
      const dataMatches = checkDataMatch(purchaseOrderForCheck, lots);
      
      if (dataMatches) {
        // Auto-approve all lots
        for (const lot of lots) {
          const lotNumber = (lot.lotNumber || '').trim();
          try {
            await yarnPurchaseOrderService.updateLotStatus(poNumber, lotNumber, 'lot_qc_pending');
            await yarnPurchaseOrderService.updateLotStatusAndQcApprove(
              poNumber,
              lotNumber,
              'lot_accepted',
              updatedBy,
              notes || 'Auto-approved: Data matches expected values',
              {}
            );
          } catch (err) {
            result.errors.push({
              step: 'auto_approve_qc',
              lotNumber,
              error: err.message || String(err),
            });
          }
        }
        result.message = `Processed PO ${poNumber}: ${result.boxesCreated} boxes created, ${result.boxesUpdated} boxes updated. QC auto-approved for matching data.`;
      } else {
        result.message = `Processed PO ${poNumber}: ${result.boxesCreated} boxes created, ${result.boxesUpdated} boxes updated. Data does not match - manual QC required.`;
      }
    } else {
      result.message = `Processed PO ${poNumber}: ${result.boxesCreated} boxes created, ${result.boxesUpdated} boxes updated.`;
    }

    const updatedPo = await yarnPurchaseOrderService.getPurchaseOrderById(poId);
    result.purchaseOrder = updatedPo;
    result.success = true;
    return result;
  } catch (err) {
    result.message = err.message || String(err);
    result.errors.push({ step: 'pipeline', error: result.message });
    return result;
  }
};

/**
 * Process from existing PO (single button: goods received + process).
 * If packListDetails and receivedLotDetails provided in request, updates PO first, then runs pipeline.
 * Otherwise uses PO's current packListDetails and receivedLotDetails.
 * Creates boxes, updates box details, auto-approves QC when data matches.
 *
 * @param {Object} params
 * @param {string} params.purchaseOrderId - MongoDB _id of PO
 * @param {Object} params.updatedBy - { username, user_id }
 * @param {Array} [params.packListDetails] - optional, update PO with this before processing
 * @param {Array} [params.receivedLotDetails] - optional, update PO with this before processing
 * @param {string} [params.notes]
 * @param {boolean} [params.autoApproveQc] - default true
 * @returns {Promise<Object>} - { success, message, purchaseOrder, boxesCreated, boxesUpdated, errors }
 */
export const processFromExistingPo = async ({
  purchaseOrderId,
  updatedBy,
  packListDetails: requestPackList,
  receivedLotDetails: requestReceivedLots,
  notes,
  autoApproveQc = true,
}) => {
  const result = {
    success: false,
    message: '',
    purchaseOrder: null,
    boxesCreated: 0,
    boxesUpdated: 0,
    errors: [],
  };

  let purchaseOrder = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);
  if (!purchaseOrder) {
    result.message = `Purchase order not found: ${purchaseOrderId}`;
    return result;
  }

  // If request provides packListDetails and/or receivedLotDetails, update PO first (merge with existing)
  if (
    (requestPackList && Array.isArray(requestPackList) && requestPackList.length > 0) ||
    (requestReceivedLots && Array.isArray(requestReceivedLots) && requestReceivedLots.length > 0)
  ) {
    const updateBody = {};
    if (requestPackList && requestPackList.length > 0) {
      updateBody.packListDetails = requestPackList;
    }
    if (requestReceivedLots && requestReceivedLots.length > 0) {
      updateBody.receivedLotDetails = requestReceivedLots;
    }
    await yarnPurchaseOrderService.updatePurchaseOrderById(purchaseOrderId, updateBody);
    purchaseOrder = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);
  }

  const poNumber = purchaseOrder.poNumber;
  const receivedLotDetails = purchaseOrder.receivedLotDetails || [];

  if (receivedLotDetails.length === 0) {
    result.message = 'No received lot details found. Save pack list and lot details first (PATCH PO).';
    return result;
  }

  // Convert receivedLotDetails to lots format (poItem as string for consistency)
  const lots = receivedLotDetails.map((lot) => ({
    lotNumber: (lot.lotNumber || '').trim(),
    numberOfCones: Number(lot.numberOfCones) || 0,
    totalWeight: Number(lot.totalWeight) || 0,
    numberOfBoxes: Math.max(1, Number(lot.numberOfBoxes) || 1),
    poItems: (lot.poItems || []).map((item) => ({
      poItem: typeof item.poItem === 'string' ? item.poItem : item.poItem?.toString?.(),
      receivedQuantity: Number(item.receivedQuantity) || 0,
    })).filter((item) => item.poItem),
    boxUpdates: [], // Will generate below
  }));

  // Generate boxUpdates from lot totals (distribute weight and cones across boxes)
  for (const lot of lots) {
    const n = Math.max(1, lot.numberOfBoxes);
    const perBoxWeight = (lot.totalWeight || 0) / n;
    const perBoxCones = Math.floor((lot.numberOfCones || 0) / n);
    const remainder = (lot.numberOfCones || 0) % n;
    for (let i = 0; i < n; i++) {
      lot.boxUpdates.push({
        boxWeight: perBoxWeight,
        numberOfCones: i < n - 1 ? perBoxCones : perBoxCones + remainder,
      });
    }
  }

  const lotDetailsForBulk = lots.map((l) => ({
    lotNumber: l.lotNumber,
    numberOfBoxes: l.numberOfBoxes,
  }));

  try {
    // Helper: auto-approve all lots (Send for QC + Approve QC) - no checkDataMatch gate
    const runQcAutoApprove = async () => {
      for (const lot of lots) {
        const lotNumber = lot.lotNumber;
        try {
          await yarnPurchaseOrderService.updateLotStatus(poNumber, lotNumber, 'lot_qc_pending');
          await yarnPurchaseOrderService.updateLotStatusAndQcApprove(
            poNumber,
            lotNumber,
            'lot_accepted',
            updatedBy,
            notes || 'Auto-approved: Process from PO',
            {}
          );
        } catch (err) {
          result.errors.push({ step: 'auto_approve_qc', lotNumber, error: err.message || String(err) });
        }
      }
    };

    // Check if boxes already exist for this PO (idempotency - don't duplicate)
    const existingBoxes = await YarnBox.countDocuments({ poNumber });
    if (existingBoxes > 0) {
      result.message = `PO ${poNumber} already has ${existingBoxes} boxes. Skipping box creation.`;
      result.purchaseOrder = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);
      result.success = true;
      // Always run QC auto-approve when enabled (no checkDataMatch - user confirmed by clicking Process)
      if (autoApproveQc) {
        await runQcAutoApprove();
        result.message += ' QC auto-approved.';
      }
      return result;
    }

    // Step 3: Create boxes
    const bulkResult = await yarnBoxService.bulkCreateYarnBoxes({
      poNumber,
      lotDetails: lotDetailsForBulk,
    });
    result.boxesCreated = bulkResult.createdCount || 0;

    // Step 4: Update box details with generated boxUpdates
    const lotNumbers = lots.map((l) => l.lotNumber).filter(Boolean);
    const boxesByLot =
      lotNumbers.length > 0
        ? await YarnBox.find({ poNumber, lotNumber: { $in: lotNumbers } })
            .sort({ lotNumber: 1, createdAt: 1 })
            .lean()
        : [];

    const lotToBoxes = new Map();
    for (const box of boxesByLot) {
      const lot = box.lotNumber || '';
      if (!lotToBoxes.has(lot)) lotToBoxes.set(lot, []);
      lotToBoxes.get(lot).push(box);
    }

    let updatedCount = 0;
    for (const lot of lots) {
      const lotNumber = lot.lotNumber;
      const boxUpdates = lot.boxUpdates || [];
      const boxes = lotToBoxes.get(lotNumber) || [];
      for (let i = 0; i < boxUpdates.length && i < boxes.length; i++) {
        const update = boxUpdates[i];
        const box = boxes[i];
        if (!box || !box._id) continue;
        try {
          await yarnBoxService.updateYarnBoxById(box._id.toString(), {
            yarnName: (update.yarnName || box.yarnName || '').trim() || box.yarnName,
            shadeCode: (update.shadeCode != null ? update.shadeCode : box.shadeCode)?.trim?.() ?? box.shadeCode,
            boxWeight: update.boxWeight != null ? Number(update.boxWeight) : box.boxWeight,
            numberOfCones: update.numberOfCones != null ? Number(update.numberOfCones) : box.numberOfCones,
          });
          updatedCount += 1;
        } catch (err) {
          result.errors.push({ lotNumber, boxIndex: i, boxId: box.boxId, error: err.message || String(err) });
        }
      }
    }
    result.boxesUpdated = updatedCount;

    // Step 5 & 7: Auto-approve QC (Send for QC + Approve) - works for both goods_received and goods_partially_received
    if (autoApproveQc) {
      await runQcAutoApprove();
      result.message = `Processed PO ${poNumber}: ${result.boxesCreated} boxes created, ${result.boxesUpdated} updated. QC auto-approved.`;
    } else {
      result.message = `Processed PO ${poNumber}: ${result.boxesCreated} boxes created, ${result.boxesUpdated} updated.`;
    }

    result.purchaseOrder = await yarnPurchaseOrderService.getPurchaseOrderById(purchaseOrderId);
    result.success = true;
    return result;
  } catch (err) {
    result.message = err.message || String(err);
    result.errors.push({ step: 'pipeline', error: result.message });
    return result;
  }
};

/**
 * Process receiving for multiple POs. Frontend sends array of { poNumber, packing, lots }.
 * Each item is run through runReceivingPipelineForPo.
 *
 * @param {Object} params
 * @param {Array<{ poNumber: string, packing: Object, lots: Array }>} params.items - one entry per PO
 * @param {Object} params.updatedBy - { username, user_id }
 * @param {string} [params.notes]
 * @returns {Promise<Object>} - { results: [...], summary: { total, success, failed } }
 */
export const processReceiving = async ({ items, updatedBy, notes }) => {
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
    const r = await runReceivingPipelineForPo({
      poNumber,
      packing: item.packing || {},
      lots: item.lots || [],
      updatedBy,
      notes: item.notes ?? notes,
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
  }

  return {
    results,
    summary: {
      total: results.length,
      success: successCount,
      failed: failCount,
    },
  };
};

/**
 * Process receiving step-by-step. Allows UI to process one step at a time.
 * @param {Object} params
 * @param {number} params.step - Step number (1-7)
 * @param {string} params.poNumber - PO number
 * @param {Object} [params.packing] - Packing details (for step 1)
 * @param {Array} [params.lots] - Lot details (for steps 1, 2, 3, 4)
 * @param {string} [params.lotNumber] - Lot number (for steps 5, 7)
 * @param {Object} [params.updatedBy] - { username, user_id }
 * @param {string} [params.notes] - Optional notes
 * @param {Object} [params.qcData] - QC data for step 7
 * @returns {Promise<Object>} - Step result
 */
export const processReceivingStepByStep = async ({ step, poNumber, packing, lots, lotNumber, updatedBy, notes, qcData }) => {
  switch (step) {
    case 1:
      return await updatePoToInTransit({ poNumber, packing, lots, updatedBy, notes });
    
    case 2:
      return await addLotDetails({ poNumber, lots });
    
    case 3:
      return await processBarcodes({ poNumber, lots });
    
    case 4:
      return await updateBoxDetails({ poNumber, lots });
    
    case 5:
      if (!lotNumber) {
        throw new Error('lotNumber is required for step 5');
      }
      return await sendForQc({ poNumber, lotNumber });
    
    case 6:
      // Step 6 is handled by existing GET /yarn-boxes/barcode/:barcode endpoint
      throw new Error('Step 6 (Get box by barcode) should use GET /yarn-boxes/barcode/:barcode endpoint');
    
    case 7:
      if (!lotNumber || !updatedBy) {
        throw new Error('lotNumber and updatedBy are required for step 7');
      }
      return await approveQc({ poNumber, lotNumber, updatedBy, notes, qcData });
    
    default:
      throw new Error(`Invalid step number: ${step}. Must be between 1-7.`);
  }
};
