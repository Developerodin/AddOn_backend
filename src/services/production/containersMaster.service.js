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
  const { containerName, status, type, activeArticle, activeFloor, quantity, search, ...rest } = filter || {};
  const query = { ...rest };
  if (containerName) query.containerName = { $regex: containerName, $options: 'i' };
  if (status) query.status = status;
  if (type) query.type = type;
  if (activeArticle != null && activeArticle !== '') {
    query.activeArticle = mongoose.Types.ObjectId.isValid(activeArticle) && String(activeArticle).length === 24 ? activeArticle : null;
    if (query.activeArticle === null) delete query.activeArticle;
  }
  if (activeFloor) query.activeFloor = { $regex: activeFloor, $options: 'i' };
  if (quantity != null && quantity !== '') {
    const q = Number(quantity);
    if (!Number.isNaN(q) && q >= 0) query.quantity = q;
  }
  if (search && String(search).trim()) {
    const term = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(term, 'i');
    query.$or = [{ barcode: re }, { containerName: re }, { activeFloor: re }];
    if (mongoose.Types.ObjectId.isValid(term) && term.length === 24) query.$or.push({ activeArticle: new mongoose.Types.ObjectId(term) });
  }
  // Don't default-populate activeArticle on list: some docs may have empty string refs (legacy), which would cause CastError
  return ContainersMaster.paginate(query, options);
};

/**
 * Get container by id.
 * @param {string} id
 * @returns {Promise<ContainersMaster|null>}
 */
export const getContainersMasterById = async (id) => {
  return ContainersMaster.findById(id).populate('activeArticle');
};

/**
 * Get container by barcode (barcode stores the _id string).
 * @param {string} barcode
 * @returns {Promise<ContainersMaster|null>}
 */
export const getContainerByBarcode = async (barcode) => {
  if (!barcode || !String(barcode).trim()) return null;
  const trimmed = String(barcode).trim();
  let doc = await ContainersMaster.findOne({ barcode: trimmed }).populate('activeArticle');
  if (!doc && /^[0-9a-fA-F]{24}$/.test(trimmed)) {
    doc = await ContainersMaster.findById(trimmed).populate('activeArticle');
  }
  return doc || null;
};

/**
 * Update container by barcode (activeArticle, activeFloor, quantity).
 * @param {string} barcode
 * @param {{ activeArticle?: string, activeFloor?: string, quantity?: number }} body
 * @returns {Promise<ContainersMaster>}
 */
export const updateContainersMasterByBarcode = async (barcode, body) => {
  const doc = await getContainerByBarcode(barcode);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Container not found for this barcode');
  if (body.hasOwnProperty('activeArticle')) doc.activeArticle = body.activeArticle === '' || body.activeArticle == null ? null : body.activeArticle;
  if (body.hasOwnProperty('activeFloor')) doc.activeFloor = body.activeFloor || '';
  if (body.hasOwnProperty('quantity') && typeof body.quantity === 'number') doc.quantity = Math.max(0, Math.floor(body.quantity));
  await doc.save();
  return getContainerByBarcode(barcode);
};

/**
 * Accept container on receiving floor - updates article floor received from container data.
 * Auto-populates receivedTransferItems from previous floor's transferredData (Branding/Final Checking).
 * @param {string} barcode - Container barcode
 * @returns {Promise<{ container: ContainersMaster, article: Article }>}
 */
export const acceptContainerByBarcode = async (barcode) => {
  const doc = await getContainerByBarcode(barcode);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Container not found for this barcode');
  const article = doc.activeArticle;
  const floor = doc.activeFloor;
  const quantity = doc.quantity || 0;
  if (!article || !floor || quantity <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Container has no active article, floor, or quantity to accept');
  }
  const articleId = typeof article === 'object' ? article._id : article;
  const updatedArticle = await articleService.updateArticleFloorReceivedData(articleId.toString(), {
    floor,
    quantity,
    receivedData: {
      receivedStatusFromPreviousFloor: 'Completed',
      receivedInContainerId: doc._id,
      receivedTimestamp: new Date()
    }
  });
  return { container: doc, article: updatedArticle };
};

/**
 * Clear activeArticle and activeFloor for container by barcode.
 * @param {string} barcode
 * @returns {Promise<ContainersMaster>}
 */
export const clearActiveByBarcode = async (barcode) => {
  const doc = await getContainerByBarcode(barcode);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Container not found for this barcode');
  doc.activeArticle = null;
  doc.activeFloor = '';
  doc.quantity = 0;
  await doc.save();
  return getContainerByBarcode(barcode);
};

/**
 * Reset activeArticle, activeFloor, and quantity for all containers.
 * @returns {Promise<{ modifiedCount: number }>}
 */
export const resetAllActive = async () => {
  const result = await ContainersMaster.updateMany({}, { $set: { activeArticle: null, activeFloor: '', quantity: 0 } });
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
