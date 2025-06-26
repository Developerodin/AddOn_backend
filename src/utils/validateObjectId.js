import mongoose from 'mongoose';

/**
 * Validate if a string is a valid ObjectId format
 * @param {string} id - The string to validate
 * @returns {boolean} - True if valid ObjectId format
 */
export const isValidObjectId = (id) => {
  if (!id || typeof id !== 'string') return false;
  return mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id);
};

/**
 * Clean filter object by removing invalid ObjectId values
 * @param {Object} filter - The filter object to clean
 * @param {Array} objectIdFields - Array of field names that should be ObjectIds
 * @returns {Object} - Cleaned filter object
 */
export const cleanFilterObjectIds = (filter, objectIdFields = ['category', '_id']) => {
  const cleanFilter = {};
  
  Object.keys(filter).forEach(key => {
    const value = filter[key];
    
    if (value !== undefined && value !== null && value !== '') {
      // Check if this field should be an ObjectId
      if (objectIdFields.includes(key)) {
        if (isValidObjectId(value)) {
          cleanFilter[key] = value;
        }
        // Skip invalid ObjectId values
      } else {
        cleanFilter[key] = value;
      }
    }
  });
  
  return cleanFilter;
}; 