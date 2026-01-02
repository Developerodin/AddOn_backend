import httpStatus from 'http-status';
import Product from '../models/product.model.js';
import ApiError from '../utils/ApiError.js';

/**
 * Create a product
 * @param {Object} productBody
 * @returns {Promise<Product>}
 */
export const createProduct = async (productBody) => {
  if (await Product.findOne({ softwareCode: productBody.softwareCode })) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Software code already taken');
  }
  return Product.create(productBody);
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
    
    // Ensure filter is a valid object
    if (!filter || typeof filter !== 'object') {
      filter = {};
    }
    
    // Remove any potential _id field that might cause issues
    if (filter._id) {
      console.warn('Removing _id from filter to prevent ObjectId casting issues');
      delete filter._id;
    }
    
    // Handle styleCode and eanCode filters - convert to array queries
    const styleCodeFilter = filter.styleCode;
    const eanCodeFilter = filter.eanCode;
    if (styleCodeFilter || eanCodeFilter) {
      const arrayFilters = [];
      if (styleCodeFilter) {
        const styleCodeRegex = new RegExp(styleCodeFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        arrayFilters.push({ 'styleCodes.styleCode': styleCodeRegex });
      }
      if (eanCodeFilter) {
        const eanCodeRegex = new RegExp(eanCodeFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        arrayFilters.push({ 'styleCodes.eanCode': eanCodeRegex });
      }
      
      // Remove old styleCode/eanCode from filter and add array filters
      delete filter.styleCode;
      delete filter.eanCode;
      
      // Combine array filters with existing filter
      if (arrayFilters.length > 0) {
        if (Object.keys(filter).length > 0) {
          filter = {
            $and: [filter, ...arrayFilters],
          };
        } else {
          filter = arrayFilters.length === 1 ? arrayFilters[0] : { $and: arrayFilters };
        }
      }
    }
    
    // Handle search parameter - search across multiple fields
    if (search && typeof search === 'string' && search.trim()) {
      const searchTerm = search.trim();
      // Escape special regex characters
      const escapedSearch = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');
      
      // Build $or query to search across multiple fields
      const searchFilter = {
        $or: [
          { name: searchRegex },
          { softwareCode: searchRegex },
          { internalCode: searchRegex },
          { vendorCode: searchRegex },
          { factoryCode: searchRegex },
          { knittingCode: searchRegex },
          { 'styleCodes.styleCode': searchRegex },
          { 'styleCodes.eanCode': searchRegex },
          { description: searchRegex },
        ],
      };
      
      // Combine search filter with existing filter using $and
      if (Object.keys(filter).length > 0) {
        filter = {
          $and: [filter, searchFilter],
        };
      } else {
        filter = searchFilter;
      }
      
      console.log('Applied search filter:', JSON.stringify(filter));
    }
    
    // Add default population for category if not specified
    if (!options.populate) {
      options.populate = 'category';
    } else if (!options.populate.includes('category')) {
      options.populate += ',category';
    }
    
    const products = await Product.paginate(filter, options);
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
  Object.assign(product, updateBody);
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
            
            // Prepare product data with minimal memory footprint
            const processedData = {
              name: productData.name?.trim(),
              styleCodes: Array.isArray(productData.styleCodes) 
                ? productData.styleCodes.map(item => ({
                    styleCode: item.styleCode?.trim(),
                    eanCode: item.eanCode?.trim(),
                    mrp: typeof item.mrp === 'number' ? item.mrp : parseFloat(item.mrp) || 0,
                  }))
                : [],
              internalCode: productData.internalCode?.trim() || '',
              vendorCode: productData.vendorCode?.trim() || '',
              factoryCode: productData.factoryCode?.trim() || '',
              knittingCode: productData.knittingCode?.trim() || '',
              description: productData.description?.trim() || '',
              category: productData.category || null,
              attributes: {},
              bom: [],
              processes: [],
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