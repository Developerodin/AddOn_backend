import express from 'express';

/**
 * Middleware specifically for bulk import operations
 * Handles large payloads and provides monitoring
 */
export const bulkImportMiddleware = (req, res, next) => {
  // Set specific timeout for bulk operations
  req.setTimeout(300000); // 5 minutes timeout for bulk operations
  
  // Add request size monitoring
  const contentLength = req.headers['content-length'];
  if (contentLength) {
    const sizeInMB = parseInt(contentLength) / (1024 * 1024);
    console.log(`Bulk import request size: ${sizeInMB.toFixed(2)} MB`);
    
    // Warn if payload is very large
    if (sizeInMB > 10) {
      console.warn(`Large bulk import payload detected: ${sizeInMB.toFixed(2)} MB`);
    }
  }
  
  next();
};

/**
 * Middleware to validate bulk import payload size
 * Generic middleware that works with any array field (stores, products, etc.)
 */
export const validateBulkImportSize = (req, res, next) => {
  // Check for common array field names
  const arrayField = req.body.stores || req.body.products || req.body.items || req.body.data || 
                     req.body.salesRecords || req.body.salesIds || req.body.blends || 
                     req.body.colors || req.body.countSizes || req.body.suppliers || 
                     req.body.yarnTypes || req.body.yarnCatalogs;
  
  if (!arrayField || !Array.isArray(arrayField)) {
    return res.status(400).json({
      status: 'error',
      message: 'Array field (stores/products/items/blends/colors/countSizes/suppliers/yarnTypes/yarnCatalogs) is required'
    });
  }
  
  // Check if payload is reasonable
  if (arrayField.length > 10000) {
    return res.status(400).json({
      status: 'error',
      message: 'Maximum 10000 items allowed per request'
    });
  }
  
  // Estimate payload size (rough calculation)
  const estimatedSize = arrayField.length * 500; // ~500 bytes per object
  const sizeInMB = estimatedSize / (1024 * 1024);
  
  if (sizeInMB > 50) {
    return res.status(400).json({
      status: 'error',
      message: 'Payload too large. Consider reducing batch size or splitting into multiple requests'
    });
  }
  
  next();
}; 