import { getOrSet, delByPrefixes } from '../../cache/readCache.js';
import {
  ProductionCacheResource,
  ProductionCacheTtl,
  buildProductionCacheKey,
  resourcePrefix,
} from '../../cache/productionCacheKeys.js';
import logger from '../../config/logger.js';

/**
 * Thin wrapper the production services use so cache plumbing stays out of the
 * query code. Re-exports the resource and TTL enums so a service only imports
 * this one module.
 */

export { ProductionCacheResource, ProductionCacheTtl };

/**
 * Prefixes touched by any write that changes an order or an article: those
 * documents feed the order lists, floor lists, article detail, every report,
 * the activity logs, the floor statistics and the populated machine queues.
 * @type {string[]}
 */
const DATA_RESOURCES = [
  ProductionCacheResource.ORDERS,
  ProductionCacheResource.FLOOR_ORDERS,
  ProductionCacheResource.ARTICLES,
  ProductionCacheResource.ASSIGNMENTS,
  ProductionCacheResource.REPORTS,
  ProductionCacheResource.LOGS,
  ProductionCacheResource.FLOOR_STATS,
  ProductionCacheResource.M2,
  ProductionCacheResource.M3,
  ProductionCacheResource.M4,
];

/**
 * Prefixes touched by machine-queue writes. Knitting buckets, the yarn-issue
 * pending summary and per-machine pending quantities all read the queue, so
 * the report prefix goes with it.
 * @type {string[]}
 */
const ASSIGNMENT_RESOURCES = [ProductionCacheResource.ASSIGNMENTS, ProductionCacheResource.REPORTS];

/**
 * Read through the cache. Falls back to `loader()` whenever Redis is absent,
 * unreachable or slow to answer — the caller cannot tell the difference.
 *
 * @template T
 * @param {object} params
 * @param {string} params.resource - One of {@link ProductionCacheResource}.
 * @param {string} params.operation - Service method name, used in the key.
 * @param {unknown} params.input - Every input that changes the payload.
 * @param {number} params.ttlSeconds - One of {@link ProductionCacheTtl}.
 * @param {() => Promise<T>} params.loader - Mongo-backed source of truth.
 * @param {(value: T) => boolean} [params.shouldCache] - Return false to serve a
 *   payload without storing it, e.g. when one of its sources degraded.
 * @returns {Promise<T>}
 */
export const cachedRead = async ({ resource, operation, input, ttlSeconds, loader, shouldCache }) =>
  /** @type {Promise<T>} */ (
    getOrSet({
      key: buildProductionCacheKey(resource, operation, input),
      ttlSeconds,
      loader,
      ...(shouldCache ? { shouldCache } : {}),
    })
  );

/**
 * Drop every cached read that an order/article/quality write can change.
 * Call this before responding so the next read is never stale.
 * @param {string} [reason] - Short label for debugging, never a document dump.
 * @returns {Promise<void>}
 */
export const invalidateProductionData = async (reason = '') => {
  try {
    await delByPrefixes(DATA_RESOURCES.map(resourcePrefix));
  } catch (err) {
    logger.warn(`[cache] production invalidation failed${reason ? ` (${reason})` : ''}: ${err && err.message}`);
  }
};

/**
 * Drop cached team-master reads after a team write.
 * @param {string} [reason] - Short label for debugging.
 * @returns {Promise<void>}
 */
export const invalidateTeamData = async (reason = '') => {
  try {
    await delByPrefixes([resourcePrefix(ProductionCacheResource.TEAM)]);
  } catch (err) {
    logger.warn(`[cache] team invalidation failed${reason ? ` (${reason})` : ''}: ${err && err.message}`);
  }
};

/**
 * Drop cached reads that a machine-queue write can change.
 * @param {string} [reason] - Short label for debugging.
 * @returns {Promise<void>}
 */
export const invalidateAssignmentData = async (reason = '') => {
  try {
    await delByPrefixes(ASSIGNMENT_RESOURCES.map(resourcePrefix));
  } catch (err) {
    logger.warn(`[cache] assignment invalidation failed${reason ? ` (${reason})` : ''}: ${err && err.message}`);
  }
};
