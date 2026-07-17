/** @file Shared helpers for LT boxes with mistakenly generated / marked-used cones. */

export const WEIGHT_EPS = 1e-9;

/**
 * @param {unknown} v
 * @returns {boolean}
 */
export function isZeroWeight(v) {
  return Number(v ?? 0) <= WEIGHT_EPS;
}

/**
 * @param {Record<string, unknown>} cone
 * @returns {boolean}
 */
export function hasNoStorage(cone) {
  const sid = cone.coneStorageId;
  return sid == null || String(sid).trim() === '';
}

/**
 * Matches cones flipped by migrate-cone-mark-used.js (only issueStatus changed).
 * @param {Record<string, unknown>} cone
 * @returns {boolean}
 */
export function isMismarkedUsedByMigration(cone) {
  return (
    cone.issueStatus === 'used' &&
    isZeroWeight(cone.coneWeight) &&
    isZeroWeight(cone.tearWeight) &&
    hasNoStorage(cone) &&
    !cone.issueDate &&
    isZeroWeight(cone.issueWeight) &&
    !cone.orderId &&
    !cone.articleId
  );
}

/**
 * @param {Record<string, unknown>} box
 * @returns {boolean}
 */
export function isBoxStillInLt(box) {
  return (
    Boolean(box.storedStatus) &&
    Number(box.boxWeight ?? 0) > WEIGHT_EPS &&
    String(box.storageLocation || '').trim() !== ''
  );
}

/**
 * Returns null when every cone is safe to delete from a fresh LT box; otherwise a reason string.
 * @param {Record<string, unknown>} box
 * @param {Record<string, unknown>[]} cones
 * @param {boolean} force
 * @returns {string|null}
 */
export function validateRemovableMistakenCones(box, cones, force = false) {
  if (force) return null;
  if (!cones.length) return 'no cones on box';
  if (!isBoxStillInLt(box)) {
    return 'box is not stored in LT with positive weight (not a sealed fresh LT box)';
  }

  const unsafe = cones.filter((c) => !isMismarkedUsedByMigration(c));
  if (unsafe.length > 0) {
    const sample = unsafe.slice(0, 3).map((c) => ({
      barcode: c.barcode,
      issueStatus: c.issueStatus,
      coneWeight: c.coneWeight,
      coneStorageId: c.coneStorageId ?? null,
      orderId: c.orderId ? String(c.orderId) : null,
    }));
    return `found ${unsafe.length} cone(s) that are not migration false-positives; pass --force to delete anyway. sample=${JSON.stringify(sample)}`;
  }

  return null;
}
