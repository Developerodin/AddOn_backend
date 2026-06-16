import { ProductionFloor } from '../models/production/enums.js';

const QC_FLOOR_KEYS = new Set(['checking', 'secondaryChecking', 'finalChecking']);

/**
 * Floors to update when merging M2 → M1 (source through Dispatch).
 * @param {import('../models/production/article.model.js').default} article
 * @param {string} sourceFloor - Checking | Secondary Checking | Final Checking
 * @returns {Promise<string[]>}
 */
export async function getCascadeFloorsForM2Merge(article, sourceFloor) {
  const floorOrder = await article.getFloorOrder();
  const sourceIdx = floorOrder.indexOf(sourceFloor);
  if (sourceIdx === -1) {
    throw new Error(`Source floor "${sourceFloor}" is not in this article's process order`);
  }
  const dispatchIdx = floorOrder.indexOf(ProductionFloor.DISPATCH);
  const endIdx = dispatchIdx === -1 ? floorOrder.length - 1 : dispatchIdx;
  return floorOrder.slice(sourceIdx, endIdx + 1);
}

/**
 * Ensure floorQuantities bucket exists for a floor key.
 * @param {Object} article
 * @param {string} floorKey
 * @returns {Object}
 */
export function ensureFloorData(article, floorKey) {
  if (!article.floorQuantities) {
    article.floorQuantities = {};
  }
  if (!article.floorQuantities[floorKey]) {
    article.floorQuantities[floorKey] = {
      received: 0,
      completed: 0,
      remaining: 0,
      transferred: 0,
      m1Quantity: 0,
      m2Quantity: 0,
      m3Quantity: 0,
      m4Quantity: 0,
      m1Transferred: 0,
      m1Remaining: 0,
    };
  }
  return article.floorQuantities[floorKey];
}

/**
 * Recalculate QC floor remaining fields after quantity change.
 * @param {Object} fd - floor data
 */
export function recalcQcFloorRemaining(fd) {
  const m1T = fd.m1Transferred || 0;
  const m2 = fd.m2Quantity || 0;
  const m3 = fd.m3Quantity || 0;
  const m4 = fd.m4Quantity || 0;
  fd.m1Remaining = Math.max(0, (fd.m1Quantity || 0) - m1T);
  fd.remaining = Math.max(0, (fd.received || 0) - m1T - m2 - m3 - m4);
}

/**
 * Whether a QC floor bucket already has production activity (skip empty downstream gates).
 * @param {Object} fd - floor data
 * @returns {boolean}
 */
export function qcFloorHasActivity(fd) {
  return (
    (fd.received || 0) > 0 ||
    (fd.completed || 0) > 0 ||
    (fd.transferred || 0) > 0 ||
    (fd.m1Quantity || 0) > 0 ||
    (fd.m1Transferred || 0) > 0
  );
}

/**
 * Bump M1 and transfer counters on a QC floor after M2→M1 merge.
 * @param {Object} fd - floor data
 * @param {number} qty - merge quantity
 */
export function bumpQcM1AndTransfer(fd, qty) {
  fd.m1Quantity = (fd.m1Quantity || 0) + qty;
  fd.m1Transferred = (fd.m1Transferred || 0) + qty;
  fd.transferred = (fd.transferred || 0) + qty;
}

/**
 * Apply cascade M2→M1 merge increment on one floor in the pipeline.
 * @param {Object} article - Mongoose article document
 * @param {string} floorLabel - Production floor enum label
 * @param {number} qty - Merge quantity
 * @param {string} sourceFloor - Original M2 source QC floor
 */
export function applyCascadeMergeIncrement(article, floorLabel, qty, sourceFloor) {
  const floorKey = article.getFloorKey(floorLabel);
  const fd = ensureFloorData(article, floorKey);
  const isSource = floorLabel === sourceFloor;
  const isQc = QC_FLOOR_KEYS.has(floorKey);

  if (isQc) {
    if (isSource || qcFloorHasActivity(fd)) {
      if (isSource) {
        fd.m2Quantity = Math.max(0, (fd.m2Quantity || 0) - qty);
        fd.completed = (fd.completed || 0) + qty;
      }
      bumpQcM1AndTransfer(fd, qty);
      recalcQcFloorRemaining(fd);
      article.markModified(`floorQuantities.${floorKey}`);
    }
    return;
  }

  if (floorKey === 'dispatch') {
    fd.received = (fd.received || 0) + qty;
    fd.remaining = Math.max(0, (fd.received || 0) - (fd.transferred || 0));
    article.markModified(`floorQuantities.${floorKey}`);
    return;
  }

  if ((fd.received || 0) > 0 || (fd.completed || 0) > 0 || (fd.transferred || 0) > 0) {
    fd.received = (fd.received || 0) + qty;
    fd.completed = (fd.completed || 0) + qty;
    if ((fd.transferred || 0) > 0) {
      fd.transferred = (fd.transferred || 0) + qty;
    }
    fd.remaining = Math.max(0, (fd.received || 0) - (fd.transferred || 0));
    article.markModified(`floorQuantities.${floorKey}`);
  }
}

/**
 * Resolve source floor key from M2 entry source label.
 * @param {Object} article
 * @param {string} sourceFloor
 * @returns {string}
 */
export function getSourceFloorKey(article, sourceFloor) {
  return article.getFloorKey(sourceFloor);
}

/**
 * Whether the article has been received on Dispatch floor (present in dispatch pipeline).
 * @param {Object} article
 * @returns {boolean}
 */
export function isArticlePresentOnDispatchFloor(article) {
  const dispatchReceived = Number(article.floorQuantities?.dispatch?.received ?? 0);
  if (dispatchReceived > 0) return true;
  return article.currentFloor === ProductionFloor.DISPATCH;
}

/**
 * M2→M1 merge is allowed only when the article is present on Dispatch floor.
 * @param {Object} article
 * @returns {{ eligible: boolean, reason: string|null }}
 */
export function assessM2MergeToM1Eligibility(article) {
  if (!isArticlePresentOnDispatchFloor(article)) {
    return {
      eligible: false,
      reason: 'M2 merge is only allowed after the article has been received on Dispatch floor.',
    };
  }
  return { eligible: true, reason: null };
}

/**
 * Evaluates M2 merge eligibility for an article document.
 * @param {Object} article
 * @returns {Promise<{ eligible: boolean, reason: string|null }>}
 */
export async function assessM2MergeToM1EligibilityForArticle(article) {
  return assessM2MergeToM1Eligibility(article);
}
