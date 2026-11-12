import mongoose from 'mongoose';
import { Article, ProductionOrder } from '../../models/production/index.js';

/** Case-insensitive prefix indexes on orderNumber / articleNumber use this collation. */
const SEARCH_COLLATION = { locale: 'en', strength: 2 };

/** Safety cap so a very broad prefix cannot build an unbounded $in. Ids only, not documents. */
const SEARCH_ID_CAP = 5000;

/** Supervisor list never needs more than the page-size control (max 100). */
const LIST_LIMIT_CAP = 100;

const LIST_ORDER_SELECT = 'orderNumber priority status currentFloor orderNote createdAt updatedAt articles';
const LIST_ARTICLE_SELECT = 'articleNumber plannedQuantity';

/**
 * Escapes user text for a literal Mongo regex.
 * @param {string} raw
 * @returns {string}
 */
export const escapeRegexLiteral = (raw) => String(raw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Collects order ids for a pattern via the orderNumber and articleNumber indexes.
 * Also keeps article ids so orders are found through the `articles` array when `orderId` is stale.
 * @param {RegExp} pattern
 * @param {boolean} useCollation - Prefix queries pass true so the collation index is used
 * @returns {Promise<object|null>}
 */
const collectIdClause = async (pattern, useCollation) => {
  const orderQuery = ProductionOrder.find({ orderNumber: pattern }).select('_id').limit(SEARCH_ID_CAP);
  const articleQuery = Article.find({ articleNumber: pattern }).select('_id orderId').limit(SEARCH_ID_CAP);
  if (useCollation) {
    orderQuery.collation(SEARCH_COLLATION);
    articleQuery.collation(SEARCH_COLLATION);
  }
  const [orders, articles] = await Promise.all([orderQuery.lean(), articleQuery.lean()]);

  const orderIds = [];
  for (const order of orders) {
    if (order._id) orderIds.push(order._id);
  }
  const articleIds = [];
  for (const article of articles) {
    if (article._id) articleIds.push(article._id);
    if (article.orderId) orderIds.push(article.orderId);
  }

  const or = [];
  if (orderIds.length > 0) or.push({ _id: { $in: orderIds } });
  if (articleIds.length > 0) or.push({ articles: { $in: articleIds } });
  if (or.length === 0) return null;
  return or.length === 1 ? or[0] : { $or: or };
};

/**
 * Turns the supervisor search box into an indexed order filter.
 * Prefix match uses collation indexes. A capped substring lookup runs only when the prefix misses,
 * so "includes" still works without loading full orders.
 * @param {string} searchTerm
 * @returns {Promise<object|null>} null when blank; `{ _id: { $in: [] } }` when nothing matches
 */
export const buildSupervisorSearchClause = async (searchTerm) => {
  const trimmed = String(searchTerm || '').trim();
  if (!trimmed) return null;

  const escaped = escapeRegexLiteral(trimmed);
  const prefixClause = await collectIdClause(new RegExp(`^${escaped}`), true);
  const clause = prefixClause || (await collectIdClause(new RegExp(escaped, 'i'), false));

  const idOr = [];
  if (/^[a-fA-F0-9]{24}$/.test(trimmed)) {
    idOr.push({ _id: new mongoose.Types.ObjectId(trimmed) });
  }
  if (!clause && idOr.length === 0) return { _id: { $in: [] } };
  if (!clause) return idOr[0];
  if (idOr.length === 0) return clause;
  const existingOr = clause.$or ? clause.$or : [clause];
  return { $or: [...idOr, ...existingOr] };
};

/**
 * Paginated supervisor order list: lean, projected articles, no machine/logs/history.
 * `filter` must already include any search clause.
 * @param {object} filter
 * @param {object} options
 * @returns {Promise<object>}
 */
export const querySupervisorOrderList = async (filter, options = {}) => {
  const requested = parseInt(options.limit, 10);
  const limit = Math.min(Math.max(Number.isFinite(requested) && requested > 0 ? requested : 10, 1), LIST_LIMIT_CAP);
  const page = parseInt(options.page, 10);

  return ProductionOrder.paginate(filter, {
    sortBy: options.sortBy || 'createdAt:desc',
    limit,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    select: LIST_ORDER_SELECT,
    lean: true,
    populate: {
      path: 'articles',
      select: LIST_ARTICLE_SELECT,
    },
  });
};
