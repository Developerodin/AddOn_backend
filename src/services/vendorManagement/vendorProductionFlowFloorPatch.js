import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { vendorProductionFlowSequence } from '../../models/vendorManagement/vendorProductionFlow.model.js';

const allowedFloorKeys = new Set(vendorProductionFlowSequence);
const checkingFloorKeys = new Set(['secondaryChecking', 'finalChecking']);

const numericFloorFields = new Set([
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
  'repairReceived',
]);

export function assertAllowedFloorKey(floorKey) {
  if (!allowedFloorKeys.has(floorKey)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid floor key');
  }
}

/**
 * Server-owned patch mode: client `mode` is ignored. Increment when any *Delta field is present; otherwise replace.
 */
export function resolveMode(body) {
  const hasDelta =
    body?.receivedDelta !== undefined ||
    body?.completedDelta !== undefined ||
    body?.transferredDelta !== undefined ||
    body?.m1Delta !== undefined ||
    body?.m2Delta !== undefined ||
    body?.m4Delta !== undefined;
  if (hasDelta) return 'increment';
  return 'replace';
}

/**
 * Checking floors: `m1Quantity` / `m2Quantity` / `m4Quantity` always mean **add this many** to stored buckets.
 * Client `mode` is stripped — use `m1Delta` / `m2Delta` / `m4Delta` only if you must bypass this (rare).
 */
export function normalizeCheckingFloorSplitBody(floorKey, body) {
  if (!body || typeof body !== 'object') return body;
  if (!checkingFloorKeys.has(floorKey)) return body;
  const { mode: _unusedMode, ...withoutMode } = body;
  if (withoutMode.resetSecondaryChecking === true) return { ...withoutMode };

  const next = { ...withoutMode };

  const hasSplitAbsolute =
    next.m1Quantity !== undefined ||
    next.m2Quantity !== undefined ||
    next.m4Quantity !== undefined;
  if (!hasSplitAbsolute) return next;

  /**
   * `m1Quantity` / `m2Quantity` / `m4Quantity` always mean “add this many now”.
   * If the client also sends `m1Delta`/`m2Delta`/`m4Delta` (e.g. form defaults to 0),
   * those deltas must not block conversion — otherwise `m1Quantity` stays on the body and
   * can hit **replace** `$set` and look like an absolute overwrite.
   */
  if (next.m1Quantity !== undefined) {
    next.m1Delta = next.m1Quantity;
    delete next.m1Quantity;
  }
  if (next.m2Quantity !== undefined) {
    next.m2Delta = next.m2Quantity;
    delete next.m2Quantity;
  }
  if (next.m4Quantity !== undefined) {
    next.m4Delta = next.m4Quantity;
    delete next.m4Quantity;
  }
  return next;
}

/** Secondary checking: these counters are always server-derived from M1/M2/M4 (and transfer sub-pools). */
export function stripSecondaryCheckingServerDerivedFields(body) {
  if (!body || typeof body !== 'object') return body;
  const next = { ...body };
  delete next.completed;
  delete next.completedDelta;
  delete next.remaining;
  delete next.m1Remaining;
  delete next.m2Remaining;
  return next;
}

export function floorPath(floorKey, field) {
  return `floorQuantities.${floorKey}.${field}`;
}

export function getNextFloorKey(floorKey) {
  const idx = vendorProductionFlowSequence.indexOf(floorKey);
  return idx >= 0 ? vendorProductionFlowSequence[idx + 1] || null : null;
}

export function assertForwardFloorMove(fromFloorKey, toFloorKey) {
  const fromIdx = vendorProductionFlowSequence.indexOf(fromFloorKey);
  const toIdx = vendorProductionFlowSequence.indexOf(toFloorKey);
  if (fromIdx < 0 || toIdx < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid floor key');
  }
  if (toIdx <= fromIdx) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Destination floor must be after source floor');
  }
}

