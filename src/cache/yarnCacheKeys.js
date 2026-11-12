import crypto from 'crypto';

/**
 * Cache key builders for the yarn management module.
 *
 * Layout: `addon:yarn:v1:<resource>:<operation>:<hash of inputs>`.
 * The resource segment is what write paths delete, so every cached read must
 * pick the resource that the matching writes own.
 */

/** Root namespace. Bump `v1` if a cached payload shape ever changes. */
export const YARN_CACHE_ROOT = 'addon:yarn:v1:';

/**
 * Cache resources. Each value is a deletable key prefix.
 * @readonly
 */
export const YarnCacheResource = {
  CATALOGS: 'catalogs',
  INVENTORIES: 'inventories',
  BOXES: 'boxes',
  CONES: 'cones',
  PURCHASE_ORDERS: 'purchaseOrders',
  TRANSACTIONS: 'transactions',
  REQUISITIONS: 'requisitions',
  REPORTS: 'reports',
};

/**
 * TTL budget in seconds, grouped by how fast the underlying data moves.
 * TTL is a safety net only — writes delete the affected prefix immediately.
 * @readonly
 */
export const YarnCacheTtl = {
  /** Live inventory/box/cone/transaction data. */
  LIVE: 30,
  /** Heavier reports and analytics dashboards. */
  REPORT: 60,
  /** Slow-moving catalogs and master data. */
  SLOW: 120,
};

/**
 * Prefix that write paths delete for a resource.
 * @param {string} resource - One of {@link YarnCacheResource}.
 * @returns {string} Key prefix ending in `:`.
 */
export const yarnResourcePrefix = (resource) => `${YARN_CACHE_ROOT}${resource}:`;

/**
 * Recursively sort object keys so equivalent filters hash identically.
 * @param {unknown} value
 * @returns {unknown} Value with deterministic key order.
 */
const normalize = (value) => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalize);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') return value.toHexString();
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        const normalized = normalize(value[key]);
        if (normalized !== undefined) acc[key] = normalized;
        return acc;
      }, {});
  }
  return value;
};

/**
 * Stable short hash of any query/filter/options object.
 * @param {unknown} input - Filters, options and any other payload-changing input.
 * @returns {string} 16 hex characters.
 */
export const stableHash = (input) =>
  crypto.createHash('sha1').update(JSON.stringify(normalize(input))).digest('hex').slice(0, 16);

/**
 * Build a fully qualified cache key.
 * @param {string} resource - One of {@link YarnCacheResource}.
 * @param {string} operation - Service method name, e.g. `queryYarnCatalogs`.
 * @param {unknown} input - Every input that can change the payload.
 * @returns {string} Cache key.
 */
export const buildYarnCacheKey = (resource, operation, input) =>
  `${yarnResourcePrefix(resource)}${operation}:${stableHash(input)}`;
