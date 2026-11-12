import { getOrSet, delByPrefixes } from '../../cache/readCache.js';
import {
  YarnCacheResource,
  YarnCacheTtl,
  buildYarnCacheKey,
  yarnResourcePrefix,
} from '../../cache/yarnCacheKeys.js';
import logger from '../../config/logger.js';

/**
 * Thin wrapper the yarn management services use so cache plumbing stays out of
 * the query code. Re-exports the resource and TTL enums so a service only
 * imports this one module.
 */

export { YarnCacheResource, YarnCacheTtl };

/**
 * Read through the cache. Falls back to `loader()` whenever Redis is absent,
 * unreachable or slow to answer — the caller cannot tell the difference.
 *
 * @template T
 * @param {object} params
 * @param {string} params.resource - One of {@link YarnCacheResource}.
 * @param {string} params.operation - Service method name, used in the key.
 * @param {unknown} params.input - Every input that changes the payload.
 * @param {number} params.ttlSeconds - One of {@link YarnCacheTtl}.
 * @param {() => Promise<T>} params.loader - Mongo-backed source of truth.
 * @param {(value: T) => boolean} [params.shouldCache] - Return false to serve a
 *   payload without storing it.
 * @returns {Promise<T>}
 */
export const cachedYarnRead = async ({ resource, operation, input, ttlSeconds, loader, shouldCache }) =>
  /** @type {Promise<T>} */ (
    getOrSet({
      key: buildYarnCacheKey(resource, operation, input),
      ttlSeconds,
      loader,
      ...(shouldCache ? { shouldCache } : {}),
    })
  );

// ---------------------------------------------------------------------------
// Invalidation helpers — failures are logged and swallowed, never thrown.
// ---------------------------------------------------------------------------

/**
 * Drop cached yarn catalog reads after a catalog write.
 * @param {string} [reason]
 * @returns {Promise<void>}
 */
export const invalidateYarnCatalogs = async (reason = '') => {
  try {
    await delByPrefixes([yarnResourcePrefix(YarnCacheResource.CATALOGS)]);
  } catch (err) {
    logger.warn(`[cache] yarn catalog invalidation failed${reason ? ` (${reason})` : ''}: ${err && err.message}`);
  }
};

/**
 * Prefixes touched by any write that changes physical stock: inventories,
 * boxes, cones, transactions, and reports (which derive from inventory numbers).
 * @type {string[]}
 */
const STOCK_PREFIXES = [
  YarnCacheResource.INVENTORIES,
  YarnCacheResource.BOXES,
  YarnCacheResource.CONES,
  YarnCacheResource.TRANSACTIONS,
  YarnCacheResource.REPORTS,
].map(yarnResourcePrefix);

/**
 * Drop cached reads that any stock-changing write can invalidate.
 * Call after any insert/update/delete on YarnBox, YarnCone, YarnTransaction,
 * or YarnInventory.
 * @param {string} [reason]
 * @returns {Promise<void>}
 */
export const invalidateYarnStock = async (reason = '') => {
  try {
    await delByPrefixes(STOCK_PREFIXES);
  } catch (err) {
    logger.warn(`[cache] yarn stock invalidation failed${reason ? ` (${reason})` : ''}: ${err && err.message}`);
  }
};

/**
 * Drop cached purchase order reads after a PO write.
 * @param {string} [reason]
 * @returns {Promise<void>}
 */
export const invalidateYarnPurchaseOrders = async (reason = '') => {
  try {
    await delByPrefixes([yarnResourcePrefix(YarnCacheResource.PURCHASE_ORDERS)]);
  } catch (err) {
    logger.warn(`[cache] yarn PO invalidation failed${reason ? ` (${reason})` : ''}: ${err && err.message}`);
  }
};

/**
 * Drop cached requisition reads after a requisition write.
 * @param {string} [reason]
 * @returns {Promise<void>}
 */
export const invalidateYarnRequisitions = async (reason = '') => {
  try {
    await delByPrefixes([yarnResourcePrefix(YarnCacheResource.REQUISITIONS)]);
  } catch (err) {
    logger.warn(`[cache] yarn requisition invalidation failed${reason ? ` (${reason})` : ''}: ${err && err.message}`);
  }
};