export function toFiniteNumber(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

export function pickFloorSnapshot(flow, floorKey) {
  const floor = flow?.floorQuantities?.[floorKey] || {};
  const snap = {};
  numericFloorFields.forEach((k) => {
    snap[k] = toFiniteNumber(floor?.[k], 0);
  });
  snap.repairStatus = floor?.repairStatus;
  snap.repairRemarks = floor?.repairRemarks;
  return snap;
}

/**
 * `remaining` meaning:
 * - Branding / dispatch: received − transferred (not yet sent to next floor).
 * - Other non-checking floors: received − completed − transferred.
 * - secondaryChecking: received − m1 − m2 − m4 (not yet classified into M1/M2/M4 buckets; independent of transferred).
 * - finalChecking: received − transferred (pipeline handoff view).
 */
/** Branding / dispatch: assert + transferable math use pipeline rules (transferred ≤ completed ≤ received). */
const pipelineStandardFloorKeys = new Set(['branding', 'dispatch']);

export function computeRemainingForFloor(floorKey, floor) {
  const received = toFiniteNumber(floor.received, 0);
  const completed = toFiniteNumber(floor.completed, 0);
  const transferred = toFiniteNumber(floor.transferred, 0);
  /** Same idea as branding: units not yet sent to the next floor (dispatch), not “completed + transferred” disjoint pools. */
  if (floorKey === 'finalChecking') {
    return Math.max(0, received - transferred);
  }
  if (floorKey === 'secondaryChecking') {
    const m1Quantity = toFiniteNumber(floor.m1Quantity, 0);
    const m2Quantity = toFiniteNumber(floor.m2Quantity, 0);
    const m4Quantity = toFiniteNumber(floor.m4Quantity, 0);
    return Math.max(0, received - m1Quantity - m2Quantity - m4Quantity);
  }
  if (pipelineStandardFloorKeys.has(floorKey)) {
    return Math.max(0, received - transferred);
  }
  return Math.max(0, received - completed - transferred);
}

export function computeDerivedForFloor(floorKey, floor) {
  const derived = {};
  derived.remaining = computeRemainingForFloor(floorKey, floor);

  if (checkingFloorKeys.has(floorKey)) {
    // M1/M2/M4 are stored explicitly; do not derive M1 from received − M2 − M4.
    const m1Quantity = toFiniteNumber(floor.m1Quantity, 0);
    const m1Transferred = toFiniteNumber(floor.m1Transferred, 0);
    const m2Quantity = toFiniteNumber(floor.m2Quantity, 0);
    const m2Transferred = toFiniteNumber(floor.m2Transferred, 0);

    derived.m1Remaining = Math.max(0, m1Quantity - m1Transferred);
    derived.m2Remaining = Math.max(0, m2Quantity - m2Transferred);
  }

  /** Secondary: `completed` is M1 (good path) only — M2/M4 are only in their quantity fields. */
  if (floorKey === 'secondaryChecking') {
    derived.completed = toFiniteNumber(floor.m1Quantity, 0);
  }

  return derived;
}

/**
 * How many units can move to the next floor using the completed − transferred pool.
 * Branding/dispatch use pipeline semantics (see {@link assertValidFloorState}); checking floors keep completed + transferred ≤ received.
 */
export function computeCompletedBasedTransferableForFloor(floorKey, floor) {
  const received = toFiniteNumber(floor.received, 0);
  const completed = toFiniteNumber(floor.completed, 0);
  const transferred = toFiniteNumber(floor.transferred, 0);
  if (floorKey === 'finalChecking') {
    const pending = Math.max(0, completed - transferred);
    const aggRoom = Math.max(0, received - transferred);
    return Math.min(pending, aggRoom);
  }
  if (floorKey === 'secondaryChecking') {
    const m1Quantity = toFiniteNumber(floor.m1Quantity, 0);
    const m1Transferred = toFiniteNumber(floor.m1Transferred, 0);
    return Math.max(0, m1Quantity - m1Transferred);
  }
  const pending = Math.max(0, completed - transferred);
  const aggRoom = pipelineStandardFloorKeys.has(floorKey)
    ? Math.max(0, received - transferred)
    : Math.max(0, received - completed - transferred);
  return Math.min(pending, aggRoom);
}

export function assertValidFloorState(floorKey, floor) {
  const received = toFiniteNumber(floor.received, 0);
  const completed = toFiniteNumber(floor.completed, 0);
  const transferred = toFiniteNumber(floor.transferred, 0);

  if (received < 0 || completed < 0 || transferred < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Quantities cannot be negative');
  }

  if (pipelineStandardFloorKeys.has(floorKey)) {
    if (completed > received) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Completed cannot exceed received');
    }
    if (transferred > received) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Transferred cannot exceed received');
    }
    if (transferred > completed) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Transferred cannot exceed completed');
    }
  } else if (checkingFloorKeys.has(floorKey)) {
    if (floorKey === 'finalChecking') {
      if (completed > received) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Completed cannot exceed received');
      }
      if (transferred > received) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Transferred cannot exceed received');
      }
      if (transferred > completed) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Transferred cannot exceed completed');
      }
    } else {
      /** secondaryChecking: `completed` tracks M1 only; `transferred` is M1 outbound — do not use completed+transferred ≤ received (double-counts). */
      if (completed > received) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Completed cannot exceed received');
      }
      if (transferred > received) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Transferred cannot exceed received');
      }
    }

    const m1Quantity = toFiniteNumber(floor.m1Quantity, 0);
    const m2Quantity = toFiniteNumber(floor.m2Quantity, 0);
    const m4Quantity = toFiniteNumber(floor.m4Quantity, 0);
    const m1Transferred = toFiniteNumber(floor.m1Transferred, 0);
    const m2Transferred = toFiniteNumber(floor.m2Transferred, 0);

    if (m1Quantity < 0 || m2Quantity < 0 || m4Quantity < 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'M1/M2/M4 quantities cannot be negative');
    }
    if (m1Quantity + m2Quantity + m4Quantity > received) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'M1 + M2 + M4 cannot exceed received');
    }

    if (m1Transferred < 0 || m2Transferred < 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Transferred quantities cannot be negative');
    }
    if (m1Transferred > m1Quantity) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'M1 transferred cannot exceed M1 quantity');
    }
    if (m2Transferred > m2Quantity) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'M2 transferred cannot exceed M2 quantity');
    }
    if (floorKey === 'secondaryChecking' && transferred > m1Quantity) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Transferred cannot exceed M1 quantity on secondary checking');
    }
  } else {
    if (completed > received) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Completed cannot exceed received');
    }
    if (transferred > received) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Transferred cannot exceed received');
    }
    if (completed + transferred > received) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Completed + transferred cannot exceed received');
    }
  }
}

