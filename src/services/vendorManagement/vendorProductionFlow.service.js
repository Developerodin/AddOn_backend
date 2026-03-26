import httpStatus from 'http-status';
import { VendorProductionFlow } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';
import { RepairStatus } from '../../models/production/enums.js';
import { vendorProductionFlowSequence } from '../../models/vendorManagement/vendorProductionFlow.model.js';
import {
  assertAllowedFloorKey,
  assertForwardFloorMove,
  buildIncrementOps,
  buildReplaceOps,
  computeDerivedForFloor,
  computeRemainingForFloor,
  getNextFloorKey,
  pickFloorSnapshot,
  resolveMode,
  normalizeCheckingFloorSplitBody,
  assertValidFloorState,
  floorPath,
} from './vendorProductionFlowFloorPatch.js';

export const normalizeTransferBreakdownForReceipt = (rows, expectedTotal, fromFloorKey) => {
  if (!Array.isArray(rows)) return [];

  let remaining = Math.max(0, Number(expectedTotal || 0));
  const normalized = [];

  for (const row of rows) {
    if (remaining <= 0) break;
    const rawQty = Math.max(0, Number(row?.transferred || 0));
    if (rawQty <= 0) continue;

    const allocated = Math.min(rawQty, remaining);
    normalized.push({
      receivedStatusFromPreviousFloor: `transfer:${fromFloorKey}`,
      receivedTimestamp: new Date(),
      transferred: allocated,
      styleCode: String(row?.styleCode || ''),
      brand: String(row?.brand || ''),
    });
    remaining -= allocated;
  }

  if (remaining > 0) {
    normalized.push({
      receivedStatusFromPreviousFloor: `transfer:${fromFloorKey}`,
      receivedTimestamp: new Date(),
      transferred: remaining,
      styleCode: '',
      brand: '',
    });
  }

  return normalized;
};

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

  const qty = Number(quantityChange) || 0;
  if (qty <= 0) return;

  let flow = await VendorProductionFlow.findOne(filter);
  const lotNumber = box.lotNumber ? String(box.lotNumber) : '';
  const lotMarker = lotNumber ? `lot:${lotNumber}` : '';
  const lotEntry = {
    receivedStatusFromPreviousFloor: lotMarker || `box:${box.boxId || ''}`,
    lotNumber,
    boxId: box.boxId || '',
    receivedTimestamp: new Date(),
  };

  if (!flow) {
    flow = await VendorProductionFlow.create({
      ...filter,
      currentFloorKey: 'secondaryChecking',
      referenceCode: box.lotNumber || box.vpoNumber,
      plannedQuantity: qty,
      floorQuantities: {
        secondaryChecking: {
          received: qty,
          remaining: qty,
          receivedData: [lotEntry],
        },
      },
      startedAt: new Date(),
    });
    return flow;
  }

  flow.plannedQuantity = Number(flow.plannedQuantity || 0) + qty;
  const sc = flow.floorQuantities?.secondaryChecking || {};
  sc.received = Number(sc.received || 0) + qty;
  sc.remaining = Number(sc.remaining || 0) + qty;
  sc.receivedData = Array.isArray(sc.receivedData) ? sc.receivedData : [];

  const hasLotEntry = lotMarker
    ? sc.receivedData.some((entry) => String(entry?.lotNumber || '') === lotNumber)
    : false;
  if (!hasLotEntry) {
    sc.receivedData.push(lotEntry);
  }

  flow.floorQuantities.secondaryChecking = sc;
  if (!flow.currentFloorKey) {
    flow.currentFloorKey = 'secondaryChecking';
  }
  if (!flow.referenceCode) {
    flow.referenceCode = box.lotNumber || box.vpoNumber;
  }
  if (!flow.startedAt) {
    flow.startedAt = new Date();
  }
  await flow.save();
  return flow;
};

/**
 * Patch update for one vendor production floor.
 * @param {string} flowId
 * @param {string} floorKey
 * @param {Object} body
 */
