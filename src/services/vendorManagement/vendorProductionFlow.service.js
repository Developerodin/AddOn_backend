import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { VendorProductionFlow } from '../../models/index.js';
import Product from '../../models/product.model.js';
import ApiError from '../../utils/ApiError.js';
import { RepairStatus } from '../../models/production/enums.js';
import { vendorProductionFlowSequence } from '../../models/vendorManagement/vendorProductionFlow.model.js';
import { tryAutoIssueFromFlow } from './vendorGrn.service.js';
import { recordVendorM2Entry } from './vendorM2Management.service.js';
import { recordVendorM3Entry } from './vendorM3Management.service.js';
import { recordVendorM4Entry } from './vendorM4Management.service.js';
import {
  assertAllowedFloorKey,
  assertForwardFloorMove,
  buildIncrementOps,
  buildReplaceOps,
  computeDerivedForFloor,
  getNextFloorKey,
  resolveVendorNextFloorKey,
  pickFloorSnapshot,
  resolveMode,
  normalizeCheckingFloorSplitBody,
  stripSecondaryCheckingServerDerivedFields,
  assertValidFloorState,
  computeCompletedBasedTransferableForFloor,
  floorPath,
  toFiniteNumber,
} from './vendorProductionFlowFloorPatch.js';
import { stageVendorTransferOnExistingContainer } from './vendorProductionFlowReceive.service.js';
import { transferVendorDispatchToWarehouseQuantity } from './vendorDispatchWarehouseTransfer.service.js';
import {
  aggregateTransferredByStyleKey,
  mergeTransferredDataByStyleKey,
  parseVendorStyleKey,
  splitIntegerByWeights,
} from '../../utils/vendorStyleQuantity.util.js';
import {
  assertSaneBoxUnitQty,
  ensureSecondaryCheckingFlowForBox,
  flowFilterFromBox,
  reconcileSecondaryCheckingFromBoxes,
} from './vendorProductionFlowBoxReconcile.util.js';

const VENDOR_CHECKING_FLOORS = new Set(['secondaryChecking', 'finalChecking']);

/** True when this patch increases / sets higher M1 split — then we auto-forward along the M1 lane. */
function shouldPreferM1AutoTransferOnPatch(floorKey, mode, bodyForPatch, before, after) {
  if (!VENDOR_CHECKING_FLOORS.has(floorKey)) return false;
  if (mode === 'increment') return toFiniteNumber(bodyForPatch?.m1Delta, 0) > 0;
  if (bodyForPatch?.m1Quantity === undefined) return false;
  return after.m1Quantity > before.m1Quantity;
}

function computeM1PoolTransferableForCheckingFloor(after, floorKey) {
  const m1Avail = Math.max(0, after.m1Quantity - after.m1Transferred);
  /** Final checking: forward M1 along pipeline (transferred ≤ completed), not disjoint completed+transferred vs received. */
  if (floorKey === 'finalChecking') {
    const pending = Math.max(0, after.completed - after.transferred);
    return Math.min(m1Avail, pending);
  }
  if (floorKey === 'secondaryChecking') {
    return m1Avail;
  }
  const aggRoom = Math.max(0, after.received - after.completed - after.transferred);
  return Math.min(m1Avail, aggRoom);
}

/**
 * After a floor patch, optionally push quantity to the next floor (same rules as manual transfer for M1).
 */
