import { LT_SECTION_CODES, ST_SECTION_CODE } from '../../models/storageManagement/storageSlot.model.js';
import {
  computeLtRemainingBoxWeight,
  conesFromTotalWeight,
} from '../../services/yarnManagement/yarnBoxLtRemaining.helper.js';

/** Weight / comparison tolerance (kg), aligned with storage slot UI logic. */
export const WEIGHT_EPS_KG = 0.001;

let compiledLtRegex;
let compiledStRegex;

/**
 * Regex for long-term rack labels: legacy `LT-` or seeded sections B7-02..B7-05.
 * @returns {RegExp}
 */
export function getLtStorageLocationRegex() {
  if (!compiledLtRegex) {
    compiledLtRegex = new RegExp(`^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`, 'i');
  }
  return compiledLtRegex;
}

/**
 * Regex for short-term rack labels: legacy `ST-` or B7-01 (seeded ST section).
 * @returns {RegExp}
 */
export function getStStorageLocationRegex() {
  if (!compiledStRegex) {
    compiledStRegex = new RegExp(`^(ST-|${ST_SECTION_CODE}-)`, 'i');
  }
  return compiledStRegex;
}

/**
 * @param {unknown} storageLocation - YarnBox.storageLocation or YarnCone.coneStorageId
 * @returns {boolean}
 */
export function isLongTermStorageLocation(storageLocation) {
  const s = storageLocation != null ? String(storageLocation).trim() : '';
  if (!s) return false;
  return getLtStorageLocationRegex().test(s);
}

/**
 * @param {unknown} storageLocation
 * @returns {boolean}
 */
export function isShortTermStorageLocation(storageLocation) {
  const s = storageLocation != null ? String(storageLocation).trim() : '';
  if (!s) return false;
  return getStStorageLocationRegex().test(s);
}

/**
 * @param {unknown} v
 * @returns {number}
 */