export function buildIncrementOps(floorKey, body) {
  const inc = {};
  const set = {};

  const receivedDelta = body?.receivedDelta;
  const completedDelta = body?.completedDelta;
  const transferredDelta = body?.transferredDelta;
  const m1Delta = body?.m1Delta;
  const m2Delta = body?.m2Delta;
  const m4Delta = body?.m4Delta;

  if (receivedDelta !== undefined) inc[floorPath(floorKey, 'received')] = toFiniteNumber(receivedDelta, 0);
  if (completedDelta !== undefined) inc[floorPath(floorKey, 'completed')] = toFiniteNumber(completedDelta, 0);
  if (transferredDelta !== undefined) inc[floorPath(floorKey, 'transferred')] = toFiniteNumber(transferredDelta, 0);
  if (m1Delta !== undefined) {
    if (!checkingFloorKeys.has(floorKey)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'm1Delta is only valid on checking floors');
    }
    inc[floorPath(floorKey, 'm1Quantity')] = toFiniteNumber(m1Delta, 0);
  }
  if (m2Delta !== undefined) inc[floorPath(floorKey, 'm2Quantity')] = toFiniteNumber(m2Delta, 0);
  if (m4Delta !== undefined) inc[floorPath(floorKey, 'm4Quantity')] = toFiniteNumber(m4Delta, 0);

  if (body?.repairStatus !== undefined) set[floorPath(floorKey, 'repairStatus')] = body.repairStatus;
  if (body?.repairRemarks !== undefined) set[floorPath(floorKey, 'repairRemarks')] = body.repairRemarks ?? '';

  if (floorKey === 'branding' || floorKey === 'finalChecking') {
    if (body?.transferredData !== undefined) set[floorPath(floorKey, 'transferredData')] = body.transferredData;
    if (body?.receivedData !== undefined) set[floorPath(floorKey, 'receivedData')] = body.receivedData;
  }

  const out = {};
  if (Object.keys(inc).length) out.$inc = inc;
  if (Object.keys(set).length) out.$set = set;
  return out;
}

export function buildReplaceOps(floorKey, body) {
  const set = {};

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

  if (floorKey === 'branding' || floorKey === 'finalChecking') {
    patchableKeys.push('transferredData', 'receivedData');
  }
  if (floorKey === 'branding') {
    patchableKeys.push('repairReceived');
  }
  if (floorKey === 'secondaryChecking') {
    patchableKeys.push('receivedData');
  }
  if (floorKey === 'dispatch') {
    patchableKeys.push('repairReceived', 'receivedData');
  }

  patchableKeys.forEach((key) => {
    if (body?.[key] !== undefined) {
      set[floorPath(floorKey, key)] = body[key];
    }
  });

  return { $set: set };
}