async function maybeAutoTransferVendorFloor(
  flowId,
  flow,
  floorKey,
  before,
  after,
  bodyForPatch,
  mode,
  sessionOptions
) {
  if (
    floorKey === 'branding' &&
    bodyForPatch?.autoTransferToNextFloor === true &&
    flow?.brandingType !== 'Heat Transfer' &&
    flow?.brandingType !== 'Embroidery'
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Select branding type (Heat Transfer or Embroidery) before staging to the next floor.'
    );
  }

  const nextFloorKey = resolveVendorNextFloorKey(floorKey, flow?.brandingType);
  if (!nextFloorKey) return;

  const shouldAutoTransfer = bodyForPatch?.autoTransferToNextFloor === true;
  /** Saving style/brand lines should still run forward pass when completed delta is 0 (e.g. totals unchanged). */
  const transferredDataPatch =
    (floorKey === 'branding' || floorKey === 'reBoarding' || floorKey === 'finalChecking') &&
    Array.isArray(bodyForPatch?.transferredData) &&
    bodyForPatch.transferredData.length > 0;

  const completedAuto =
    shouldAutoTransfer ||
    bodyForPatch?.completedDelta !== undefined ||
    bodyForPatch?.completed !== undefined ||
    transferredDataPatch;

  const preferM1 = shouldPreferM1AutoTransferOnPatch(floorKey, mode, bodyForPatch, before, after);

  let transferable = 0;
  let bumpM1Transferred = false;
  if (preferM1) {
    const m1T = computeM1PoolTransferableForCheckingFloor(after, floorKey);
    if (m1T > 0) {
      transferable = m1T;
      bumpM1Transferred = true;
    }
  }
  if (transferable === 0 && completedAuto) {
    transferable = computeCompletedBasedTransferableForFloor(floorKey, after);
    bumpM1Transferred = false;
  }

  if (transferable <= 0) return;

  const isChecking = VENDOR_CHECKING_FLOORS.has(floorKey);
  const nextBefore = pickFloorSnapshot(flow, nextFloorKey);

  /**
   * Container legs: SC→branding, branding→reBoarding, branding→FC, reBoarding→FC,
   * optional FC→dispatch when `existingContainerBarcode` is sent.
   */
  const containerLeg =
    (floorKey === 'secondaryChecking' && nextFloorKey === 'branding') ||
    (floorKey === 'branding' && (nextFloorKey === 'reBoarding' || nextFloorKey === 'finalChecking')) ||
    (floorKey === 'reBoarding' && nextFloorKey === 'finalChecking');
  const fcDispatchStaging =
    floorKey === 'finalChecking' && nextFloorKey === 'dispatch' && bodyForPatch?.existingContainerBarcode;
  const usesContainer = containerLeg || fcDispatchStaging;

  if (containerLeg) {
    const bc = bodyForPatch?.existingContainerBarcode;
    if (!bc || !String(bc).trim()) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'existingContainerBarcode is required when auto-transferring to the next floor (secondary→branding, branding→re-boarding/final checking, or re-boarding→final checking). Use a container that already exists.'
      );
    }
  }

  const inc = {
    [floorPath(floorKey, 'transferred')]: transferable,
  };
  if (!usesContainer) {
    inc[floorPath(nextFloorKey, 'received')] = transferable;
  }
  /** Match manual transfer / confirm: final → dispatch counts against M1 transferred. */
  const bumpM1Lane =
    isChecking &&
    (bumpM1Transferred || (floorKey === 'finalChecking' && nextFloorKey === 'dispatch'));
  if (bumpM1Lane) {
    inc[floorPath(floorKey, 'm1Transferred')] = transferable;
  }

  const curAfterTransfer = {
    ...after,
    transferred: after.transferred + transferable,
    m1Transferred: bumpM1Lane ? after.m1Transferred + transferable : after.m1Transferred,
  };
  const nextAfter = usesContainer
    ? { ...nextBefore }
    : {
        ...nextBefore,
        received: nextBefore.received + transferable,
      };

  assertValidFloorState(floorKey, curAfterTransfer);
  assertValidFloorState(nextFloorKey, nextAfter);

  const fromDerived = computeDerivedForFloor(floorKey, curAfterTransfer);
  const skipNextDerived = fcDispatchStaging;
  const nextDerived = skipNextDerived ? {} : computeDerivedForFloor(nextFloorKey, nextAfter);

  const session = sessionOptions?.session;

  await VendorProductionFlow.updateOne(
    { _id: flowId },
    {
      $inc: inc,
      $set: {
        ...Object.fromEntries(Object.entries(fromDerived).map(([k, v]) => [floorPath(floorKey, k), v])),
        ...(Object.keys(nextDerived).length > 0
          ? Object.fromEntries(Object.entries(nextDerived).map(([k, v]) => [floorPath(nextFloorKey, k), v]))
          : {}),
        currentFloorKey: usesContainer ? flow.currentFloorKey || floorKey : nextFloorKey,
        startedAt: flow.startedAt || new Date(),
      },
    },
    sessionOptions
  );

  if (usesContainer) {
    const receiptRows = normalizeTransferBreakdownForReceipt(
      bodyForPatch?.transferredData,
      transferable,
      floorKey
    );
    const transferItemsForContainer =
      nextFloorKey === 'reBoarding' || nextFloorKey === 'finalChecking' || nextFloorKey === 'dispatch'
        ? receiptRows.map((r) => ({
            transferred: r.transferred,
            styleCode: r.styleCode,
            brand: r.brand,
          }))
        : undefined;

    /**
     * Branding / re-boarding → next container leg: only $push breakdown rows when the floor patch did **not**
     * already persist `transferredData`. Replace/increment handlers $set `floorQuantities.<floor>.transferredData`
     * from the body; pushing here would duplicate the same lines (e.g. one PATCH with mode replace + autoTransfer).
     */
    const patchAlreadyWroteTransferredData =
      Array.isArray(bodyForPatch?.transferredData) && bodyForPatch.transferredData.length > 0;
    if (
      (floorKey === 'branding' || floorKey === 'reBoarding') &&
      (nextFloorKey === 'reBoarding' || nextFloorKey === 'finalChecking') &&
      transferItemsForContainer?.length &&
      !patchAlreadyWroteTransferredData
    ) {
      await VendorProductionFlow.updateOne(
        { _id: flowId },
        {
          $push: {
            [floorPath(floorKey, 'transferredData')]: { $each: transferItemsForContainer },
          },
        },
        sessionOptions
      );
    }

    await stageVendorTransferOnExistingContainer({
      barcode: String(bodyForPatch.existingContainerBarcode).trim(),
      flowId: flowId.toString(),
      quantity: transferable,
      toFloorKey: nextFloorKey,
      transferItems: transferItemsForContainer,
      session,
    });
  }
}

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
 * Syncs a vendor box into its production flow by reconciling from boxes (source of truth).
 * Validates positive deltas; negative deltas skip validation and still reconcile.
 * @param {Object} box - The vendor box document
 * @param {number} [quantityChange] - Optional delta hint; positive values are sanity-checked
 * @returns {Promise<object|null>} Reconciled flow or null
 */
