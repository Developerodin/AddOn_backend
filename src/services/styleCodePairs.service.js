import httpStatus from 'http-status';
import mongoose from 'mongoose';
import StyleCodePairs from '../models/styleCodePairs.model.js';
import StyleCode from '../models/styleCode.model.js';
import RawMaterial from '../models/rawMaterial.model.js';
import ApiError from '../utils/ApiError.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Create a style code pairs record
 * @param {Object} body
 * @returns {Promise<StyleCodePairs>}
 */
export const createStyleCodePairs = async (body) => {
  if (await StyleCodePairs.findOne({ pairStyleCode: body.pairStyleCode })) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Pair style code already exists');
  }
  const doc = await StyleCodePairs.create(body);
  return doc.populate(['styleCodes', 'bom.rawMaterial']);
};

/**
 * Query style code pairs with optional filters and search
 * @param {Object} filter
 * @param {Object} options
 * @param {string} [search]
 * @returns {Promise<QueryResult>}
 */
export const queryStyleCodePairs = async (filter, options, search) => {
  const query = {};
  const regexMatchFields = ['pairStyleCode', 'eanCode'];
  const orConditions = [];

  regexMatchFields.forEach((field) => {
    if (filter?.[field]) {
      orConditions.push({ [field]: new RegExp(escapeRegex(filter[field]), 'i') });
    }
  });

  if (search && typeof search === 'string' && search.trim()) {
    const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');
    orConditions.push({ pairStyleCode: searchRegex }, { eanCode: searchRegex });
  }

  if (orConditions.length === 1) {
    Object.assign(query, orConditions[0]);
  } else if (orConditions.length > 1) {
    query.$or = orConditions;
  }

  if (filter?.status) {
    query.status = filter.status;
  }

  const paginateOptions = { ...options, populate: 'styleCodes,bom.rawMaterial' };
  return StyleCodePairs.paginate(query, paginateOptions);
};

/**
 * Get style code pairs by id
 * @param {ObjectId} id
 * @returns {Promise<StyleCodePairs>}
 */
export const getStyleCodePairsById = async (id) =>
  StyleCodePairs.findById(id)
    .populate('styleCodes')
    .populate('bom.rawMaterial');

/**
 * Update style code pairs by id
 * @param {ObjectId} styleCodePairsId
 * @param {Object} updateBody
 * @returns {Promise<StyleCodePairs>}
 */
export const updateStyleCodePairsById = async (styleCodePairsId, updateBody) => {
  const doc = await StyleCodePairs.findById(styleCodePairsId);
  if (!doc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Style code pairs not found');
  }

  if (
    updateBody.pairStyleCode &&
    updateBody.pairStyleCode !== doc.pairStyleCode &&
    (await StyleCodePairs.findOne({ pairStyleCode: updateBody.pairStyleCode, _id: { $ne: styleCodePairsId } }))
  ) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Pair style code already exists');
  }

  Object.assign(doc, updateBody);
  await doc.save();
  return doc.populate('styleCodes').populate('bom.rawMaterial');
};

/**
 * Delete style code pairs by id
 * @param {ObjectId} styleCodePairsId
 * @returns {Promise<StyleCodePairs>}
 */
export const deleteStyleCodePairsById = async (styleCodePairsId) => {
  const doc = await StyleCodePairs.findById(styleCodePairsId);
  if (!doc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Style code pairs not found');
  }
  await doc.deleteOne();
  return doc;
};

/**
 * Bulk import style code pairs (create or update by pairStyleCode)
 * @param {Array} items
 * @param {number} batchSize
 * @returns {Promise<Object>}
 */
