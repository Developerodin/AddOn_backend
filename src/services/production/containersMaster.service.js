import mongoose from 'mongoose';
import httpStatus from 'http-status';
import ContainersMaster from '../../models/production/containersMaster.model.js';
import ApiError from '../../utils/ApiError.js';
import * as articleService from './article.service.js';

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
      .filter((i) => i && i.article && typeof i.quantity === 'number' && i.quantity >= 1)
      .map((i) => ({ article: i.article, quantity: Math.floor(i.quantity) }));
  }
  if (body.addItem && body.addItem.article && typeof body.addItem.quantity === 'number' && body.addItem.quantity >= 1) {
    if (!doc.activeItems) doc.activeItems = [];
    doc.activeItems.push({
      article: body.addItem.article,
      quantity: Math.floor(body.addItem.quantity),
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
 * Clear activeItems and activeFloor for container by barcode.
 * @param {string} barcode
 * @returns {Promise<ContainersMaster>}
 */
export const clearActiveByBarcode = async (barcode) => {
  const doc = await getContainerByBarcode(barcode);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Container not found for this barcode');
  doc.activeItems = [];
  doc.activeFloor = '';
  await doc.save();
  return getContainerByBarcode(barcode);
};

/**
 * Reset activeItems and activeFloor for all containers.
 * @returns {Promise<{ modifiedCount: number }>}
 */
export const resetAllActive = async () => {
  const result = await ContainersMaster.updateMany({}, { $set: { activeItems: [], activeFloor: '' } });
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