export const syncBoxToProductionFlow = async (box, quantityChange = 0) => {
  const rawQty = Number(quantityChange) || 0;
  if (rawQty > 0) {
    assertSaneBoxUnitQty(rawQty);
  }

  await ensureSecondaryCheckingFlowForBox(box);
  return reconcileSecondaryCheckingFromBoxes(flowFilterFromBox(box));
};

/**
 * Reverse a box's contribution by re-reconciling from remaining vendor boxes.
 * @param {Object} box - VendorBox-like doc (vendor, vendorPurchaseOrderId, productId)
 * @returns {Promise<object|null>} Reconciled flow or null
 */
export const reverseBoxFromProductionFlow = async (box) => {
  const filter = flowFilterFromBox(box);
  const flow = await VendorProductionFlow.findOne(filter);
  if (!flow) return null;
  return reconcileSecondaryCheckingFromBoxes(filter);
};

/**
 * Set the branding method on a vendor flow (chosen on the Branding floor). Drives whether the
 * article routes branding → reBoarding → finalChecking (Embroidery) or branding → finalChecking
 * (Heat Transfer). See {@link ./vendorProductionFlowFloorPatch.js} `resolveVendorNextFloorKey`.
 * @param {string} flowId
 * @param {'Heat Transfer'|'Embroidery'} brandingType
 * @returns {Promise<Object>}
 */
export const updateVendorBrandingType = async (flowId, brandingType) => {
  if (!mongoose.Types.ObjectId.isValid(String(flowId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid flow id');
  }
  if (brandingType !== 'Heat Transfer' && brandingType !== 'Embroidery') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'brandingType must be Heat Transfer or Embroidery');
  }
  const flow = await VendorProductionFlow.findById(flowId);
  if (!flow) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
  }
  flow.brandingType = brandingType;
  await flow.save();
  return flow.toJSON ? flow.toJSON() : flow;
};

/**
 * Patch update for one vendor production floor.
 * @param {string} flowId
 * @param {string} floorKey
 * @param {Object} body
 * @param {Object} [reqUser] - optional user for GRN auto-issue hook
 */