export const bulkImportStyleCodePairs = async (items, batchSize = 50) => {
  const results = {
    total: items.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };

  const startTime = Date.now();

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const operations = batch.map(async (item, idx) => {
      const globalIndex = i + idx;
      try {
        const payload = {
          pairStyleCode: item.pairStyleCode?.trim(),
          eanCode: item.eanCode?.trim(),
          mrp: Number(item.mrp),
          pack: Number(item.pack),
          status: item.status === 'inactive' ? 'inactive' : 'active',
          styleCodes: Array.isArray(item.styleCodes) ? item.styleCodes : [],
          bom: Array.isArray(item.bom) ? item.bom : [],
        };

        if (!payload.pairStyleCode || !payload.eanCode || Number.isNaN(payload.mrp) || Number.isNaN(payload.pack)) {
          throw new Error('pairStyleCode, eanCode, mrp, and pack are required');
        }

        if (payload.bom.length > 0) {
          const rawMaterialIds = payload.bom.map((b) => b.rawMaterial);
          const existingRawMaterials = await RawMaterial.find({ _id: { $in: rawMaterialIds } })
            .select('_id')
            .lean();
          const validIds = new Set(existingRawMaterials.map((r) => String(r._id)));
          const invalidIds = rawMaterialIds.filter((id) => !validIds.has(String(id)));
          if (invalidIds.length > 0) {
            throw new Error(`Invalid raw material IDs: ${invalidIds.join(', ')}`);
          }
        }

        const bomPayload = payload.bom.map((b) => ({
          rawMaterial: new mongoose.Types.ObjectId(b.rawMaterial),
          quantity: Number(b.quantity),
        }));
        payload.bom = bomPayload;

        if (payload.styleCodes.length > 0) {
          const isObjectId = (v) => /^[a-fA-F0-9]{24}$/.test(v);
          if (isObjectId(payload.styleCodes[0])) {
            payload.styleCodes = payload.styleCodes.map((id) => new mongoose.Types.ObjectId(id));
          } else {
            const styleCodeDocs = await StyleCode.find({ styleCode: { $in: payload.styleCodes } })
              .select('_id styleCode')
              .lean();
            const foundCodes = new Set(styleCodeDocs.map((d) => d.styleCode));
            const missingCodes = payload.styleCodes.filter((code) => !foundCodes.has(code));
            if (missingCodes.length > 0) {
              throw new Error(`Invalid style codes not found: ${missingCodes.join(', ')}`);
            }
            payload.styleCodes = styleCodeDocs.map((d) => d._id);
          }
        }

        const existing = await StyleCodePairs.findOne({ pairStyleCode: payload.pairStyleCode }).lean();
        if (existing) {
          await StyleCodePairs.updateOne({ _id: existing._id }, { $set: payload });
          results.updated += 1;
        } else {
          await StyleCodePairs.create(payload);
          results.created += 1;
        }
      } catch (error) {
        results.failed += 1;
        results.errors.push({
          index: globalIndex,
          pairStyleCode: item.pairStyleCode,
          error: error.message,
        });
      }
    });

    await Promise.all(operations);
  }

  results.processingTime = Date.now() - startTime;
  return results;
};

/**
 * Bulk import BOM for style code pairs by ID
 * @param {Array} items - [{ styleCodePairsId, bom: [{ rawMaterial, quantity }] }]
 * @param {number} batchSize
 * @returns {Promise<Object>}
 */
export const bulkImportBom = async (items, batchSize = 50) => {
  const results = {
    total: items.length,
    updated: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };

  const startTime = Date.now();

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const operations = batch.map(async (item, idx) => {
      const globalIndex = i + idx;
      try {
        const doc = await StyleCodePairs.findById(item.styleCodePairsId);
        if (!doc) {
          throw new Error('Style code pairs not found');
        }

        const rawMaterialIds = item.bom.map((b) => b.rawMaterial);
        const existingRawMaterials = await RawMaterial.find({ _id: { $in: rawMaterialIds } })
          .select('_id')
          .lean();
        const validIds = new Set(existingRawMaterials.map((r) => String(r._id)));
        const invalidIds = rawMaterialIds.filter((id) => !validIds.has(String(id)));
        if (invalidIds.length > 0) {
          throw new Error(`Invalid raw material IDs: ${invalidIds.join(', ')}`);
        }

        const bomPayload = item.bom.map((b) => ({
          rawMaterial: new mongoose.Types.ObjectId(b.rawMaterial),
          quantity: Number(b.quantity),
        }));

        await StyleCodePairs.updateOne(
          { _id: item.styleCodePairsId },
          { $set: { bom: bomPayload } }
        );
        results.updated += 1;
      } catch (error) {
        results.failed += 1;
        results.errors.push({
          index: globalIndex,
          styleCodePairsId: item.styleCodePairsId,
          error: error.message,
        });
      }
    });

    await Promise.all(operations);
  }

  results.processingTime = Date.now() - startTime;
  return results;
};
