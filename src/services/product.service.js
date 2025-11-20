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
 * @returns {Promise<QueryResult>}
 */
export const queryProducts = async (filter, options) => {
  try {
    // Additional validation and debugging
    console.log('Service received filter:', filter);
    console.log('Service received options:', options);
    
    // Ensure filter is a valid object
    if (!filter || typeof filter !== 'object') {
      filter = {};
    }
    
    // Remove any potential _id field that might cause issues
    if (filter._id) {
      console.warn('Removing _id from filter to prevent ObjectId casting issues');
      delete filter._id;
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
  
  if (factoryCode) {
    filter.factoryCode = factoryCode.trim();
  }
  
  if (internalCode) {
    filter.internalCode = internalCode.trim();
  }
  
  if (!factoryCode && !internalCode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Either factoryCode or internalCode must be provided');
  }
  
  return Product.findOne(filter)
    .populate('category', 'name')
    .populate('bom.yarnCatalogId', 'yarnName yarnType countSize blend colorFamily')
    .populate('processes.processId', 'name type');
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
    if (products.length > 1000) {
      throw new Error('Maximum 1000 products allowed per request');
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
              styleCode: productData.styleCode?.trim(),
              internalCode: productData.internalCode?.trim() || '',
              vendorCode: productData.vendorCode?.trim() || '',
              factoryCode: productData.factoryCode?.trim() || '',
              eanCode: productData.eanCode?.trim() || '',
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