export function num(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * True when a cone counts as physically in short-term for inventory / double-count checks
 * (matches `isActiveShortTermCone` in check-yarn-lt-st-by-barcode.js).
 * @param {Record<string, unknown>} c - lean YarnCone
 * @returns {boolean}
 */
export function isActiveShortTermCone(c) {
  const storage = c.coneStorageId != null && String(c.coneStorageId).trim() !== '';
  const isAvailable = c.issueStatus !== 'issued' && c.issueStatus !== 'used';
  const w = num(c.coneWeight);
  return storage && isAvailable && w > WEIGHT_EPS_KG;
}

/**
 * Same "fully transferred" predicate as `getStorageSlotsWithContents` in storageSlot.service.js:
 * box is skipped for LT slot occupancy when cones consumed initial snapshot or marker set.
 * Uses gross cone weight sum for cones that still have a non-empty `coneStorageId` (any issue status).
 *
 * @param {Record<string, unknown>} box - lean YarnBox
 * @param {number} coneWeightGrossInSlots - Σ coneWeight for YarnCone with same boxId and non-empty coneStorageId
 * @param {number} [coneCountInSlots=0] - cone document count in slots
 * @param {number} [movedConeCount] - non-vendor YarnCone docs for the box (ST + issued + used)
 * @returns {boolean}
 */
export function isFullyTransferredBox(box, coneWeightGrossInSlots, coneCountInSlots = 0, movedConeCount) {
  if (box?.coneData?.conesIssued === true) return true;
  if (num(box.boxWeight) <= WEIGHT_EPS_KG) return true;
  const count = Number(coneCountInSlots);
  const cones =
    Number.isFinite(count) && count > 0
      ? conesFromTotalWeight(coneWeightGrossInSlots, count)
      : conesFromTotalWeight(coneWeightGrossInSlots, num(coneWeightGrossInSlots) > WEIGHT_EPS_KG ? 1 : 0);
  let moved;
  if (movedConeCount != null && Number.isFinite(Number(movedConeCount))) {
    moved = Number(movedConeCount);
  } else if (Number.isFinite(count) && count > 0) {
    moved = count;
  }
  return computeLtRemainingBoxWeight(box, cones, [], moved != null ? { movedConeCount: moved } : {}).fullyTransferred;
}

/**
 * Expected remaining gross box weight (kg) after ST transfer, mirroring YarnCone post-save
 * (`inferredBase`, `baseWeight`, `remaining`).
 *
 * @param {Record<string, unknown>} box - lean YarnBox
 * @param {number} totalConeWeightGross - Σ coneWeight for cones with non-empty coneStorageId for this boxId
 * @returns {number}
 */
export function expectedRemainingBoxWeightGross(box, totalConeWeightGross) {
  const boxWeightNow = num(box.boxWeight);
  const totalConeWeight = num(totalConeWeightGross);
  const initial = num(box.initialBoxWeight);
  const inferredBase =
    boxWeightNow >= totalConeWeight ? boxWeightNow : boxWeightNow + totalConeWeight;
  const baseWeight = initial > 0 ? initial : inferredBase;
  return Math.max(0, baseWeight - totalConeWeight);
}

/**
 * Inventory double-count: LT row still carries weight while not-issued cones sit in ST with weight.
 *
 * @param {Record<string, unknown>} box - lean YarnBox
 * @param {number} activeShortTermConeCount - cones matching {@link isActiveShortTermCone}
 * @returns {boolean}
 */
export function isDoubleCountRisk(box, activeShortTermConeCount) {
  const storageLocation = box.storageLocation != null ? String(box.storageLocation) : '';
  const isLtSlot = Boolean(storageLocation && isLongTermStorageLocation(storageLocation));
  const boxWeight = num(box.boxWeight);
  const stored = box.storedStatus === true;
  const remainingInLongTerm = isLtSlot && stored && boxWeight > WEIGHT_EPS_KG;
  const transferredToShortTerm = activeShortTermConeCount > 0;
  return remainingInLongTerm && transferredToShortTerm;
}

/**
 * True when model-predicted remaining gross weight disagrees with persisted `boxWeight`
 * (partial backfill / hook failure), only meaningful when there is cone weight in slots.
 *
 * @param {Record<string, unknown>} box - lean YarnBox
 * @param {number} totalConeWeightGrossAnyStorage - Σ coneWeight, cones with non-empty coneStorageId
 * @returns {boolean}
 */
export function isLtWeightInconsistentWithModel(box, totalConeWeightGrossAnyStorage) {
  if (num(totalConeWeightGrossAnyStorage) <= WEIGHT_EPS_KG) return false;
  const storageLocation = box.storageLocation != null ? String(box.storageLocation) : '';
  if (!isLongTermStorageLocation(storageLocation) || box.storedStatus !== true) return false;
  const expected = expectedRemainingBoxWeightGross(box, totalConeWeightGrossAnyStorage);
  const actual = num(box.boxWeight);
  return Math.abs(actual - expected) > WEIGHT_EPS_KG;
}

/**
 * Fully transferred by data rules but LT-facing fields not cleared (post-save should zero/unset).
 *
 * @param {Record<string, unknown>} box - lean YarnBox
 * @param {number} coneWeightGrossInSlots
 * @param {number} [coneCountInSlots=0]
 * @returns {boolean}
 */
export function isFullyTransferredButLtFieldsDirty(box, coneWeightGrossInSlots, coneCountInSlots = 0) {
  if (!isFullyTransferredBox(box, coneWeightGrossInSlots, coneCountInSlots)) return false;
  const loc = box.storageLocation != null ? String(box.storageLocation).trim() : '';
  const onLtBarcode = loc && isLongTermStorageLocation(loc);
  const stored = box.storedStatus === true;
  const w = num(box.boxWeight);
  return (onLtBarcode && stored) || w > WEIGHT_EPS_KG;
}
