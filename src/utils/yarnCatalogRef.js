/**
 * Helpers for the canonical YarnCatalog reference field (`yarnCatalogId`).
 * Legacy API payloads may still send `yarn`; normalize to one id.
 */

/**
 * @param {Record<string, unknown>} obj
 * @returns {string|import('mongoose').Types.ObjectId|undefined}
 */
export function pickYarnCatalogId(obj) {
  if (!obj || typeof obj !== 'object') return undefined;
  const id = obj.yarnCatalogId ?? obj.yarn;
  if (id == null || id === '') return undefined;
  return id;
}

/**
 * @param {import('mongoose').Types.ObjectId|string} id
 * @returns {boolean}
 */
export function isSameYarnCatalogRef(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}
