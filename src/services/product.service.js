import httpStatus from 'http-status';
import mongoose from 'mongoose';
import Product from '../models/product.model.js';
import StyleCode from '../models/styleCode.model.js';
import ApiError from '../utils/ApiError.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeStyleCodeIds = (styleCodeIds) => {
  if (!Array.isArray(styleCodeIds)) {
    return [];
  }
  const uniqueIds = new Set();
  styleCodeIds.forEach((id) => {
    const normalized = String(id || '').trim();
    if (normalized) {
      uniqueIds.add(normalized);
    }
  });
  return Array.from(uniqueIds);
};

/** Extract ObjectId from cell value (e.g. "168 6990090b7cd417242c5e848f" → "6990090b7cd417242c5e848f") */
const extractObjectId = (value) => {
  if (!value) return '';
  const str = String(value).trim();
  const match = str.match(/[a-fA-F0-9]{24}/);
  return match ? match[0] : str;
};

const normalizeStyleCodeIdsForExcel = (ids) => {
  const uniqueIds = new Set();
  (ids || []).forEach((id) => {
    const extracted = extractObjectId(id);
    if (extracted && mongoose.Types.ObjectId.isValid(extracted)) uniqueIds.add(extracted);
  });
  return Array.from(uniqueIds);
};

const STANDARD_PRODUCT_KEYS = new Set([
  'id', 'name', 'softwareCode', 'internalCode', 'vendorCode', 'factoryCode', 'knittingCode',
  'Factory Code', 'Knitting Code', 'factory_code', 'knitting_code',
  'styleCodes', 'styleCodeId1', 'styleCodeId2', 'styleCodeId3', 'styleCodeId4', 'styleCodeId5',
  'styleCodeId6', 'styleCodeId7', 'styleCodeId8', 'styleCodeId9', 'styleCodeId10',
  'description', 'category', 'image', 'attributes', 'bom', 'processes', 'rawMaterials',
  'productionType', 'status',
]);

const collectStyleCodeIdsForExcel = (productData) => {
  const ids = [];
  if (Array.isArray(productData.styleCodes)) productData.styleCodes.forEach((id) => ids.push(id));
  for (let n = 1; n <= 10; n++) {
    const val = productData[`styleCodeId${n}`];
    if (val !== undefined && val !== null && String(val).trim() !== '') ids.push(val);
  }
  return normalizeStyleCodeIdsForExcel(ids);
};

/** Treat Excel "na", "N/A", "n/a" as empty - return trimmed value or empty string */
const normalizeExcelValue = (val) => {
  if (val === undefined || val === null) return '';
  const s = String(val).trim().toLowerCase();
  if (s === '' || s === 'na' || s === 'n/a') return '';
  return String(val).trim();
};

/** Needles - only this header is accepted and stored in attributes (same as PATCH edit API) */
const NEEDLES_KEY = 'Needles';

const getNeedlesValue = (productData) => {
  const v = productData[NEEDLES_KEY] ?? productData.attributes?.[NEEDLES_KEY];
  if (v !== undefined && v !== null && String(v).trim() !== '') return normalizeExcelValue(v);
  return null;
};

const collectAttributesForExcel = (productData) => {
  const attrs = {};
  if (productData.attributes && typeof productData.attributes === 'object') {
    Object.entries(productData.attributes).forEach(([k, v]) => {
      if (!k) return;
      const key = String(k).trim();
      if (key === NEEDLES_KEY) return;
      if (v !== undefined && v !== null && String(v).trim() !== '') attrs[key] = String(v).trim();
    });
  }
  const needlesVal = getNeedlesValue(productData);
  if (needlesVal !== null) attrs[NEEDLES_KEY] = needlesVal;
  Object.entries(productData).forEach(([k, v]) => {
    if (!STANDARD_PRODUCT_KEYS.has(k) && k !== NEEDLES_KEY && v !== undefined && v !== null && String(v).trim() !== '') {
      attrs[String(k).trim()] = String(v).trim();
    }
  });
  return attrs;
};

