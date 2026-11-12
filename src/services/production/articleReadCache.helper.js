import { getArticleById, getArticleProcesses } from './article.service.js';
import { cachedRead, ProductionCacheResource, ProductionCacheTtl } from './productionCache.helper.js';

/**
 * Cached read wrappers for the article detail endpoints.
 *
 * Kept out of `article.service.js` because that file already holds the floor
 * transfer and quality write logic; the write paths there must keep calling
 * the uncached functions so they mutate live mongoose documents.
 */

/**
 * Article detail for `GET /production/articles/:articleId`.
 * @param {string} articleId - Article `_id`.
 * @returns {Promise<Object|null>} Same payload as the uncached service call.
 */
export const getArticleByIdCached = async (articleId) =>
  cachedRead({
    resource: ProductionCacheResource.ARTICLES,
    operation: 'getArticleById',
    input: { articleId: String(articleId) },
    ttlSeconds: ProductionCacheTtl.LIVE,
    loader: () => getArticleById(articleId),
  });

/**
 * Process flow for `GET /production/articles/:articleId/processes`.
 * Backed by the Product master, which changes rarely, so it gets the slow TTL.
 * @param {string} articleId - Article `_id`.
 * @returns {Promise<{ articleNumber: string, processes: Array }>}
 */
export const getArticleProcessesCached = async (articleId) =>
  cachedRead({
    resource: ProductionCacheResource.ARTICLES,
    operation: 'getArticleProcesses',
    input: { articleId: String(articleId) },
    ttlSeconds: ProductionCacheTtl.SLOW,
    loader: () => getArticleProcesses(articleId),
  });
