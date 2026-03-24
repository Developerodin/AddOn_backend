import httpStatus from 'http-status';
import { VendorProductionFlow } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import { vendorProductionFlowSequence } from '../../models/vendorManagement/vendorProductionFlow.model.js';

/**
 * Syncs a VendorBox's units into the automated VendorProductionFlow.
 * Increments plannedQuantity and secondaryChecking.received based on quantityChange.
 * If no flow document exists for the VPO and Product, one is created.
 * @param {Object} box - The vendor box document
 * @param {number} quantityChange - Difference in units (positive for additions, negative for reductions)
 */
export const syncBoxToProductionFlow = async (box, quantityChange) => {
  if (!quantityChange) return;

  const filter = {
    vendor: box.vendor,
    vendorPurchaseOrder: box.vendorPurchaseOrderId,
    product: box.productId,
  };

  const update = {
    $inc: {
      plannedQuantity: quantityChange,
      'floorQuantities.secondaryChecking.received': quantityChange,
      'floorQuantities.secondaryChecking.remaining': quantityChange,
    },
    $setOnInsert: {
      currentFloorKey: 'secondaryChecking',
      referenceCode: box.lotNumber || box.vpoNumber,
    },
  };

  // Upsert the production flow document
  await VendorProductionFlow.findOneAndUpdate(filter, update, { upsert: true, new: true, setDefaultsOnInsert: true });
};

const allowedFloorKeys = new Set(['secondaryChecking', 'washing', 'boarding', 'branding', 'finalChecking']);

/**
 * Patch update for one vendor production floor.
 * @param {string} flowId
 * @param {string} floorKey
 * @param {Object} body
 */
export const updateVendorProductionFlowFloorById = async (flowId, floorKey, body) => {
  if (!allowedFloorKeys.has(floorKey)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid floor key');
  }

  const flow = await VendorProductionFlow.findById(flowId);
  if (!flow) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
  }

  const currentFloor = flow.floorQuantities?.[floorKey] || {};
  const patchableKeys = [
    'received',
    'completed',
    'remaining',
    'transferred',
    'm1Quantity',
    'm2Quantity',
    'm4Quantity',
    'm1Transferred',
    'm1Remaining',
    'm2Transferred',
    'm2Remaining',
    'repairStatus',
    'repairRemarks',
  ];

  patchableKeys.forEach((key) => {
    if (body[key] !== undefined) {
      currentFloor[key] = body[key];
    }
  });

  if (body.remaining === undefined) {
    const received = Number(currentFloor.received) || 0;
    const completed = Number(currentFloor.completed) || 0;
    const transferred = Number(currentFloor.transferred) || 0;
    currentFloor.remaining = Math.max(0, received - completed - transferred);
  }

  const currentIndex = vendorProductionFlowSequence.indexOf(floorKey);
  const nextFloorKey = currentIndex >= 0 ? vendorProductionFlowSequence[currentIndex + 1] : null;
  const shouldAutoTransfer = nextFloorKey && (body.autoTransferToNextFloor === true || body.completed !== undefined);
  if (shouldAutoTransfer) {
    const nextFloor = flow.floorQuantities?.[nextFloorKey] || {};
    const transferable = Math.max(0, Number(currentFloor.completed || 0) - Number(currentFloor.transferred || 0));
    if (transferable > 0) {
      currentFloor.transferred = Number(currentFloor.transferred || 0) + transferable;
      currentFloor.remaining = Math.max(
        0,
        Number(currentFloor.received || 0) - Number(currentFloor.completed || 0) - Number(currentFloor.transferred || 0)
      );

      nextFloor.received = Number(nextFloor.received || 0) + transferable;
      nextFloor.remaining = Number(nextFloor.remaining || 0) + transferable;

      flow.floorQuantities[nextFloorKey] = nextFloor;
      flow.currentFloorKey = nextFloorKey;
    }
  }

  flow.floorQuantities[floorKey] = currentFloor;
  if (!flow.currentFloorKey) {
    flow.currentFloorKey = 'secondaryChecking';
  }
  if (!flow.startedAt) {
    flow.startedAt = new Date();
  }

  await flow.save();
  return flow;
};

/**
 * Transfer quantity from one vendor floor to another.
 * For checking floors, transfer uses M1 pool.
 * @param {string} flowId
 * @param {string} fromFloorKey
 * @param {string} toFloorKey
 * @param {number} quantity
 */
export const transferVendorProductionFlowQuantity = async (flowId, fromFloorKey, toFloorKey, quantity) => {
  if (!allowedFloorKeys.has(fromFloorKey) || !allowedFloorKeys.has(toFloorKey)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid floor key');
  }
  if (fromFloorKey === toFloorKey) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Source and destination floor cannot be same');
  }

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Transfer quantity must be greater than 0');
  }

  const flow = await VendorProductionFlow.findById(flowId);
  if (!flow) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
  }

  const fromFloor = flow.floorQuantities?.[fromFloorKey];
  const toFloor = flow.floorQuantities?.[toFloorKey];
  if (!fromFloor || !toFloor) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Floor data not found');
  }

  const isCheckingFloor = fromFloorKey === 'secondaryChecking' || fromFloorKey === 'finalChecking';
  if (isCheckingFloor) {
    const availableM1 = Number(fromFloor.m1Quantity || 0) - Number(fromFloor.m1Transferred || 0);
    if (qty > availableM1) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Only ${Math.max(0, availableM1)} M1 quantity available to transfer`);
    }
    fromFloor.m1Transferred = Number(fromFloor.m1Transferred || 0) + qty;
    fromFloor.m1Remaining = Math.max(0, Number(fromFloor.m1Quantity || 0) - Number(fromFloor.m1Transferred || 0));
  } else {
    const available = Number(fromFloor.completed || 0) - Number(fromFloor.transferred || 0);
    if (qty > available) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Only ${Math.max(0, available)} quantity available to transfer`);
    }
  }

  fromFloor.transferred = Number(fromFloor.transferred || 0) + qty;
  fromFloor.remaining = Math.max(
    0,
    Number(fromFloor.received || 0) - Number(fromFloor.completed || 0) - Number(fromFloor.transferred || 0)
  );

  toFloor.received = Number(toFloor.received || 0) + qty;
  toFloor.remaining = Number(toFloor.remaining || 0) + qty;

  flow.currentFloorKey = toFloorKey;
  if (!flow.startedAt) {
    flow.startedAt = new Date();
  }

  await flow.save();
  return flow;
};
