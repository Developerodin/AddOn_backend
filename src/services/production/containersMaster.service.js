import httpStatus from 'http-status';
import ContainersMaster from '../../models/production/containersMaster.model.js';
import ApiError from '../../utils/ApiError.js';

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
 * Query containers with filter (containerFloor, status, search) and pagination.
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
export const queryContainersMasters = async (filter, options = {}) => {
  const { containerName, containerFloor, status, search, ...rest } = filter || {};
  const query = { ...rest };
  if (containerName) query.containerName = { $regex: containerName, $options: 'i' };
  if (containerFloor) query.containerFloor = containerFloor;
  if (status) query.status = status;
  if (search && String(search).trim()) {
    const term = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(term, 'i');
    query.$or = [{ barcode: re }, { containerName: re }];
  }
  return ContainersMaster.paginate(query, options);
};

/**
 * Get container by id.
 * @param {string} id
 * @returns {Promise<ContainersMaster|null>}
 */
export const getContainersMasterById = async (id) => {
  return ContainersMaster.findById(id);
};

/**
 * Get container by barcode (barcode stores the _id string).
 * @param {string} barcode
 * @returns {Promise<ContainersMaster|null>}
 */
export const getContainerByBarcode = async (barcode) => {
  if (!barcode || !String(barcode).trim()) return null;
  const trimmed = String(barcode).trim();
  const byBarcode = await ContainersMaster.findOne({ barcode: trimmed });
  if (byBarcode) return byBarcode;
  if (/^[0-9a-fA-F]{24}$/.test(trimmed)) return ContainersMaster.findById(trimmed);
  return null;
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