export const updateVendorProductionFlowFloorById = async (flowId, floorKey, body, reqUser = null) => {
  assertAllowedFloorKey(floorKey);

  if (body?.resetSecondaryChecking === true && floorKey !== 'secondaryChecking') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'resetSecondaryChecking is only valid for secondaryChecking');
  }

  let normalizedBody = normalizeCheckingFloorSplitBody(floorKey, body);
  if (floorKey === 'secondaryChecking') {
    normalizedBody = stripSecondaryCheckingServerDerivedFields(normalizedBody);
  }

  let beforeFloorSnapshot = null;

  const applyPatchUpdates = async (session = null) => {
    const sessionOptions = session ? { session } : undefined;
    let updatedFlow;
    const flowQuery = VendorProductionFlow.findById(flowId);
    const flow = session ? await flowQuery.session(session) : await flowQuery;
    if (!flow) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
    }

    const before = pickFloorSnapshot(flow, floorKey);
    beforeFloorSnapshot = before;

    const bodyForPatch = { ...normalizedBody };

    /**
     * Branding / final checking: when `transferredData` is present, counters are **server-owned**.
     * - Merge keyed lines by style+brand (add qty); unkeyed rows append.
     * - `completed` and `transferred` = sum(lines); `remaining` is derived (never taken from client).
     * - Client values for those fields are stripped.
     */
    if (
      (floorKey === 'branding' || floorKey === 'reBoarding' || floorKey === 'finalChecking' || floorKey === 'dispatch') &&
      bodyForPatch.transferredData !== undefined
    ) {
      if (!Array.isArray(bodyForPatch.transferredData)) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'transferredData must be an array');
      }
      const prior = flow.floorQuantities?.[floorKey]?.transferredData;
      if (bodyForPatch.transferredData.length > 0) {
        bodyForPatch.transferredData = mergeTransferredDataByStyleKey(prior, bodyForPatch.transferredData);
      }

      delete bodyForPatch.completed;
      delete bodyForPatch.remaining;
      delete bodyForPatch.transferred;
      delete bodyForPatch.completedDelta;
      delete bodyForPatch.transferredDelta;

      const lineSum = bodyForPatch.transferredData.reduce(
        (sum, row) => sum + Math.max(0, Number(row?.transferred || 0)),
        0
      );
      const receivedCap = toFiniteNumber(
        bodyForPatch.received !== undefined ? bodyForPatch.received : before.received,
        0
      );
      if (lineSum > receivedCap) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Sum of transferredData (${lineSum}) cannot exceed received (${receivedCap}) on ${floorKey}`
        );
      }
      if (bodyForPatch.transferredData.length === 0) {
        bodyForPatch.completed = 0;
        bodyForPatch.transferred = 0;
      } else {
        /** Style-line total = completed; keep scalar `transferred` until maybeAutoTransfer $inc catches up (pipeline). */
        bodyForPatch.completed = lineSum;
        bodyForPatch.transferred = toFiniteNumber(before.transferred, 0);
      }
    }

    const mode = resolveMode(bodyForPatch);

    if (bodyForPatch?.resetSecondaryChecking === true && floorKey === 'secondaryChecking') {
      const resetAfter = {
        ...before,
        received: before.received,
        completed: 0,
        transferred: 0,
        m1Quantity: 0,
        m2Quantity: 0,
        m3Quantity: 0,
        vm4Quantity: 0,
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
            [floorPath(floorKey, 'm3Quantity')]: 0,
            [floorPath(floorKey, 'vm4Quantity')]: 0,
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
        transferred: before.transferred + (ops.$inc?.[floorPath(floorKey, 'transferred')] || 0),
        m1Quantity: before.m1Quantity + (ops.$inc?.[floorPath(floorKey, 'm1Quantity')] || 0),
        m2Quantity: before.m2Quantity + (ops.$inc?.[floorPath(floorKey, 'm2Quantity')] || 0),
        m3Quantity: before.m3Quantity + (ops.$inc?.[floorPath(floorKey, 'm3Quantity')] || 0),
        m4Quantity: before.m4Quantity + (ops.$inc?.[floorPath(floorKey, 'm4Quantity')] || 0),
        vm4Quantity:
          (before.vm4Quantity ?? before.m4Quantity ?? 0) +
          (ops.$inc?.[floorPath(floorKey, 'vm4Quantity')] || 0),
        repairStatus: ops.$set?.[floorPath(floorKey, 'repairStatus')] ?? before.repairStatus,
        repairRemarks: ops.$set?.[floorPath(floorKey, 'repairRemarks')] ?? before.repairRemarks,
      };
      if (floorKey === 'secondaryChecking') {
        after.completed = after.m1Quantity;
      } else {
        after.completed = before.completed + (ops.$inc?.[floorPath(floorKey, 'completed')] || 0);
        const setCompleted = ops.$set?.[floorPath(floorKey, 'completed')];
        if (setCompleted !== undefined) {
          after.completed = toFiniteNumber(setCompleted, 0);
        }
      }
      const setTransferred = ops.$set?.[floorPath(floorKey, 'transferred')];
      if (setTransferred !== undefined) {
        after.transferred = toFiniteNumber(setTransferred, 0);
      }

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

      await maybeAutoTransferVendorFloor(
        flowId,
        flow,
        floorKey,
        before,
        after,
        bodyForPatch,
        mode,
        sessionOptions
      );
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
      if (floorKey === 'secondaryChecking') {
        after.completed = after.m1Quantity;
      }

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

      await maybeAutoTransferVendorFloor(
        flowId,
        flow,
        floorKey,
        before,
        after,
        bodyForPatch,
        mode,
        sessionOptions
      );
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
    } catch (error) {
      const message = String(error?.message || '');
      const isReplicaSetError =
        message.includes('Transaction numbers are only allowed on a replica set member or mongos');
      if (!isReplicaSetError) {
        throw error;
      }

      // Fallback for standalone MongoDB deployments that do not support transactions.
      updatedFlow = await applyPatchUpdates(null);
    }

    if (floorKey === 'secondaryChecking' && updatedFlow && reqUser) {
      try {
        await tryAutoIssueFromFlow(flowId, reqUser);
      } catch (grnErr) {
        // Floor patch succeeded — GRN auto-issue is best-effort.
        console.error('[vendorGrn] auto-issue failed:', grnErr?.message || grnErr);
      }
    }

    if (updatedFlow && VENDOR_CHECKING_FLOORS.has(floorKey) && beforeFloorSnapshot) {
      const afterSnap = pickFloorSnapshot(updatedFlow, floorKey);

      /** M2 ledger entry when M2 classified qty increases on this checking floor. */
      const m2Delta = afterSnap.m2Quantity - beforeFloorSnapshot.m2Quantity;
      if (m2Delta > 0) {
        try {
          await recordVendorM2Entry({
            flow: updatedFlow,
            sourceFloor: floorKey,
            deltaQuantity: m2Delta,
            previousFloorTotal: beforeFloorSnapshot.m2Quantity,
            newFloorTotal: afterSnap.m2Quantity,
            user: reqUser,
          });
        } catch (m2LogErr) {
          console.error('[vendorM2] ledger hook failed:', m2LogErr?.message || m2LogErr);
        }
      }

      /** M3 ledger entry — applies on both secondary checking and final checking. */
      const m3Delta = afterSnap.m3Quantity - beforeFloorSnapshot.m3Quantity;
      if (m3Delta > 0) {
        try {
          await recordVendorM3Entry({
            flow: updatedFlow,
            sourceFloor: floorKey,
            deltaQuantity: m3Delta,
            previousFloorTotal: beforeFloorSnapshot.m3Quantity,
            newFloorTotal: afterSnap.m3Quantity,
            user: reqUser,
          });
        } catch (m3LogErr) {
          console.error('[vendorM3] ledger hook failed:', m3LogErr?.message || m3LogErr);
        }
      }

      /** M4 ledger entry — only final checking carries M4 (secondary checking uses VM4 for vendor returns). */
      if (floorKey === 'finalChecking') {
        const m4Delta = afterSnap.m4Quantity - beforeFloorSnapshot.m4Quantity;
        if (m4Delta > 0) {
          try {
            await recordVendorM4Entry({
              flow: updatedFlow,
              sourceFloor: floorKey,
              deltaQuantity: m4Delta,
              previousFloorTotal: beforeFloorSnapshot.m4Quantity,
              newFloorTotal: afterSnap.m4Quantity,
              user: reqUser,
            });
          } catch (m4LogErr) {
            console.error('[vendorM4] ledger hook failed:', m4LogErr?.message || m4LogErr);
          }
        }
      }
    }

    return updatedFlow;
  } finally {
    session.endSession();
  }
};

/**
 * Transfer quantity from one vendor floor to another.
 * For checking floors, transfer uses M1 pool.
 * Secondary→branding and branding→final checking: stages on **existing** {@link ContainersMaster} (`existingContainerBarcode`); destination `received` updates on accept scan (same as factory).
 *
 * @param {string} flowId
 * @param {string} fromFloorKey
 * @param {string} toFloorKey
 * @param {number} quantity
 * @param {{ transferItems?: Array<{ transferred: number, styleCode?: string, brand?: string }>, existingContainerBarcode: string }} [opts]
 *   `existingContainerBarcode` — required when staging secondary→branding or branding→final checking (reuse physical container; no new container is created).
 */
export const transferVendorProductionFlowQuantity = async (flowId, fromFloorKey, toFloorKey, quantity, opts = {}) => {
  if (fromFloorKey === 'dispatch' && toFloorKey === 'warehouse') {
    return transferVendorDispatchToWarehouseQuantity(flowId, quantity, opts);
  }

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

  const usesContainer =
    (fromFloorKey === 'secondaryChecking' && toFloorKey === 'branding') ||
    (fromFloorKey === 'branding' && (toFloorKey === 'reBoarding' || toFloorKey === 'finalChecking')) ||
    (fromFloorKey === 'reBoarding' && toFloorKey === 'finalChecking') ||
    (fromFloorKey === 'finalChecking' && toFloorKey === 'dispatch' && opts.existingContainerBarcode);

  if (
    (fromFloorKey === 'secondaryChecking' && toFloorKey === 'branding') ||
    (fromFloorKey === 'branding' && (toFloorKey === 'reBoarding' || toFloorKey === 'finalChecking')) ||
    (fromFloorKey === 'reBoarding' && toFloorKey === 'finalChecking')
  ) {
    const bc = opts.existingContainerBarcode;
    if (!bc || !String(bc).trim()) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'existingContainerBarcode is required for this transfer (use a container that already exists; quantity is staged on it for the next floor).'
      );
    }
  }

  if (fromFloorKey === 'finalChecking' && toFloorKey === 'dispatch' && opts.existingContainerBarcode) {
    const items = opts.transferItems;
    if (Array.isArray(items) && items.length > 0) {
      const sum = items.reduce((s, row) => s + Math.max(0, Number(row?.transferred || 0)), 0);
      if (Math.abs(sum - qty) > 0.0001) {
        throw new ApiError(httpStatus.BAD_REQUEST, `transferItems sum (${sum}) must equal quantity (${qty})`);
      }
    }
  }

  /** Style/brand breakdown is required when leaving branding or re-boarding (both carry styleCode/brand lines). */
  if (
    (fromFloorKey === 'branding' && (toFloorKey === 'reBoarding' || toFloorKey === 'finalChecking')) ||
    (fromFloorKey === 'reBoarding' && toFloorKey === 'finalChecking')
  ) {
    const items = opts.transferItems;
    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'transferItems (styleCode / brand / transferred per line) is required when transferring from branding or re-boarding to the next floor'
      );
    }
    const sum = items.reduce((s, row) => s + Math.max(0, Number(row?.transferred || 0)), 0);
    if (Math.abs(sum - qty) > 0.0001) {
      throw new ApiError(httpStatus.BAD_REQUEST, `transferItems sum (${sum}) must equal quantity (${qty})`);
    }
  }

  let vendorTransferContainerMeta = null;

  const applyTransferUpdates = async (session = null) => {
    const sessionOptions = session ? { session } : undefined;
    const flowQuery = VendorProductionFlow.findById(flowId);
    const flow = session ? await flowQuery.session(session) : await flowQuery;
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
    };
    if (!usesContainer) {
      inc[floorPath(toFloorKey, 'received')] = qty;
    }
    if (isCheckingFloor) {
      inc[floorPath(fromFloorKey, 'm1Transferred')] = qty;
    }

    await VendorProductionFlow.updateOne({ _id: flowId }, { $inc: inc }, sessionOptions);

    const fromAfter = {
      ...fromBefore,
      transferred: Number(fromBefore.transferred || 0) + qty,
      m1Transferred: isCheckingFloor ? Number(fromBefore.m1Transferred || 0) + qty : fromBefore.m1Transferred,
    };
    const toAfter = usesContainer
      ? { ...toBefore }
      : {
          ...toBefore,
          received: Number(toBefore.received || 0) + qty,
        };

    assertValidFloorState(fromFloorKey, fromAfter);
    assertValidFloorState(toFloorKey, toAfter);

    const fromDerived = computeDerivedForFloor(fromFloorKey, fromAfter);
    const toDerived = usesContainer ? {} : computeDerivedForFloor(toFloorKey, toAfter);

    await VendorProductionFlow.updateOne(
      { _id: flowId },
      {
        $set: {
          ...Object.fromEntries(Object.entries(fromDerived).map(([k, v]) => [floorPath(fromFloorKey, k), v])),
          ...(Object.keys(toDerived).length > 0
            ? Object.fromEntries(Object.entries(toDerived).map(([k, v]) => [floorPath(toFloorKey, k), v]))
            : {}),
          currentFloorKey: usesContainer ? flow.currentFloorKey || fromFloorKey : toFloorKey,
          startedAt: flow.startedAt || new Date(),
        },
      },
      sessionOptions
    );

    /** Style/brand ledger for branding / re-boarding outbound (each line attributes qty sent to next floor). */
    if (
      ((fromFloorKey === 'branding' && (toFloorKey === 'reBoarding' || toFloorKey === 'finalChecking')) ||
        (fromFloorKey === 'reBoarding' && toFloorKey === 'finalChecking')) &&
      Array.isArray(opts.transferItems)
    ) {
      const lines = opts.transferItems.map((row) => ({
        transferred: Math.max(0, Number(row?.transferred || 0)),
        styleCode: String(row?.styleCode || ''),
        brand: String(row?.brand || ''),
      }));
      await VendorProductionFlow.updateOne(
        { _id: flowId },
        { $push: { [floorPath(fromFloorKey, 'transferredData')]: { $each: lines } } },
        sessionOptions
      );
    }

    /** Style ledger for “sent from final checking toward dispatch” — used to cap dispatch container receive (like branding → FC). */
    if (fromFloorKey === 'finalChecking' && toFloorKey === 'dispatch') {
      const lines =
        Array.isArray(opts.transferItems) && opts.transferItems.length > 0
          ? opts.transferItems.map((row) => ({
              transferred: Math.max(0, Number(row?.transferred || 0)),
              styleCode: String(row?.styleCode || ''),
              brand: String(row?.brand || ''),
            }))
          : [{ transferred: qty, styleCode: '', brand: '' }];
      await VendorProductionFlow.updateOne(
        { _id: flowId },
        { $push: { 'floorQuantities.finalChecking.transferredData': { $each: lines } } },
        sessionOptions
      );
    }

    if (usesContainer) {
      const transferItemsForContainer =
        (toFloorKey === 'reBoarding' || toFloorKey === 'finalChecking' || toFloorKey === 'dispatch') &&
        Array.isArray(opts.transferItems)
          ? opts.transferItems.map((row) => ({
              transferred: Math.max(0, Number(row?.transferred || 0)),
              styleCode: String(row?.styleCode || ''),
              brand: String(row?.brand || ''),
            }))
          : undefined;
      const c = await stageVendorTransferOnExistingContainer({
        barcode: opts.existingContainerBarcode,
        flowId: flowId.toString(),
        quantity: qty,
        toFloorKey,
        transferItems: transferItemsForContainer,
        session,
      });
      vendorTransferContainerMeta = { barcode: c.barcode, _id: c._id.toString() };
    }

    const updatedQuery = VendorProductionFlow.findById(flowId);
    return session ? await updatedQuery.session(session) : await updatedQuery;
  };

  const session = await VendorProductionFlow.startSession();
  try {
    let updatedFlow;
    try {
      await session.withTransaction(async () => {
        updatedFlow = await applyTransferUpdates(session);
      });
    } catch (error) {
      const message = String(error?.message || '');
      const isReplicaSetError =
        message.includes('Transaction numbers are only allowed on a replica set member or mongos');
      if (!isReplicaSetError) {
        throw error;
      }
      updatedFlow = await applyTransferUpdates(null);
    }
    if (vendorTransferContainerMeta && updatedFlow) {
      const o = updatedFlow.toObject ? updatedFlow.toObject() : { ...updatedFlow };
      o.vendorTransferContainer = vendorTransferContainerMeta;
      return o;
    }
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
    if (!flow.product) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Vendor production flow must have a product linked before confirm (required for WHMS inward / factory code).'
      );
    }
    const prod = await Product.findById(flow.product).select('factoryCode').lean();
    if (!String(prod?.factoryCode || '').trim()) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Product ${flow.product} has no factoryCode; cannot confirm to dispatch for WHMS inward.`
      );
    }
    finalChecking.transferred = Number(finalChecking.transferred || 0) + pendingToDispatch;
    finalChecking.remaining = Math.max(
      0,
      Number(finalChecking.received || 0) - Number(finalChecking.completed || 0) - Number(finalChecking.transferred || 0)
    );
    finalChecking.m1Transferred = Number(finalChecking.m1Transferred || 0) + pendingToDispatch;
    finalChecking.m1Remaining = Math.max(0, Number(finalChecking.m1Quantity || 0) - Number(finalChecking.m1Transferred || 0));

    dispatch.received = Number(dispatch.received || 0) + pendingToDispatch;
    dispatch.remaining = Number(dispatch.remaining || 0) + pendingToDispatch;

    /** Style-wise lines on dispatch: split `pendingToDispatch` in proportion to final checking `receivedData` buckets */
    const fcRd = finalChecking.receivedData || [];
    const agg = aggregateTransferredByStyleKey(fcRd);
    const keys = [...agg.keys()].filter((k) => (agg.get(k) || 0) > 0);
    const weights = keys.map((k) => agg.get(k) || 0);
    const sumW = weights.reduce((a, b) => a + b, 0);
    const now = new Date();
    let dispatchLines = [];
    if (keys.length > 0 && sumW > 0) {
      const parts = splitIntegerByWeights(pendingToDispatch, weights);
      dispatchLines = keys
        .map((k, i) => {
          const p = parts[i] ?? 0;
          if (p <= 0) return null;
          const { styleCode, brand } = parseVendorStyleKey(k);
          return {
            transferred: p,
            styleCode: styleCode || '',
            brand: brand || '',
            receivedTimestamp: now,
            receivedStatusFromPreviousFloor: 'confirm:finalChecking',
          };
        })
        .filter(Boolean);
    }
    if (dispatchLines.length === 0) {
      dispatchLines = [
        {
          transferred: pendingToDispatch,
          styleCode: '',
          brand: '',
          receivedTimestamp: now,
          receivedStatusFromPreviousFloor: 'confirm:finalChecking',
        },
      ];
    }
    dispatch.receivedData = [...(dispatch.receivedData || []), ...dispatchLines];
    flow.markModified('floorQuantities.dispatch');

    const tdLines = dispatchLines.map((d) => ({
      transferred: d.transferred,
      styleCode: d.styleCode || '',
      brand: d.brand || '',
    }));
    finalChecking.transferredData = [...(finalChecking.transferredData || []), ...tdLines];
    flow.markModified('floorQuantities.finalChecking');
  }

  dispatch.remaining = Math.max(
    0,
    Number(dispatch.received || 0) - Number(dispatch.transferred || 0)
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
 * @param {'branding'} toFloorKey
 * @param {number} quantity
 */
export const transferFinalCheckingM2ForRework = async (flowId, toFloorKey, quantity) => {
  const allowedReworkFloors = new Set(['branding']);
  if (!allowedReworkFloors.has(toFloorKey)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'M2 can be transferred only to branding');
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

export {
  auditSecondaryCheckingDrift,
  ensureSecondaryCheckingFlowForBox,
  reconcileSecondaryCheckingFromBoxes,
} from './vendorProductionFlowBoxReconcile.util.js';