const ensureValidStyleCodes = async (styleCodeIds) => {
  const normalizedIds = normalizeStyleCodeIds(styleCodeIds);
  if (normalizedIds.length === 0) {
    return [];
  }

  const invalidId = normalizedIds.find((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalidId) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Invalid style code id: ${invalidId}`);
  }

  const count = await StyleCode.countDocuments({ _id: { $in: normalizedIds } });
  if (count !== normalizedIds.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'One or more style codes do not exist');
  }

  return normalizedIds;
};

/**
 * Create a product
 * @param {Object} productBody
 * @returns {Promise<Product>}
 */
export const createProduct = async (productBody) => {
  if (productBody.softwareCode && (await Product.findOne({ softwareCode: productBody.softwareCode }))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Software code already taken');
  }
  const styleCodes = await ensureValidStyleCodes(productBody.styleCodes);
  return Product.create({ ...productBody, styleCodes });
};

/**
 * Query for products
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @param {string} [options.populate] - Populate options
 * @param {string} [search] - Search term to filter across multiple fields
 * @returns {Promise<QueryResult>}
 */
export const queryProducts = async (filter, options, search) => {
  try {
    // Additional validation and debugging
    console.log('Service received filter:', filter);
    console.log('Service received options:', options);
    console.log('Service received search:', search);
    
    const queryOptions = options || {};

    // Ensure filter is a valid object
    const safeFilter = filter && typeof filter === 'object' ? { ...filter } : {};

    if (safeFilter._id) {
      console.warn('Removing _id from filter to prevent ObjectId casting issues');
      delete safeFilter._id;
    }

    // Extract style-code-related filters for lookup in StyleCode collection
    const styleCodeFilter = safeFilter.styleCode;
    const eanCodeFilter = safeFilter.eanCode;
    const brandFilter = safeFilter.brand;
    const packFilter = safeFilter.pack;
    delete safeFilter.styleCode;
    delete safeFilter.eanCode;
    delete safeFilter.brand;
    delete safeFilter.pack;

    const andConditions = [];
    if (Object.keys(safeFilter).length > 0) {
      andConditions.push(safeFilter);
    }

    // Apply direct style filters via StyleCode lookup
    const styleCodeConditions = [];
    if (styleCodeFilter) {
      styleCodeConditions.push({ styleCode: new RegExp(escapeRegex(styleCodeFilter), 'i') });
    }
    if (eanCodeFilter) {
      styleCodeConditions.push({ eanCode: new RegExp(escapeRegex(eanCodeFilter), 'i') });
    }
    if (brandFilter) {
      styleCodeConditions.push({ brand: new RegExp(escapeRegex(brandFilter), 'i') });
    }
    if (packFilter) {
      styleCodeConditions.push({ pack: new RegExp(escapeRegex(packFilter), 'i') });
    }

    if (styleCodeConditions.length > 0) {
      const styleQuery = styleCodeConditions.length === 1 ? styleCodeConditions[0] : { $and: styleCodeConditions };
      const matchingStyleCodes = await StyleCode.find(styleQuery).select('_id').lean();
      const matchingStyleIds = matchingStyleCodes.map((doc) => doc._id);

      if (matchingStyleIds.length === 0) {
        return Product.paginate({ styleCodes: { $in: [] } }, queryOptions);
      }
      andConditions.push({ styleCodes: { $in: matchingStyleIds } });
    }

    // Handle search parameter - search across product fields + style code master
    if (search && typeof search === 'string' && search.trim()) {
      const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');
      const productSearchFields = [
        { name: searchRegex },
        { softwareCode: searchRegex },
        { internalCode: searchRegex },
        { vendorCode: searchRegex },
        { factoryCode: searchRegex },
        { knittingCode: searchRegex },
        { description: searchRegex },
      ];

      const matchingStyleCodes = await StyleCode.find({
        $or: [
          { styleCode: searchRegex },
          { eanCode: searchRegex },
          { brand: searchRegex },
          { pack: searchRegex },
        ],
      })
        .select('_id')
        .lean();

      const searchStyleIds = matchingStyleCodes.map((doc) => doc._id);
      const searchOr = [...productSearchFields];
      if (searchStyleIds.length > 0) {
        searchOr.push({ styleCodes: { $in: searchStyleIds } });
      }

      if (searchOr.length > 0) {
        andConditions.push({ $or: searchOr });
      }
    }

    let finalFilter = {};
    if (andConditions.length === 1) {
      finalFilter = andConditions[0];
    } else if (andConditions.length > 1) {
      finalFilter = { $and: andConditions };
    }

    // Add default population for category; avoid styleCodes populate to prevent casting errors on legacy docs
    if (!queryOptions.populate) {
      queryOptions.populate = 'category';
    } else {
      const segments = new Set(queryOptions.populate.split(',').map((entry) => entry.trim()).filter(Boolean));
      segments.add('category');
      // intentionally skip forcing styleCodes to avoid casting legacy embedded objects
      queryOptions.populate = Array.from(segments).join(',');
    }
    
    const products = await Product.paginate(finalFilter, queryOptions);
    return products;
  } catch (error) {
    // Handle ObjectId casting errors
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      throw new ApiError(
        httpStatus.BAD_REQUEST, 
        `Invalid ID format: ${error.value}. Please provide a valid 24-character hexadecimal ID.`
      );
    }
    // Re-throw other errors
    throw error;
  }
};

/**
 * Get product by id
 * @param {ObjectId} id
 * @returns {Promise<Product>}
 */
export const getProductById = async (id) => {
  return Product.findById(id)
    .populate('category', 'name')
    .populate('bom.yarnCatalogId', 'yarnName yarnType countSize blend colorFamily')
    .populate('processes.processId', 'name type');
};

/**
 * Get product by factoryCode or internalCode
 * @param {string} factoryCode - Factory code (optional)
 * @param {string} internalCode - Internal code (optional)
 * @returns {Promise<Product|null>}
 */
export const getProductByCode = async (factoryCode, internalCode) => {
  const filter = {};
  
  // Handle factoryCode - case-insensitive exact match with trimmed value
  if (factoryCode) {
    const trimmedCode = String(factoryCode).trim();
    if (trimmedCode) {
      // Use case-insensitive regex for exact match
      filter.factoryCode = { $regex: new RegExp(`^${trimmedCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
    }
  }
  
  // Handle internalCode - case-insensitive exact match with trimmed value
  if (internalCode) {
    const trimmedCode = String(internalCode).trim();
    if (trimmedCode) {
      // Use case-insensitive regex for exact match
      filter.internalCode = { $regex: new RegExp(`^${trimmedCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
    }
  }
  
  if (!factoryCode && !internalCode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Either factoryCode or internalCode must be provided');
  }
  
  if (Object.keys(filter).length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Valid factoryCode or internalCode must be provided');
  }
  
  console.log('Searching product with filter:', JSON.stringify(filter));
  
  const product = await Product.findOne(filter)
    .populate('category', 'name')
    .populate('bom.yarnCatalogId', 'yarnName yarnType countSize blend colorFamily')
    .populate('processes.processId', 'name type');
  
  if (!product) {
    console.log('Product not found with filter:', JSON.stringify(filter));
  }
  
  return product;
};

/**
 * Update product by id
 * @param {ObjectId} productId
 * @param {Object} updateBody
 * @returns {Promise<Product>}
 */
export const updateProductById = async (productId, updateBody) => {
  const product = await getProductById(productId);
  if (!product) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }
  if (updateBody.softwareCode && (await Product.findOne({ softwareCode: updateBody.softwareCode, _id: { $ne: productId } }))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Software code already taken');
  }
  let styleCodes;
  if (updateBody.styleCodes) {
    styleCodes = await ensureValidStyleCodes(updateBody.styleCodes);
  }
  Object.assign(product, { ...updateBody, ...(styleCodes ? { styleCodes } : {}) });
  await product.save();
  return product;
};

/**
 * Delete product by id
 * @param {ObjectId} productId
 * @returns {Promise<Product>}
 */
export const deleteProductById = async (productId) => {
  const product = await getProductById(productId);
  if (!product) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }
  await product.deleteOne();
  return product;
};

/**
 * Bulk import products with batch processing
 * @param {Array} products - Array of product objects
 * @param {number} batchSize - Number of products to process in each batch
 * @returns {Promise<Object>} - Results of the bulk import operation
 */
export const bulkImportProducts = async (products, batchSize = 50) => {
  const results = {
    total: products.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };

  const startTime = Date.now();

  try {
    // Validate input size
    if (products.length > 10000) {
      throw new Error('Maximum 10000 products allowed per request');
    }

    const styleCodeIdSet = new Set();
    products.forEach((product) => {
      if (Array.isArray(product.styleCodes)) {
        product.styleCodes.forEach((id) => {
          const normalized = String(id || '').trim();
          if (normalized) styleCodeIdSet.add(normalized);
        });
      }
    });

    const allStyleCodeIds = Array.from(styleCodeIdSet);

    let existingStyleCodeIdSet = new Set();
    if (allStyleCodeIds.length > 0) {
      const invalidStyleCodeId = allStyleCodeIds.find((id) => !mongoose.Types.ObjectId.isValid(id));
      if (invalidStyleCodeId) {
        throw new Error(`Invalid style code id: ${invalidStyleCodeId}`);
      }

      const existingStyleCodes = await StyleCode.find({ _id: { $in: allStyleCodeIds } }).select('_id').lean();
      existingStyleCodeIdSet = new Set(existingStyleCodes.map((doc) => String(doc._id)));
    }

    // Estimate memory usage (rough calculation)
    const estimatedMemoryMB = (products.length * 1000) / (1024 * 1024); // ~1KB per product
    if (estimatedMemoryMB > 100) {
      console.warn(`Large bulk import detected: ${estimatedMemoryMB.toFixed(2)} MB estimated memory usage`);
    }

    // Process products in batches
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      try {
        // Process each product in the current batch
        const batchPromises = batch.map(async (productData, batchIndex) => {
          const globalIndex = i + batchIndex;
          
          try {
            const hasId = productData.id && productData.id.trim() !== '';

            const normalizedStyleCodes = normalizeStyleCodeIds(productData.styleCodes);
            if (normalizedStyleCodes.length > 0) {
              const missingStyleCode = normalizedStyleCodes.find((id) => !existingStyleCodeIdSet.has(String(id)));
              if (missingStyleCode) {
                throw new Error(`Style code not found: ${missingStyleCode}`);
              }
            }
            
            const processedData = {
              name: productData.name?.trim(),
              styleCodes: normalizedStyleCodes,
              internalCode: productData.internalCode?.trim() || '',
              vendorCode: productData.vendorCode?.trim() || '',
              factoryCode: productData.factoryCode?.trim() || '',
              knittingCode: productData.knittingCode?.trim() || '',
              description: productData.description?.trim() || '',
              category: productData.category || null,
              attributes: {},
              bom: [],
              processes: [],
              rawMaterials: Array.isArray(productData.rawMaterials)
                ? productData.rawMaterials
                    .map((item) => {
                      const rawMaterialId = item?.rawMaterialId || item?.rawMaterial || item?._id || item?.id;
                      const quantity = item?.quantity;
                      const normalizedId = rawMaterialId ? String(rawMaterialId).trim() : '';
                      if (!normalizedId) return null;
                      if (!mongoose.Types.ObjectId.isValid(normalizedId)) return null;
                      const parsedQty =
                        typeof quantity === 'number'
                          ? quantity
                          : quantity !== undefined
                            ? parseFloat(quantity) || 0
                            : 0;
                      return { rawMaterialId: normalizedId, quantity: parsedQty < 0 ? 0 : parsedQty };
                    })
                    .filter(Boolean)
                : [],
              productionType: productData.productionType === 'outsourced' ? 'outsourced' : 'internal',
              status: 'active',
            };

            if (!hasId) {
              const timestamp = Date.now().toString(36);
              const random = Math.random().toString(36).substring(2, 7);
              processedData.softwareCode = productData.softwareCode?.trim() || `PRD-${timestamp}-${random}`.toUpperCase();
            } else {
              processedData.softwareCode = productData.softwareCode?.trim() || '';
            }

            if (hasId) {
              const existingProduct = await Product.findById(productData.id).lean();
              if (!existingProduct) {
                throw new Error(`Product with ID ${productData.id} not found`);
              }
              if (processedData.softwareCode && processedData.softwareCode !== existingProduct.softwareCode) {
                const duplicateCheck = await Product.findOne({ softwareCode: processedData.softwareCode, _id: { $ne: productData.id } }).lean();
                if (duplicateCheck) {
                  throw new Error(`Software code ${processedData.softwareCode} already exists`);
                }
              }
              await Product.updateOne({ _id: productData.id }, { $set: processedData });
              results.updated++;
            } else {
              if (await Product.findOne({ softwareCode: processedData.softwareCode }).lean()) {
                throw new Error(`Software code ${processedData.softwareCode} already exists`);
              }
              await Product.create(processedData);
              results.created++;
            }
          } catch (error) {
            results.failed++;
            results.errors.push({
              index: globalIndex,
              productName: productData.name || `Product ${globalIndex + 1}`,
              error: error.message,
            });
          }
        });

        // Wait for all products in the current batch to complete
        await Promise.all(batchPromises);
        
        const batchTime = Date.now() - batchStartTime;
        console.log(`Batch ${Math.floor(i / batchSize) + 1} completed in ${batchTime}ms (${batch.length} products)`);
        
        // Add a small delay between batches to prevent overwhelming the system
        if (i + batchSize < products.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        // If batch processing fails, add all remaining products as failed
        const remainingProducts = products.slice(i);
        remainingProducts.forEach((productData, index) => {
          results.failed++;
          results.errors.push({
            index: i + index,
            productName: productData.name || `Product ${i + index + 1}`,
            error: 'Batch processing failed',
          });
        });
        break;
      }
    }

    results.processingTime = Date.now() - startTime;
    console.log(`Bulk import completed in ${results.processingTime}ms: ${results.created} created, ${results.updated} updated, ${results.failed} failed`);

  } catch (error) {
    results.processingTime = Date.now() - startTime;
    throw new ApiError(httpStatus.BAD_REQUEST, error.message);
  }

  return results;
};

/**
 * Bulk upsert products (Excel-friendly): partial updates, styleCodeId1-10, dynamic attributes
 * POST /v1/products/bulk-upsert - Use this for Excel import (update only provided fields)
 * @param {Array} products - Array of product objects from Excel JSON
 * @param {number} batchSize - Batch size
 * @returns {Promise<Object>} - Results
 */
export const bulkUpsertProducts = async (products, batchSize = 50) => {
  const results = {
    total: products.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
    productsUpdated: [],
    productsCreated: [],
  };
  const startTime = Date.now();
  console.log(`[bulkUpsert] Starting: ${products.length} products, batchSize=${batchSize}`);

  try {
    if (products.length > 10000) throw new Error('Maximum 10000 products allowed per request');

    const styleCodeIdSet = new Set();
    products.forEach((p) => collectStyleCodeIdsForExcel(p).forEach((id) => styleCodeIdSet.add(id)));
    const allStyleCodeIds = Array.from(styleCodeIdSet);

    let existingStyleCodeIdSet = new Set();
    if (allStyleCodeIds.length > 0) {
      const invalid = allStyleCodeIds.find((id) => !mongoose.Types.ObjectId.isValid(id));
      if (invalid) throw new Error(`Invalid style code id: ${invalid}`);
      const existing = await StyleCode.find({ _id: { $in: allStyleCodeIds } }).select('_id').lean();
      existingStyleCodeIdSet = new Set(existing.map((doc) => String(doc._id)));
    }
    console.log(`[bulkUpsert] Validated ${allStyleCodeIds.length} unique style code IDs`);

    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      console.log(`[bulkUpsert] Processing batch ${batchNum} (rows ${i + 1}-${Math.min(i + batchSize, products.length)})`);
      const batchPromises = batch.map(async (productData, batchIndex) => {
        const globalIndex = i + batchIndex;
        try {
          const hasId = productData.id !== undefined && productData.id !== null && String(productData.id).trim() !== '';
          const normalizedStyleCodes = collectStyleCodeIdsForExcel(productData);
          if (normalizedStyleCodes.length > 0) {
            const missing = normalizedStyleCodes.find((id) => !existingStyleCodeIdSet.has(String(id)));
            if (missing) throw new Error(`Style code not found: ${missing}`);
          }

          const collectedAttributes = collectAttributesForExcel(productData);
          const hasProvidedAttributes = Object.keys(collectedAttributes).length > 0;

          if (hasId) {
            const existingProduct = await Product.findById(productData.id).lean();
            if (!existingProduct) throw new Error(`Product with ID ${productData.id} not found`);

            const $set = {};
            const knittingCodeRaw = productData.knittingCode ?? productData['Knitting Code'] ?? productData.knitting_code;
            const factoryCodeRaw = productData.factoryCode ?? productData['Factory Code'] ?? productData.factory_code;
            const hasKnittingCode = knittingCodeRaw !== undefined && knittingCodeRaw !== null;
            const hasFactoryCode = factoryCodeRaw !== undefined && factoryCodeRaw !== null;
            if (productData.name !== undefined && productData.name !== null && String(productData.name).trim() !== '')
              $set.name = String(productData.name).trim();
            if (hasKnittingCode) $set.knittingCode = normalizeExcelValue(knittingCodeRaw);
            if (hasFactoryCode) $set.factoryCode = normalizeExcelValue(factoryCodeRaw);
            if (normalizedStyleCodes.length > 0) $set.styleCodes = normalizedStyleCodes;
            if (hasProvidedAttributes) {
              Object.entries(collectedAttributes).forEach(([k, v]) => {
                $set[`attributes.${k}`] = v;
              });
              if (collectedAttributes.Needles) {
                console.log(`[bulkUpsert] Setting Needles=${collectedAttributes.Needles} for product id=${productData.id}`);
              }
            }
            if (Object.keys($set).length === 0) throw new Error('No valid fields to update');
            if ($set.softwareCode && $set.softwareCode !== existingProduct.softwareCode) {
              const dup = await Product.findOne({ softwareCode: $set.softwareCode, _id: { $ne: productData.id } }).lean();
              if (dup) throw new Error(`Software code ${$set.softwareCode} already exists`);
            }
            const updatedFields = Object.keys($set).map((k) =>
              k.startsWith('attributes.') ? `attributes.${k.split('.')[1]}` : k
            );
            await Product.updateOne({ _id: productData.id }, { $set });
            results.updated++;
            results.productsUpdated.push({
              id: productData.id,
              name: productData.name || existingProduct.name,
              updatedFields,
            });
            console.log(`[bulkUpsert] Updated product id=${productData.id} name="${productData.name || existingProduct.name}"`);
          } else {
            const name = productData.name?.trim();
            const description = (productData.description?.trim() ?? productData.name ?? '').trim();
            const category = productData.category || null;
            if (!name) throw new Error('Name is required for new products');
            if (!category) throw new Error('Category is required for new products');
            let softwareCode = productData.softwareCode?.trim();
            if (!softwareCode) {
              softwareCode = `PRD-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`.toUpperCase();
            }
            if (await Product.findOne({ softwareCode }).lean()) throw new Error(`Software code ${softwareCode} already exists`);
            const knittingCodeVal = normalizeExcelValue(
              productData.knittingCode ?? productData['Knitting Code'] ?? productData.knitting_code ?? ''
            );
            const factoryCodeVal = normalizeExcelValue(
              productData.factoryCode ?? productData['Factory Code'] ?? productData.factory_code ?? ''
            );
            const processedData = {
              name,
              styleCodes: normalizedStyleCodes,
              internalCode: productData.internalCode?.trim() ?? '',
              vendorCode: productData.vendorCode?.trim() ?? '',
              factoryCode: factoryCodeVal,
              knittingCode: knittingCodeVal,
              description,
              category,
              softwareCode,
              attributes: collectedAttributes,
              bom: [],
              processes: [],
              rawMaterials: Array.isArray(productData.rawMaterials)
                ? productData.rawMaterials
                    .map((item) => {
                      const rawMaterialId = item?.rawMaterialId || item?.rawMaterial || item?._id || item?.id;
                      const quantity = item?.quantity;
                      const normalizedId = rawMaterialId ? String(rawMaterialId).trim() : '';
                      if (!normalizedId) return null;
                      if (!mongoose.Types.ObjectId.isValid(normalizedId)) return null;
                      const parsedQty = typeof quantity === 'number' ? quantity : quantity !== undefined ? parseFloat(quantity) || 0 : 0;
                      return { rawMaterialId: normalizedId, quantity: parsedQty < 0 ? 0 : parsedQty };
                    })
                    .filter(Boolean)
                : [],
              productionType: productData.productionType === 'outsourced' ? 'outsourced' : 'internal',
              status: 'active',
            };
            const createdProduct = await Product.create(processedData);
            results.created++;
            results.productsCreated.push({
              id: createdProduct._id,
              name,
              softwareCode: processedData.softwareCode,
            });
            console.log(`[bulkUpsert] Created product name="${name}" softwareCode=${processedData.softwareCode}`);
          }
        } catch (error) {
          results.failed++;
          results.errors.push({ index: globalIndex, productName: productData.name || `Product ${globalIndex + 1}`, error: error.message });
          console.log(`[bulkUpsert] Failed row ${globalIndex + 1} name="${productData.name || `Product ${globalIndex + 1}`}": ${error.message}`);
        }
      });
      await Promise.all(batchPromises);
      if (i + batchSize < products.length) await new Promise((resolve) => setTimeout(resolve, 100));
    }

    results.processingTime = Date.now() - startTime;
    console.log(`[bulkUpsert] Completed in ${results.processingTime}ms: ${results.created} created, ${results.updated} updated, ${results.failed} failed`);
  } catch (error) {
    results.processingTime = Date.now() - startTime;
    console.error(`[bulkUpsert] Error: ${error.message}`);
    throw new ApiError(httpStatus.BAD_REQUEST, error.message);
  }
  return results;
};

/**
 * Bulk export products as JSON (for frontend to convert to Excel)
 * Supports same filters as queryProducts: filter, options, search
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options (sortBy, limit, page)
 * @param {string} [search] - Search term
 * @returns {Promise<Object>} - { products, total }
 */
export const bulkExportProducts = async (filter, options = {}, search) => {
  const queryOptions = options || {};
  const safeFilter = filter && typeof filter === 'object' ? { ...filter } : {};
  if (safeFilter._id) delete safeFilter._id;

  const styleCodeFilter = safeFilter.styleCode;
  const eanCodeFilter = safeFilter.eanCode;
  const brandFilter = safeFilter.brand;
  const packFilter = safeFilter.pack;
  delete safeFilter.styleCode;
  delete safeFilter.eanCode;
  delete safeFilter.brand;
  delete safeFilter.pack;

  const andConditions = [];
  if (Object.keys(safeFilter).length > 0) andConditions.push(safeFilter);

  const styleCodeConditions = [];
  if (styleCodeFilter) styleCodeConditions.push({ styleCode: new RegExp(escapeRegex(styleCodeFilter), 'i') });
  if (eanCodeFilter) styleCodeConditions.push({ eanCode: new RegExp(escapeRegex(eanCodeFilter), 'i') });
  if (brandFilter) styleCodeConditions.push({ brand: new RegExp(escapeRegex(brandFilter), 'i') });
  if (packFilter) styleCodeConditions.push({ pack: new RegExp(escapeRegex(packFilter), 'i') });

  if (styleCodeConditions.length > 0) {
    const styleQuery = styleCodeConditions.length === 1 ? styleCodeConditions[0] : { $and: styleCodeConditions };
    const matchingStyleCodes = await StyleCode.find(styleQuery).select('_id').lean();
    const matchingStyleIds = matchingStyleCodes.map((doc) => doc._id);
    if (matchingStyleIds.length === 0) {
      return { products: [], total: 0 };
    }
    andConditions.push({ styleCodes: { $in: matchingStyleIds } });
  }

  if (search && typeof search === 'string' && search.trim()) {
    const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');
    const productSearchFields = [
      { name: searchRegex },
      { softwareCode: searchRegex },
      { internalCode: searchRegex },
      { vendorCode: searchRegex },
      { factoryCode: searchRegex },
      { knittingCode: searchRegex },
      { description: searchRegex },
    ];
    const matchingStyleCodes = await StyleCode.find({
      $or: [
        { styleCode: searchRegex },
        { eanCode: searchRegex },
        { brand: searchRegex },
        { pack: searchRegex },
      ],
    })
      .select('_id')
      .lean();
    const searchStyleIds = matchingStyleCodes.map((doc) => doc._id);
    const searchOr = [...productSearchFields];
    if (searchStyleIds.length > 0) searchOr.push({ styleCodes: { $in: searchStyleIds } });
    if (searchOr.length > 0) andConditions.push({ $or: searchOr });
  }

  let finalFilter = {};
  if (andConditions.length === 1) finalFilter = andConditions[0];
  else if (andConditions.length > 1) finalFilter = { $and: andConditions };

  const limit = Math.min(Math.max(parseInt(queryOptions.limit, 10) || 10000, 1), 10000);
  const page = Math.max(parseInt(queryOptions.page, 10) || 1, 1);
  const sort = queryOptions.sortBy || 'createdAt:desc';
  const [sortField, sortOrder] = sort.split(':');
  const sortObj = { [sortField || 'createdAt']: sortOrder === 'asc' ? 1 : -1 };

  const [products, total] = await Promise.all([
    Product.find(finalFilter)
      .sort(sortObj)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('category', 'name')
      .lean(),
    Product.countDocuments(finalFilter),
  ]);

  const exportRows = products.map((p) => {
    let rawAttrs = {};
    if (p.attributes) {
      rawAttrs = p.attributes instanceof Map ? Object.fromEntries(p.attributes) : (typeof p.attributes === 'object' ? p.attributes : {});
    }
    const needlesVal = rawAttrs.Needles ?? '';
    const attrsNoNeedles = { ...rawAttrs };
    delete attrsNoNeedles.Needles;
    const row = {
      id: p._id,
      name: p.name || '',
      softwareCode: p.softwareCode || '',
      internalCode: p.internalCode || '',
      vendorCode: normalizeExcelValue(p.vendorCode ?? ''),
      factoryCode: normalizeExcelValue(p.factoryCode ?? ''),
      knittingCode: normalizeExcelValue(p.knittingCode ?? ''),
      description: p.description,
      category: p.category?.name || p.category,
      productionType: p.productionType,
      status: p.status,
      ...attrsNoNeedles,
      Needles: normalizeExcelValue(needlesVal),
    };
    const styleCodes = Array.isArray(p.styleCodes)
      ? p.styleCodes.map((s) => (s && typeof s === 'object' && s._id ? String(s._id) : s != null ? String(s) : ''))
      : [];
    styleCodes.forEach((id, idx) => {
      row[`styleCodeId${idx + 1}`] = id;
    });
    return row;
  });

  return { products: exportRows, total };
}; 