export const updateVendorProductionFlowFloorById = async (flowId, floorKey, body) => {
  assertAllowedFloorKey(floorKey);

  if (body?.resetSecondaryChecking === true && floorKey !== 'secondaryChecking') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'resetSecondaryChecking is only valid for secondaryChecking');
  }

  const normalizedBody = normalizeCheckingFloorSplitBody(floorKey, body);

  const applyPatchUpdates = async (session = null) => {
    const sessionOptions = session ? { session } : undefined;
    let updatedFlow;
    const flowQuery = VendorProductionFlow.findById(flowId);
    const flow = session ? await flowQuery.session(session) : await flowQuery;
    if (!flow) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
    }

    const before = pickFloorSnapshot(flow, floorKey);

    const bodyForPatch = { ...normalizedBody };
    const hasTransferredBreakdown =
      (floorKey === 'branding' || floorKey === 'finalChecking') && Array.isArray(bodyForPatch?.transferredData);
    if (
      hasTransferredBreakdown &&
      bodyForPatch.completed === undefined &&
      bodyForPatch.completedDelta === undefined
    ) {
      const transferredDataTotal = bodyForPatch.transferredData.reduce(
        (sum, row) => sum + Math.max(0, Number(row?.transferred || 0)),
        0
      );
      if (resolveMode(bodyForPatch) === 'increment') {
        bodyForPatch.completedDelta = Math.max(0, transferredDataTotal - Number(before.completed || 0));
      } else {
        bodyForPatch.completed = transferredDataTotal;
      }
    }

    const mode = resolveMode(bodyForPatch);
    const shouldAutoTransfer = bodyForPatch?.autoTransferToNextFloor === true;

    if (bodyForPatch?.resetSecondaryChecking === true && floorKey === 'secondaryChecking') {
      const resetAfter = {
        ...before,
        received: before.received,
        completed: 0,
        transferred: 0,
        m1Quantity: 0,
        m2Quantity: 0,
        m4Quantity: 0,
        m1Transferred: 0,
        m2Transferred: 0,
        repairStatus: RepairStatus.NOT_REQUIRED,
        repairRemarks: '',
      };
      assertValidFloorState(floorKey, resetAfter);
      const derived = computeDerivedForFloor(floorKey, resetAfter);
      await VendorProductionFlow.updateOne(
        { _id: flowId },
        {
          $set: {
            [floorPath(floorKey, 'completed')]: 0,
            [floorPath(floorKey, 'transferred')]: 0,
            [floorPath(floorKey, 'm1Quantity')]: 0,
            [floorPath(floorKey, 'm2Quantity')]: 0,
            [floorPath(floorKey, 'm4Quantity')]: 0,
            [floorPath(floorKey, 'm1Transferred')]: 0,
            [floorPath(floorKey, 'm2Transferred')]: 0,
            [floorPath(floorKey, 'repairStatus')]: RepairStatus.NOT_REQUIRED,
            [floorPath(floorKey, 'repairRemarks')]: '',
            [floorPath(floorKey, 'receivedData')]: [],
            ...Object.fromEntries(Object.entries(derived).map(([k, v]) => [floorPath(floorKey, k), v])),
            currentFloorKey: flow.currentFloorKey || 'secondaryChecking',
            startedAt: flow.startedAt || new Date(),
          },
        },
        sessionOptions
      );
    } else if (mode === 'increment') {
      const ops = buildIncrementOps(floorKey, bodyForPatch);

      // Guard: reject negative deltas early (Joi should already enforce this, but keep it defensive).
      Object.values(ops.$inc || {}).forEach((v) => {
        if (Number(v) < 0) {
          throw new ApiError(httpStatus.BAD_REQUEST, 'Delta cannot be negative');
        }
      });

      const after = {
        ...before,
        received: before.received + (ops.$inc?.[floorPath(floorKey, 'received')] || 0),
        completed: before.completed + (ops.$inc?.[floorPath(floorKey, 'completed')] || 0),
        transferred: before.transferred + (ops.$inc?.[floorPath(floorKey, 'transferred')] || 0),
        m1Quantity: before.m1Quantity + (ops.$inc?.[floorPath(floorKey, 'm1Quantity')] || 0),
        m2Quantity: before.m2Quantity + (ops.$inc?.[floorPath(floorKey, 'm2Quantity')] || 0),
        m4Quantity: before.m4Quantity + (ops.$inc?.[floorPath(floorKey, 'm4Quantity')] || 0),
        repairStatus: ops.$set?.[floorPath(floorKey, 'repairStatus')] ?? before.repairStatus,
        repairRemarks: ops.$set?.[floorPath(floorKey, 'repairRemarks')] ?? before.repairRemarks,
      };

      assertValidFloorState(floorKey, after);
      const derived = computeDerivedForFloor(floorKey, after);

      await VendorProductionFlow.updateOne({ _id: flowId }, ops, sessionOptions);
      await VendorProductionFlow.updateOne(
        { _id: flowId },
        {
          $set: {
            ...Object.fromEntries(Object.entries(derived).map(([k, v]) => [floorPath(floorKey, k), v])),
            currentFloorKey: flow.currentFloorKey || 'secondaryChecking',
            startedAt: flow.startedAt || new Date(),
          },
        },
        sessionOptions
      );

      // Auto-transfer to next floor (uses updated "after" quantities)
      const nextFloorKey = getNextFloorKey(floorKey);
      const autoTransferTriggered =
        shouldAutoTransfer ||
        bodyForPatch?.completedDelta !== undefined ||
        bodyForPatch?.completed !== undefined;

      if (nextFloorKey && autoTransferTriggered) {
        const transferable = Math.max(0, after.completed - after.transferred);
        if (transferable > 0) {
          const nextBefore = pickFloorSnapshot(flow, nextFloorKey);
          const nextAfter = {
            ...nextBefore,
            received: nextBefore.received + transferable,
          };

          // transferred increments on current floor, received increments on next floor
          const nextDerived = computeDerivedForFloor(nextFloorKey, nextAfter);
          const curAfterTransfer = {
            ...after,
            transferred: after.transferred + transferable,
          };
          assertValidFloorState(floorKey, curAfterTransfer);
          assertValidFloorState(nextFloorKey, { ...nextAfter, ...nextDerived });

          await VendorProductionFlow.updateOne(
            { _id: flowId },
            {
              $inc: {
                [floorPath(floorKey, 'transferred')]: transferable,
                [floorPath(nextFloorKey, 'received')]: transferable,
              },
              $set: {
                [floorPath(floorKey, 'remaining')]: computeRemainingForFloor(floorKey, {
                  ...after,
                  transferred: after.transferred + transferable,
                }),
                [floorPath(nextFloorKey, 'remaining')]: nextDerived.remaining,
                currentFloorKey: nextFloorKey,
              },
            },
            sessionOptions
          );

          if (floorKey === 'branding' && nextFloorKey === 'finalChecking') {
            const receiptRows = normalizeTransferBreakdownForReceipt(
              bodyForPatch?.transferredData,
              transferable,
              floorKey
            );
            if (receiptRows.length > 0) {
              await VendorProductionFlow.updateOne(
                { _id: flowId },
                { $push: { [floorPath(nextFloorKey, 'receivedData')]: { $each: receiptRows } } },
                sessionOptions
              );
            }
          }
        }
      }
    } else {
      // Replace mode (backward compatible): apply explicit fields then recompute derived server-side.
      const ops = buildReplaceOps(floorKey, bodyForPatch);

      const after = {
        ...before,
        ...Object.fromEntries(
          Object.entries(ops.$set || {})
            .filter(([k]) => k.startsWith(`floorQuantities.${floorKey}.`))
            .map(([k, v]) => [k.split('.').slice(-1)[0], v])
        ),
      };

      assertValidFloorState(floorKey, after);
      const derived = computeDerivedForFloor(floorKey, after);

      await VendorProductionFlow.updateOne(
        { _id: flowId },
        {
          ...ops,
          $set: {
            ...(ops.$set || {}),
            ...Object.fromEntries(
              Object.entries(derived).map(([k, v]) => [floorPath(floorKey, k), v])
            ),
            currentFloorKey: flow.currentFloorKey || 'secondaryChecking',
            startedAt: flow.startedAt || new Date(),
          },
        },
        sessionOptions
      );

      const nextFloorKey = getNextFloorKey(floorKey);
      const autoTransferTriggered =
        nextFloorKey && (shouldAutoTransfer || bodyForPatch?.completed !== undefined);
      if (autoTransferTriggered) {
        const transferable = Math.max(0, Number(after.completed || 0) - Number(after.transferred || 0));
        if (transferable > 0) {
          const nextBefore = pickFloorSnapshot(flow, nextFloorKey);
          const nextAfter = {
            ...nextBefore,
            received: nextBefore.received + transferable,
          };
          assertValidFloorState(nextFloorKey, nextAfter);
          const nextDerived = computeDerivedForFloor(nextFloorKey, nextAfter);

          await VendorProductionFlow.updateOne(
            { _id: flowId },
            {
              $inc: {
                [floorPath(floorKey, 'transferred')]: transferable,
                [floorPath(nextFloorKey, 'received')]: transferable,
              },
              $set: {
                [floorPath(floorKey, 'remaining')]: computeRemainingForFloor(floorKey, {
                  ...after,
                  transferred: Number(after.transferred || 0) + transferable,
                }),
                [floorPath(nextFloorKey, 'remaining')]: nextDerived.remaining,
                currentFloorKey: nextFloorKey,
              },
            },
            sessionOptions
          );

          if (floorKey === 'branding' && nextFloorKey === 'finalChecking') {
            const receiptRows = normalizeTransferBreakdownForReceipt(
              bodyForPatch?.transferredData,
              transferable,
              floorKey
            );
            if (receiptRows.length > 0) {
              await VendorProductionFlow.updateOne(
                { _id: flowId },
                { $push: { [floorPath(nextFloorKey, 'receivedData')]: { $each: receiptRows } } },
                sessionOptions
              );
            }
          }
        }
      }
    }

    const updatedQuery = VendorProductionFlow.findById(flowId);
    updatedFlow = session ? await updatedQuery.session(session) : await updatedQuery;
    return updatedFlow;
  };

  const session = await VendorProductionFlow.startSession();
  try {
    let updatedFlow;
    try {
      await session.withTransaction(async () => {
        updatedFlow = await applyPatchUpdates(session);
      });
      return updatedFlow;
    } catch (error) {
      const message = String(error?.message || '');
      const isReplicaSetError =
        message.includes('Transaction numbers are only allowed on a replica set member or mongos');
      if (!isReplicaSetError) {
        throw error;
      }

      // Fallback for standalone MongoDB deployments that do not support transactions.
      return applyPatchUpdates(null);
    }
  } finally {
    session.endSession();
  }
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
  assertAllowedFloorKey(fromFloorKey);
  assertAllowedFloorKey(toFloorKey);
  if (fromFloorKey === toFloorKey) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Source and destination floor cannot be same');
  }

  assertForwardFloorMove(fromFloorKey, toFloorKey);

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Transfer quantity must be greater than 0');
  }

  const session = await VendorProductionFlow.startSession();
  try {
    let updatedFlow;
    await session.withTransaction(async () => {
      const flow = await VendorProductionFlow.findById(flowId).session(session);
      if (!flow) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
      }

      const fromBefore = pickFloorSnapshot(flow, fromFloorKey);
      const toBefore = pickFloorSnapshot(flow, toFloorKey);

      const isCheckingFloor = fromFloorKey === 'secondaryChecking' || fromFloorKey === 'finalChecking';
      if (isCheckingFloor) {
        const availableM1 = Math.max(0, Number(fromBefore.m1Quantity || 0) - Number(fromBefore.m1Transferred || 0));
        if (qty > availableM1) {
          throw new ApiError(httpStatus.BAD_REQUEST, `Only ${availableM1} M1 quantity available to transfer`);
        }
      } else {
        const available = Math.max(0, Number(fromBefore.completed || 0) - Number(fromBefore.transferred || 0));
        if (qty > available) {
          throw new ApiError(httpStatus.BAD_REQUEST, `Only ${available} quantity available to transfer`);
        }
      }

      const inc = {
        [floorPath(fromFloorKey, 'transferred')]: qty,
        [floorPath(toFloorKey, 'received')]: qty,
      };
      if (isCheckingFloor) {
        inc[floorPath(fromFloorKey, 'm1Transferred')] = qty;
      }

      // Apply increments
      await VendorProductionFlow.updateOne({ _id: flowId }, { $inc: inc }, { session });

      // Recompute derived on both floors
      const fromAfter = {
        ...fromBefore,
        transferred: Number(fromBefore.transferred || 0) + qty,
        m1Transferred: isCheckingFloor ? Number(fromBefore.m1Transferred || 0) + qty : fromBefore.m1Transferred,
      };
      const toAfter = {
        ...toBefore,
        received: Number(toBefore.received || 0) + qty,
      };

      assertValidFloorState(fromFloorKey, fromAfter);
      assertValidFloorState(toFloorKey, toAfter);

      const fromDerived = computeDerivedForFloor(fromFloorKey, fromAfter);
      const toDerived = computeDerivedForFloor(toFloorKey, toAfter);

      await VendorProductionFlow.updateOne(
        { _id: flowId },
        {
          $set: {
            ...Object.fromEntries(Object.entries(fromDerived).map(([k, v]) => [floorPath(fromFloorKey, k), v])),
            ...Object.fromEntries(Object.entries(toDerived).map(([k, v]) => [floorPath(toFloorKey, k), v])),
            currentFloorKey: toFloorKey,
            startedAt: flow.startedAt || new Date(),
          },
        },
        { session }
      );

      if (fromFloorKey === 'branding' && toFloorKey === 'finalChecking') {
        const receiptRows = normalizeTransferBreakdownForReceipt(
          fromBefore?.transferredData,
          qty,
          fromFloorKey
        );
        if (receiptRows.length > 0) {
          await VendorProductionFlow.updateOne(
            { _id: flowId },
            { $push: { [floorPath(toFloorKey, 'receivedData')]: { $each: receiptRows } } },
            { session }
          );
        }
      }

      updatedFlow = await VendorProductionFlow.findById(flowId).session(session);
    });

    return updatedFlow;
  } finally {
    session.endSession();
  }
};

