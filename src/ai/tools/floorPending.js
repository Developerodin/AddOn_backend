import { ALL_FLOOR_KEYS } from '../../utils/floorLabelMap.js';

/** Pair counts. DOMAIN.md: pending = max(0, received - transferred). Never `remaining`. */
export const PAIRS = 'pairs';

const QC_FLOORS = new Set(['checking', 'secondaryChecking', 'finalChecking']);

/**
 * Finite number, or 0.
 * @param {unknown} value
 * @returns {number}
 */
function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/**
 * Rounds a pair count to 2 decimals. Sum raw values first, then call this once.
 * Same rule as `formatProductionQty`: `Math.round(n * 100) / 100`.
 * @param {unknown} value
 * @returns {number}
 */
export function roundPairs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

/**
 * Pairs still on a floor. Ignores the stored `remaining` field.
 * @param {Record<string, unknown>|undefined} floorData
 * @returns {number}
 */
export function pendingPairs(floorData) {
  return Math.max(0, toNumber(floorData?.received) - toNumber(floorData?.transferred));
}

/**
 * Grade counts the agent may quote on a QC floor. Unit is pairs.
 * @param {Record<string, unknown>|undefined} floorData
 * @returns {{ m1Remaining: number, m2Remaining: number, m3Quantity: number, m4Quantity: number }}
 */
function qcGrades(floorData) {
  return {
    m1Remaining: toNumber(floorData?.m1Remaining),
    m2Remaining: toNumber(floorData?.m2Remaining),
    m3Quantity: toNumber(floorData?.m3Quantity),
    m4Quantity: toNumber(floorData?.m4Quantity),
  };
}

/**
 * True when any QC grade still has pairs.
 * @param {{ m1Remaining: number, m2Remaining: number, m3Quantity: number, m4Quantity: number }} grades
 * @returns {boolean}
 */
function gradeOpen(grades) {
  return grades.m1Remaining > 0 || grades.m2Remaining > 0 || grades.m3Quantity > 0 || grades.m4Quantity > 0;
}

/**
 * Floors that still have pairs, keyed by ALL_FLOOR_KEYS. Numbers are raw.
 * QC floors are included when pending > 0 or any grade > 0.
 * @param {Record<string, unknown>|undefined} floorQuantities
 * @returns {Record<string, object>}
 */
export function floorsPendingForArticle(floorQuantities) {
  const source = floorQuantities || {};
  return ALL_FLOOR_KEYS.reduce((out, key) => {
    const floorData = source[key];
    const pending = pendingPairs(floorData);
    if (QC_FLOORS.has(key)) {
      const grades = qcGrades(floorData);
      if (pending > 0 || gradeOpen(grades)) {
        return { ...out, [key]: { pending, unit: PAIRS, grades } };
      }
      return out;
    }
    if (pending > 0) {
      return { ...out, [key]: { pending, unit: PAIRS } };
    }
    return out;
  }, {});
}
