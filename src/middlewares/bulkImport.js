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
 */
export const validateBulkImportSize = (req, res, next) => {
  const { products } = req.body;
  
  if (!products || !Array.isArray(products)) {
    return res.status(400).json({
      status: 'error',
      message: 'Products array is required'
    });
  }
  
  // Check if payload is reasonable
  if (products.length > 1000) {
    return res.status(400).json({
      status: 'error',
      message: 'Maximum 1000 products allowed per request'
    });
  }
  
  // Estimate payload size (rough calculation)
  const estimatedSize = products.length * 500; // ~500 bytes per product object
  const sizeInMB = estimatedSize / (1024 * 1024);
  
  if (sizeInMB > 50) {
    return res.status(400).json({
      status: 'error',
      message: 'Payload too large. Consider reducing batch size or splitting into multiple requests'
    });
  }
  
  next();
}; 