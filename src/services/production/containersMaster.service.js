import mongoose from 'mongoose';
import httpStatus from 'http-status';
import ContainersMaster from '../../models/production/containersMaster.model.js';
import { Article } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';
import * as articleService from './article.service.js';

/** Article fields to populate when fetching container with articles */
const ARTICLE_POPULATE_SELECT = 'id articleNumber knittingCode plannedQuantity status priority linkingType orderId';

/**
 * Create a container. Barcode is set from _id in model pre-save.
 * @param {Object} body
 * @returns {Promise<ContainersMaster>}
 */
export const createContainersMaster = async (body) => {
  const doc = await ContainersMaster.create(body);
  if (!doc.barcode && doc._id) {
    doc.barcode = doc._id.toString();
    await doc.save();
  }
  return doc;
};

/**
 * Query containers with filter (status, search) and pagination.
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
export const queryContainersMasters = async (filter, options = {}) => {
  const { containerName, status, type, activeArticle, activeFloor, search, ...rest } = filter || {};
  const query = { ...rest };
  if (containerName) query.containerName = { $regex: containerName, $options: 'i' };
  if (status) query.status = status;
  if (type) query.type = type;
  if (activeArticle != null && activeArticle !== '' && mongoose.Types.ObjectId.isValid(activeArticle) && String(activeArticle).length === 24) {
    query['activeItems.article'] = new mongoose.Types.ObjectId(activeArticle);
  }
  if (activeFloor) query.activeFloor = { $regex: activeFloor, $options: 'i' };
  if (search && String(search).trim()) {
    const term = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(term, 'i');
    query.$or = [{ barcode: re }, { containerName: re }, { activeFloor: re }];
    if (mongoose.Types.ObjectId.isValid(term) && term.length === 24) query.$or.push({ 'activeItems.article': new mongoose.Types.ObjectId(term) });
  }
  return ContainersMaster.paginate(query, options);
};

/**
 * Get container by id.
 * @param {string} id
 * @returns {Promise<ContainersMaster|null>}
 */
export const getContainersMasterById = async (id) => {
  return ContainersMaster.findById(id).populate('activeItems.article');
};

/**
 * Populate activeItems.article with lean data; preserves articleId when article not found.
 * Handles legacy: when activeItems empty but activeArticle exists, use that.
 * @param {Object} doc - Container document (plain or mongoose doc)
 * @returns {Promise<Object>}
 */
const enrichContainerWithArticles = async (doc) => {
  if (!doc) return null;
  let items = doc.activeItems || [];
  // Legacy: activeItems empty but activeArticle exists
  if (items.length === 0 && doc.activeArticle) {
    const aid = doc.activeArticle?.toString?.() || doc.activeArticle;
    const qty = doc.quantity ?? 0;
    if (aid) items = [{ article: aid, quantity: qty }];
  }
  if (items.length === 0) return doc.toJSON ? doc.toJSON() : doc;

  const getArticleId = (art) => {
    if (!art) return null;
    if (typeof art === 'string') return art;
    return art._id ? art._id.toString() : art.toString?.() || null;
  };
  const articleIds = items.map((i) => getArticleId(i.article)).filter(Boolean);
  const ids = [...new Set(articleIds)];
  const articles = ids.length
    ? await Article.find({ _id: { $in: ids } })
        .select(ARTICLE_POPULATE_SELECT)
        .populate('orderId', 'orderNumber')
        .lean()
    : [];
  const articleMap = new Map(articles.map((a) => [a._id.toString(), a]));
  const plain = doc.toJSON ? doc.toJSON() : { ...doc };
  plain.activeItems = items.map((item, idx) => {
    const raw = item?.toObject ? item.toObject() : { ...item };
    const articleId = getArticleId(raw.article);
    return {
      _id: raw._id || null,
      quantity: raw.quantity ?? 0,
      articleId: articleId || null,
      article: articleId ? articleMap.get(articleId) || null : null
    };
  });
  return plain;
};

/**
 * Get container by id with articles populated (lean article data + orderNumber).
 * Preserves articleId when referenced article is deleted.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export const getContainerWithArticlesById = async (id) => {
  const doc = await ContainersMaster.findById(id);
  if (!doc) return null;
  return enrichContainerWithArticles(doc);
};

/**
 * Get container by barcode (barcode stores the _id string).
 * @param {string} barcode
 * @returns {Promise<ContainersMaster|null>}
 */
export const getContainerByBarcode = async (barcode) => {
  if (!barcode || !String(barcode).trim()) return null;
  const trimmed = String(barcode).trim();
  let doc = await ContainersMaster.findOne({ barcode: trimmed }).populate('activeItems.article');
  if (!doc && /^[0-9a-fA-F]{24}$/.test(trimmed)) {
    doc = await ContainersMaster.findById(trimmed).populate('activeItems.article');
  }
  return doc || null;
};

/**
 * Get container by barcode with articles populated (lean article data + orderNumber).
 * Preserves articleId when referenced article is deleted.
 * @param {string} barcode
 * @returns {Promise<Object|null>}
 */
export const getContainerWithArticlesByBarcode = async (barcode) => {
  if (!barcode || !String(barcode).trim()) return null;
  const trimmed = String(barcode).trim();
  let doc = await ContainersMaster.findOne({ barcode: trimmed });
  if (!doc && /^[0-9a-fA-F]{24}$/.test(trimmed)) {
    doc = await ContainersMaster.findById(trimmed);
  }
  if (!doc) return null;
  return enrichContainerWithArticles(doc);
};

