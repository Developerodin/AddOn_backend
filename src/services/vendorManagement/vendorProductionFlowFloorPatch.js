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

export function resolveMode(body) {
  const explicit = body?.mode;
  if (explicit === 'increment' || explicit === 'replace') return explicit;

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
 * Checking floors: clients often send `m1Quantity` / `m2Quantity` / `m4Quantity` meaning **add** to existing
 * on each save. Map those to `*Delta` + `mode: "increment"` unless the client explicitly uses `mode: "replace"`
 * or sends structural fields (`received`, `completed`, `transferred`, `remaining`, or `*Delta` for those).
 * Absolute overwrite: send `mode: "replace"` with full `m1Quantity` / `m2Quantity` / `m4Quantity`.
 */
export function normalizeCheckingFloorSplitBody(floorKey, body) {
  if (!body || typeof body !== 'object') return body;
  if (!checkingFloorKeys.has(floorKey)) return body;
  if (body.resetSecondaryChecking === true) return body;
  if (body.mode === 'replace') return body;

  const structural =
    body.received !== undefined ||
    body.completed !== undefined ||
    body.transferred !== undefined ||
    body.remaining !== undefined ||
    body.receivedDelta !== undefined ||
    body.completedDelta !== undefined ||
    body.transferredDelta !== undefined ||
    body.transferredData !== undefined ||
    body.receivedData !== undefined;

  if (structural) return body;

  const hasSplitAbsolute =
    body.m1Quantity !== undefined ||
    body.m2Quantity !== undefined ||
    body.m4Quantity !== undefined;
  if (!hasSplitAbsolute) return body;

  const next = { ...body };
  if (next.m1Delta === undefined && next.m1Quantity !== undefined) {
    next.m1Delta = next.m1Quantity;
    delete next.m1Quantity;
  }
  if (next.m2Delta === undefined && next.m2Quantity !== undefined) {
    next.m2Delta = next.m2Quantity;
    delete next.m2Quantity;
  }
  if (next.m4Delta === undefined && next.m4Quantity !== undefined) {
    next.m4Delta = next.m4Quantity;
    delete next.m4Quantity;
  }
  if (next.mode === undefined) next.mode = 'increment';
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
 * - Checking floors (secondary / final): received − m2 − m4 − transferred − completed (M1 lane net).
 */
/** Branding / dispatch: assert + transferable math use pipeline rules (transferred ≤ completed ≤ received). */
const pipelineStandardFloorKeys = new Set(['branding', 'dispatch']);

export function computeRemainingForFloor(floorKey, floor) {
  const received = toFiniteNumber(floor.received, 0);
  const completed = toFiniteNumber(floor.completed, 0);
  const transferred = toFiniteNumber(floor.transferred, 0);
  if (checkingFloorKeys.has(floorKey)) {
    const m2Quantity = toFiniteNumber(floor.m2Quantity, 0);
    const m4Quantity = toFiniteNumber(floor.m4Quantity, 0);
    return Math.max(0, received - m2Quantity - m4Quantity - transferred - completed);
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
    if (completed > received) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Completed cannot exceed received');
    }
    if (transferred > received) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Transferred cannot exceed received');
    }
    if (completed + transferred > received) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Completed + transferred cannot exceed received');
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

