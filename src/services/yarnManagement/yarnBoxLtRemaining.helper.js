/**
 * LT remaining box weight must subtract both cones currently in short-term storage and cones
 * returned to the vendor. Vendor-returned cones are neither on the LT pallet nor in ST; omitting
 * them incorrectly increases `boxWeight` because `base - sum(ST)` treats every missing cone as still on LT.
 *
 * Empty carton: when every expected cone exists as a YarnCone doc (issued/used/ST, excluding
 * vendor-return), leftover grams are scale dust — persist boxWeight=0. Partial extracts keep remaining kg.
 * Humidity / scale drift (15%) is a fallback when expected cone count is missing.
 */

/** Exact-empty leftover cutoff (kg). */
export const LT_REMAINING_WEIGHT_EPS_KG = 0.001;

/** Allowed leftover as a fraction of original box weight (humidity / scale). */
export const LT_TRANSFER_HUMIDITY_BUFFER_FRACTION = 0.15;

/**
 * Positive cone count; 0 / NaN / missing → 0 so callers can fall through.
 * @param {unknown} value
 * @returns {number}
 */
function positiveConeCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Expected cone count from the box document.
 * Header `numberOfCones` wins when greater than 0; 0 is treated as missing and falls back
 * to `coneData.numberOfCones` (issued boxes often zero the header).
 * @param {{ numberOfCones?: number|null, coneData?: { numberOfCones?: number|null } }} box
 * @returns {number}
 */
export function expectedYarnBoxConeCount(box) {
  return positiveConeCount(box?.numberOfCones) || positiveConeCount(box?.coneData?.numberOfCones);
}

/**
 * True when enough non-vendor YarnCone docs exist that the carton is empty.
 * @param {{ numberOfCones?: number|null, coneData?: { numberOfCones?: number|null } }} box
 * @param {number} movedConeCount
 * @returns {boolean}
 */
export function isCartonEmptyByMovedCount(box, movedConeCount) {
  const expected = expectedYarnBoxConeCount(box);
  const moved = Number(movedConeCount);
  return expected > 0 && Number.isFinite(moved) && moved >= expected;
}

/**
 * Humidity leftover cap for a given original box weight.
 * @param {number} baseWeight
 * @returns {number}
 */
export function ltHumidityLimitKg(baseWeight) {
  const base = Number(baseWeight ?? 0);
  if (!Number.isFinite(base) || base <= 0) return LT_REMAINING_WEIGHT_EPS_KG;
  return Math.max(LT_REMAINING_WEIGHT_EPS_KG, LT_TRANSFER_HUMIDITY_BUFFER_FRACTION * base);
}

/**
 * Dummy cone rows so remaining math + cone-count gates work from ST aggregates.
 * @param {number} totalWeight
 * @param {number} count
 * @returns {Array<{ coneWeight: number }>}
 */
export function conesFromTotalWeight(totalWeight, count) {
  const n = Math.trunc(Number(count));
  const w = Number(totalWeight);
  if (!Number.isFinite(n) || n <= 0) return [];
  const each = Number.isFinite(w) ? w / n : 0;
  return Array.from({ length: n }, () => ({ coneWeight: each }));
}

/**
 * @typedef {Object} LtRemainingOptions
 * @property {number} [movedConeCount] Non-vendor-return YarnCone docs for this boxId
 *   (ST + issued + used + floor-return leftover). Defaults to ST length + vendor-return length.
 */

/**
 * @param {{ initialBoxWeight?: number|null, boxWeight?: number|null, numberOfCones?: number|null, coneData?: { numberOfCones?: number|null } }} box
 * @param {Array<{ coneWeight?: number }>} conesInST
 * @param {Array<{ coneWeight?: number }>} conesReturnedVendor
 * @param {LtRemainingOptions} [options]
 * @returns {{ remaining: number, persistBoxWeight: number, fullyTransferred: boolean, baseWeight: number, humidityLimitKg: number, movedConeCount: number, expectedConeCount: number }}
 */
export function computeLtRemainingBoxWeight(box, conesInST, conesReturnedVendor, options = {}) {
  const stCones = conesInST || [];
  const returnedCones = conesReturnedVendor || [];
  const totalConeWeightST = stCones.reduce((sum, c) => sum + (c.coneWeight || 0), 0);
  const totalReturned = returnedCones.reduce((sum, c) => sum + (c.coneWeight || 0), 0);
  const initial = box.initialBoxWeight != null ? Number(box.initialBoxWeight) : 0;
  const boxWeightNow = Number(box.boxWeight ?? 0);
  const inferredBase =
    boxWeightNow >= totalConeWeightST ? boxWeightNow : boxWeightNow + totalConeWeightST;
  const baseWeight = initial > 0 ? initial : inferredBase;
  const remaining = Math.max(0, baseWeight - totalConeWeightST - totalReturned);
  const humidityLimitKg = ltHumidityLimitKg(baseWeight);
  const expected = expectedYarnBoxConeCount(box);
  const stMoved = stCones.length + returnedCones.length;
  const movedRaw = options?.movedConeCount;
  const movedConeCount =
    movedRaw != null && Number.isFinite(Number(movedRaw)) ? Math.max(0, Number(movedRaw)) : stMoved;
  const leftoverWithinHumidity = remaining <= humidityLimitKg;
  const cartonEmptyByCount = isCartonEmptyByMovedCount(box, movedConeCount);
  const exactEmpty = stMoved > 0 && remaining <= LT_REMAINING_WEIGHT_EPS_KG;
  const humidityWhenExpectedUnknown = expected === 0 && stMoved > 0 && leftoverWithinHumidity;
  const fullyTransferred = cartonEmptyByCount || exactEmpty || humidityWhenExpectedUnknown;

  return {
    remaining,
    persistBoxWeight: fullyTransferred ? 0 : remaining,
    fullyTransferred,
    baseWeight,
    humidityLimitKg,
    movedConeCount,
    expectedConeCount: expected,
  };
}

/**
 * Mutate a YarnBox document with remaining weight / empty-carton fields (caller saves).
 * @param {import('mongoose').Document} box
 * @param {{ persistBoxWeight: number, fullyTransferred: boolean, expectedConeCount?: number, movedConeCount?: number }} result
 * @param {Date} [coneIssueDate]
 * @returns {void}
 */
export function applyLtRemainingToBoxDoc(box, result, coneIssueDate) {
  /* eslint-disable no-param-reassign -- mutating the Mongoose YarnBox document in place */
  box.boxWeight = result.persistBoxWeight;
  if (!result.fullyTransferred) {
    return;
  }
  box.storageLocation = undefined;
  box.storedStatus = false;
  if (!box.coneData) box.coneData = {};
  box.coneData.conesIssued = true;
  const coneCount = result.expectedConeCount > 0 ? result.expectedConeCount : result.movedConeCount;
  if (Number.isFinite(Number(coneCount)) && Number(coneCount) > 0) {
    box.coneData.numberOfCones = Number(coneCount);
  }
  box.coneData.coneIssueDate = coneIssueDate || box.coneData.coneIssueDate || new Date();
  /* eslint-enable no-param-reassign */
}
