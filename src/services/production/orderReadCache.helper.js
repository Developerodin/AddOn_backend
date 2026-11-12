import {
  getProductionOrderById,
  getOrdersByFloor,
  getDispatchOrdersPendingWarehousePrint,
} from './order.service.js';
import { cachedRead, ProductionCacheResource, ProductionCacheTtl } from './productionCache.helper.js';

/**
 * Cached read wrappers for the order/floor endpoints.
 *
 * They live outside `order.service.js` so the service keeps only query and
 * write logic. Write paths inside the service deliberately call the uncached
 * functions, which is why the wrappers are separate names rather than a
 * rewrite of the originals.
 */

/**
 * Order detail for `GET /production/orders/:orderId`.
 * @param {import('mongoose').Types.ObjectId|string} id - Production order id.
 * @returns {Promise<Object|null>} Same payload as the uncached service call.
 */
export const getProductionOrderByIdCached = async (id) =>
  cachedRead({
    resource: ProductionCacheResource.ORDERS,
    operation: 'getProductionOrderById',
    input: { id: String(id) },
    ttlSeconds: ProductionCacheTtl.LIVE,
    loader: () => getProductionOrderById(id),
  });

/**
 * Floor order list for `GET /production/floors/:floor/orders`.
 * @param {string} floor - Floor name from the route.
 * @param {Object} filter - Picked query filters.
 * @param {Object} options - Pagination/populate options.
 * @returns {Promise<Object>} Same payload as the uncached service call.
 */
export const getOrdersByFloorCached = async (floor, filter, options) =>
  cachedRead({
    resource: ProductionCacheResource.FLOOR_ORDERS,
    operation: 'getOrdersByFloor',
    input: { floor, filter, options },
    ttlSeconds: ProductionCacheTtl.LIVE,
    loader: () => getOrdersByFloor(floor, filter, options),
  });

/**
 * Dispatch pending-warehouse-print list for
 * `GET /production/floors/:floor/orders/pending-warehouse-print`.
 * Transfer-note creation keeps using the uncached function so it never prints
 * rows that a concurrent inward already consumed.
 * @param {string} floor - Must normalize to `Dispatch`.
 * @param {Object} filter - Picked query filters.
 * @param {Object} options - Pagination/populate options.
 * @returns {Promise<Object>} Same payload as the uncached service call.
 */
export const getDispatchOrdersPendingWarehousePrintCached = async (floor, filter, options) =>
  cachedRead({
    resource: ProductionCacheResource.FLOOR_ORDERS,
    operation: 'getDispatchOrdersPendingWarehousePrint',
    input: { floor, filter, options },
    ttlSeconds: ProductionCacheTtl.LIVE,
    loader: () => getDispatchOrdersPendingWarehousePrint(floor, filter, options),
  });