/**
 * All containers whose activeFloor matches this floor (case-insensitive, full string),
 * each with activeItems enriched with article documents and quantities.
 * @param {string} activeFloor - Floor linking string (same as container.activeFloor)
 * @param {{ status?: string }} [opts]
 * @returns {Promise<Object[]>}
 */
export const getContainersWithArticlesByFloor = async (activeFloor, opts = {}) => {
  const floor = String(activeFloor || '').trim();
  if (!floor) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'activeFloor is required');
  }
  const escaped = floor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const query = {
    activeFloor: { $regex: `^${escaped}$`, $options: 'i' },
  };
  if (opts.status) query.status = opts.status;
  const docs = await ContainersMaster.find(query).sort({ updatedAt: -1 });
  return Promise.all(docs.map((d) => enrichContainerWithArticles(d)));
};

/**
 * Update container by barcode (activeFloor, activeItems).
 * activeItems: [{ article: ObjectId, quantity: number }]. Use addItem to append one item.
 * @param {string} barcode
 * @param {{ activeFloor?: string, activeItems?: Array<{article: string, quantity: number}>, addItem?: {article: string, quantity: number} }} body
 * @returns {Promise<ContainersMaster>}
 */
export const updateContainersMasterByBarcode = async (barcode, body) => {
  const doc = await getContainerByBarcode(barcode);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Container not found for this barcode');
  if (body.hasOwnProperty('activeFloor')) doc.activeFloor = body.activeFloor || '';
  if (body.hasOwnProperty('activeItems') && Array.isArray(body.activeItems)) {
    doc.activeItems = body.activeItems
      .filter((i) => i && i.article && typeof i.quantity === 'number' && i.quantity >= 0.0001)
      .map((i) => ({ article: i.article, quantity: Number(i.quantity) }));
  }
  if (body.addItem && body.addItem.article && typeof body.addItem.quantity === 'number' && body.addItem.quantity >= 0.0001) {
    if (!doc.activeItems) doc.activeItems = [];
    doc.activeItems.push({
      article: body.addItem.article,
      quantity: Number(body.addItem.quantity),
    });
  }
  await doc.save();
  return getContainerByBarcode(barcode);
};

/**
 * Accept container on receiving floor - updates each article's floor received from container data.
 * @param {string} barcode - Container barcode
 * @returns {Promise<{ container: ContainersMaster, articles: Article[] }>}
 */
export const acceptContainerByBarcode = async (barcode) => {
  const doc = await getContainerByBarcode(barcode);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Container not found for this barcode');
  const items = doc.activeItems || [];
  const floor = doc.activeFloor;
  if (!floor || items.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Container has no active items or floor to accept');
  }
  const updatedArticles = [];
  for (const item of items) {
    const article = item.article;
    const quantity = item.quantity || 0;
    if (!article || quantity <= 0) continue;
    const articleId = typeof article === 'object' ? article._id : article;
    const updated = await articleService.updateArticleFloorReceivedData(articleId.toString(), {
      floor,
      quantity,
      receivedData: {
        receivedStatusFromPreviousFloor: 'Completed',
        receivedInContainerId: doc._id,
        receivedTimestamp: new Date()
      }
    });
    updatedArticles.push(updated);
  }
  return { container: doc, articles: updatedArticles };
};

/**
 * Clear activeItems, activeFloor, and legacy activeArticle for container by barcode.
 * @param {string} barcode
 * @returns {Promise<ContainersMaster>}
 */
export const clearActiveByBarcode = async (barcode) => {
  if (!barcode || !String(barcode).trim()) throw new ApiError(httpStatus.NOT_FOUND, 'Container not found for this barcode');
  const trimmed = String(barcode).trim();
  const query = /^[0-9a-fA-F]{24}$/.test(trimmed)
    ? { $or: [{ barcode: trimmed }, { _id: trimmed }] }
    : { barcode: trimmed };
  const doc = await ContainersMaster.findOneAndUpdate(
    query,
    { $set: { activeItems: [], activeFloor: '' }, $unset: { activeArticle: '', quantity: '' } },
    { new: true }
  ).populate('activeItems.article');
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Container not found for this barcode');
  return doc;
};

/**
 * Reset activeItems, activeFloor, and legacy activeArticle for all containers.
 * @returns {Promise<{ modifiedCount: number }>}
 */
export const resetAllActive = async () => {
  const result = await ContainersMaster.updateMany(
    {},
    { $set: { activeItems: [], activeFloor: '' }, $unset: { activeArticle: '', quantity: '' } }
  );
  return { modifiedCount: result.modifiedCount };
};

/**
 * Update container by id.
 * @param {string} id
 * @param {Object} updateBody
 * @returns {Promise<ContainersMaster>}
 */
export const updateContainersMasterById = async (id, updateBody) => {
  const doc = await ContainersMaster.findById(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Container not found');
  Object.assign(doc, updateBody);
  await doc.save();
  return doc;
};

/**
 * Delete container by id.
 * @param {string} id
 * @returns {Promise<ContainersMaster>}
 */
export const deleteContainersMasterById = async (id) => {
  const doc = await ContainersMaster.findById(id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Container not found');
  await doc.deleteOne();
  return doc;
};
