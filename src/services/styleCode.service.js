import httpStatus from 'http-status';
import StyleCode from '../models/styleCode.model.js';
import ApiError from '../utils/ApiError.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Create a style code record
 * @param {Object} body
 * @returns {Promise<StyleCode>}
 */
export const createStyleCode = async (body) => {
  if (await StyleCode.findOne({ styleCode: body.styleCode })) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Style code already exists');
  }
  return StyleCode.create(body);
};

/**
 * Query style codes with optional fuzzy filters and search
 * @param {Object} filter
 * @param {Object} options
 * @param {string} [search]
 * @returns {Promise<QueryResult>}
 */
export const queryStyleCodes = async (filter, options, search) => {
  const query = {};
  const regexMatchFields = ['styleCode', 'eanCode', 'brand', 'pack'];
  const orConditions = [];

  regexMatchFields.forEach((field) => {
    if (filter?.[field]) {
      orConditions.push({ [field]: new RegExp(escapeRegex(filter[field]), 'i') });
    }
  });

  if (search && typeof search === 'string' && search.trim()) {
    const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');
    orConditions.push(
      { styleCode: searchRegex },
      { eanCode: searchRegex },
      { brand: searchRegex },
      { pack: searchRegex }
    );
  }

  if (orConditions.length === 1) {
    Object.assign(query, orConditions[0]);
  } else if (orConditions.length > 1) {
    query.$or = orConditions;
  }

  if (filter?.status) {
    query.status = filter.status;
  }

  return StyleCode.paginate(query, options);
};

/**
 * Get style code by id
 * @param {ObjectId} id
 * @returns {Promise<StyleCode>}
 */
export const getStyleCodeById = async (id) => StyleCode.findById(id);

/**
 * Update style code by id
 * @param {ObjectId} styleCodeId
 * @param {Object} updateBody
 * @returns {Promise<StyleCode>}
 */
export const updateStyleCodeById = async (styleCodeId, updateBody) => {
  const styleCode = await getStyleCodeById(styleCodeId);
  if (!styleCode) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Style code not found');
  }

  if (
    updateBody.styleCode &&
    updateBody.styleCode !== styleCode.styleCode &&
    (await StyleCode.findOne({ styleCode: updateBody.styleCode, _id: { $ne: styleCodeId } }))
  ) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Style code already exists');
  }

  Object.assign(styleCode, updateBody);
  await styleCode.save();
  return styleCode;
};

/**
 * Delete style code by id
 * @param {ObjectId} styleCodeId
 * @returns {Promise<StyleCode>}
 */
export const deleteStyleCodeById = async (styleCodeId) => {
  const styleCode = await getStyleCodeById(styleCodeId);
  if (!styleCode) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Style code not found');
  }
  await styleCode.deleteOne();
  return styleCode;
};

/**
 * Bulk import style codes (create or update by styleCode)
 * @param {Array} styleCodes
 * @param {number} batchSize
 * @returns {Promise<Object>}
 */
export const bulkImportStyleCodes = async (styleCodes, batchSize = 50) => {
  const results = {
    total: styleCodes.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };

  const startTime = Date.now();

  if (!Array.isArray(styleCodes) || styleCodes.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'styleCodes array is required');
  }

  for (let i = 0; i < styleCodes.length; i += batchSize) {
    const batch = styleCodes.slice(i, i + batchSize);
    const operations = batch.map(async (item, idx) => {
      const globalIndex = i + idx;
      try {
        const payload = {
          styleCode: item.styleCode?.trim(),
          eanCode: item.eanCode?.trim(),
          mrp: Number(item.mrp),
          brand: item.brand?.trim() || undefined,
          pack: item.pack?.trim() || undefined,
          status: item.status === 'inactive' ? 'inactive' : 'active',
        };

        if (!payload.styleCode || !payload.eanCode || Number.isNaN(payload.mrp)) {
          throw new Error('styleCode, eanCode, and mrp are required');
        }

        const existing = await StyleCode.findOne({ styleCode: payload.styleCode }).lean();
        if (existing) {
          await StyleCode.updateOne({ _id: existing._id }, { $set: payload });
          results.updated += 1;
        } else {
          await StyleCode.create(payload);
          results.created += 1;
        }
      } catch (error) {
        results.failed += 1;
        results.errors.push({
          index: globalIndex,
          styleCode: item.styleCode,
          error: error.message,
        });
      }
    });

    await Promise.all(operations);
  }

  results.processingTime = Date.now() - startTime;
  return results;
};