/**
 * Final confirm: move pending final-checking qty to dispatch and mark order completed.
 * @param {string} flowId
 * @param {string} [remarks]
 */
export const confirmVendorProductionFlowById = async (flowId, remarks) => {
  const flow = await VendorProductionFlow.findById(flowId);
  if (!flow) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
  }

  const finalChecking = flow.floorQuantities?.finalChecking || {};
  const dispatch = flow.floorQuantities?.dispatch || {};

  const pendingToDispatch = Math.max(0, Number(finalChecking.completed || 0) - Number(finalChecking.transferred || 0));
  if (pendingToDispatch > 0) {
    finalChecking.transferred = Number(finalChecking.transferred || 0) + pendingToDispatch;
    finalChecking.remaining = Math.max(
      0,
      Number(finalChecking.received || 0) - Number(finalChecking.completed || 0) - Number(finalChecking.transferred || 0)
    );
    finalChecking.m1Transferred = Number(finalChecking.m1Transferred || 0) + pendingToDispatch;
    finalChecking.m1Remaining = Math.max(0, Number(finalChecking.m1Quantity || 0) - Number(finalChecking.m1Transferred || 0));

    dispatch.received = Number(dispatch.received || 0) + pendingToDispatch;
    dispatch.remaining = Number(dispatch.remaining || 0) + pendingToDispatch;
  }

  dispatch.completed = Number(dispatch.received || 0);
  dispatch.remaining = Math.max(
    0,
    Number(dispatch.received || 0) - Number(dispatch.completed || 0) - Number(dispatch.transferred || 0)
  );

  flow.floorQuantities.finalChecking = finalChecking;
  flow.floorQuantities.dispatch = dispatch;
  flow.currentFloorKey = 'dispatch';
  flow.finalQualityConfirmed = true;
  flow.completedAt = new Date();
  if (!flow.startedAt) {
    flow.startedAt = new Date();
  }
  if (remarks !== undefined) {
    flow.remarks = remarks;
  }

  await flow.save();
  return flow;
};

