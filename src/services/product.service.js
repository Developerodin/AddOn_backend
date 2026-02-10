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
          if (normalized) {
            styleCodeIdSet.add(normalized);
          }
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
            
            // Prepare product data with minimal memory footprint
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
                      return {
                        rawMaterialId: normalizedId,
                        quantity: parsedQty < 0 ? 0 : parsedQty,
                      };
                    })
                    .filter(Boolean)
                : [],
              productionType: productData.productionType === 'outsourced' ? 'outsourced' : 'internal',
              status: 'active',
            };

            // Generate software code for new products
            if (!hasId) {
              if (!productData.softwareCode) {
                const timestamp = Date.now().toString(36);
                const random = Math.random().toString(36).substring(2, 7);
                processedData.softwareCode = `PRD-${timestamp}-${random}`.toUpperCase();
              } else {
                processedData.softwareCode = productData.softwareCode?.trim();
              }
            } else {
              processedData.softwareCode = productData.softwareCode?.trim() || '';
            }

            if (hasId) {
              // Update existing product
              const existingProduct = await Product.findById(productData.id).lean();
              if (!existingProduct) {
                throw new Error(`Product with ID ${productData.id} not found`);
              }
              
              // Check for software code conflicts
              if (processedData.softwareCode && processedData.softwareCode !== existingProduct.softwareCode) {
                const duplicateCheck = await Product.findOne({ 
                  softwareCode: processedData.softwareCode, 
                  _id: { $ne: productData.id } 
                }).lean();
                if (duplicateCheck) {
                  throw new Error(`Software code ${processedData.softwareCode} already exists`);
                }
              }
              
              // Use updateOne for better performance
              await Product.updateOne(
                { _id: productData.id },
                { $set: processedData }
              );
              results.updated++;
            } else {
              // Create new product
              // Check for software code conflicts
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