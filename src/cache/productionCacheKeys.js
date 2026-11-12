import crypto from 'crypto';

/**
 * Cache key builders for the production module.
 *
 * Layout: `addon:prod:v1:<resource>:<operation>:<hash of inputs>`.
 * The resource segment is what write paths delete, so every cached read must
 * pick the resource that the matching writes own.
 */

/** Root namespace. Bump `v1` if a cached payload shape ever changes. */
export const PRODUCTION_CACHE_ROOT = 'addon:prod:v1:';

/**
 * Cache resources. Each value is a deletable key prefix.
 * @readonly
 */
export const ProductionCacheResource = {
  ORDERS: 'orders',
  FLOOR_ORDERS: 'floorOrders',
  ARTICLES: 'articles',
  ASSIGNMENTS: 'assignments',
  REPORTS: 'reports',
  LOGS: 'logs',
  FLOOR_STATS: 'floorStats',
  DASHBOARD: 'dashboard',
  TEAM: 'team',
  M2: 'm2',
  M3: 'm3',
  M4: 'm4',
};

/**
 * TTL budget in seconds, grouped by how fast the underlying data moves.
 * TTL is a safety net only — writes delete the affected prefix immediately.
 * @readonly
 */
export const ProductionCacheTtl = {
  /** Live floor/order/assignment data. */
  LIVE: 30,
  /** Heavier reports and dashboards. */
  REPORT: 60,
  /** Slow-moving aggregates and statistics. */
  SLOW: 120,
};

/**
 * Prefix that write paths delete for a resource.
 * @param {string} resource - One of {@link ProductionCacheResource}.
 * @returns {string} Key prefix ending in `:`.
 */
export const resourcePrefix = (resource) => `${PRODUCTION_CACHE_ROOT}${resource}:`;

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
 * Auth scope segment for a cache key.
 *
 * Production reads are factory-wide today: no handler in
 * `production.controller.js` narrows results by `req.user`, and neither
 * `ProductionOrder` nor `Article` carries a company/tenant field. Keys
 * therefore stay user-independent, and this helper exists so that any future
 * user-scoped read can opt in without inventing a second convention.
 *
 * @param {{ _id?: unknown, id?: unknown, companyId?: unknown, role?: unknown }|null} [user]
 * @returns {string} Scope token, `global` when the read is not user-scoped.
 */
export const buildScopeToken = (user) => {
  if (!user) return 'global';
  const company = user.companyId ?? user.company ?? null;
  const id = user.id ?? user._id ?? null; // eslint-disable-line no-underscore-dangle
  return stableHash({ company: company ? String(company) : null, user: id ? String(id) : null, role: user.role ?? null });
};

/**
 * Build a fully qualified cache key.
 * @param {string} resource - One of {@link ProductionCacheResource}.
 * @param {string} operation - Service method name, e.g. `getOrdersByFloor`.
 * @param {unknown} input - Every input that can change the payload.
 * @returns {string} Cache key.
 */
export const buildProductionCacheKey = (resource, operation, input) =>
  `${resourcePrefix(resource)}${operation}:${stableHash(input)}`;