/**
 * Send M2 quantity from finalChecking to a rework floor.
 * @param {string} flowId
 * @param {'washing'|'boarding'|'branding'} toFloorKey
 * @param {number} quantity
 */
export const transferFinalCheckingM2ForRework = async (flowId, toFloorKey, quantity) => {
  const allowedReworkFloors = new Set(['washing', 'boarding', 'branding']);
  if (!allowedReworkFloors.has(toFloorKey)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'M2 can be transferred only to washing, boarding, or branding');
  }

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Transfer quantity must be greater than 0');
  }

  const flow = await VendorProductionFlow.findById(flowId);
  if (!flow) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
  }

  const finalChecking = flow.floorQuantities?.finalChecking || {};
  const target = flow.floorQuantities?.[toFloorKey] || {};

  const availableM2 = Math.max(0, Number(finalChecking.m2Quantity || 0) - Number(finalChecking.m2Transferred || 0));
  if (qty > availableM2) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Only ${availableM2} M2 quantity is available for transfer`);
  }

  finalChecking.m2Transferred = Number(finalChecking.m2Transferred || 0) + qty;
  finalChecking.m2Remaining = Math.max(0, Number(finalChecking.m2Quantity || 0) - Number(finalChecking.m2Transferred || 0));

  // Rework quantity arrives as repair workload on selected floor.
  target.repairReceived = Number(target.repairReceived || 0) + qty;
  target.remaining = Number(target.remaining || 0) + qty;

  flow.floorQuantities.finalChecking = finalChecking;
  flow.floorQuantities[toFloorKey] = target;
  flow.currentFloorKey = toFloorKey;
  if (!flow.startedAt) {
    flow.startedAt = new Date();
  }

  await flow.save();
  return flow;
};

/**
 * Backfill `finalChecking.receivedData` from `branding.transferredData` for flows
 * where quantity was transferred before the server copied line-level rows (same
 * rules as live transfer). Only updates documents with `finalChecking.received > 0`
 * and empty/missing `finalChecking.receivedData`.
 *
 * @param {{ dryRun?: boolean }} [options]
 * @returns {Promise<{ examined: number, modified: number, dryRun: boolean }>}
 */
export const backfillFinalCheckingReceivedDataFromBranding = async (options = {}) => {
  const { dryRun = false } = options;
  const filter = {
    'floorQuantities.finalChecking.received': { $gt: 0 },
    $or: [
      { 'floorQuantities.finalChecking.receivedData': { $exists: false } },
      { 'floorQuantities.finalChecking.receivedData': { $size: 0 } },
    ],
  };

  const cursor = VendorProductionFlow.find(filter).cursor();
  let examined = 0;
  let modified = 0;

  for await (const flow of cursor) {
    examined += 1;
    const fc = flow.floorQuantities?.finalChecking || {};
    const branding = flow.floorQuantities?.branding || {};
    const expectedTotal = Math.max(0, Number(fc.received || 0));
    const rows = Array.isArray(branding.transferredData) ? branding.transferredData : [];
    const receiptRows = normalizeTransferBreakdownForReceipt(rows, expectedTotal, 'branding');
    if (receiptRows.length === 0) continue;

    if (!dryRun) {
      await VendorProductionFlow.updateOne(
        { _id: flow._id },
        { $set: { 'floorQuantities.finalChecking.receivedData': receiptRows } }
      );
    }
    modified += 1;
  }

  return { examined, modified, dryRun };
};
