/**
 * Floor Label Map Utility
 * Bidirectional mapping between floor names, keys, and container labels
 * 
 * Three formats exist in the codebase:
 * 1. ProductionFloor enum values: "Knitting", "Secondary Checking", "Final Checking"
 * 2. floorQuantities keys (camelCase): "knitting", "secondaryChecking", "finalChecking"
 * 3. ContainersMaster.activeFloor labels: "Knitting", "Final Checking" (same as enum)
 */

import { ProductionFloor } from '../models/production/enums.js';

/**
 * Map from ProductionFloor enum to floorQuantities camelCase key
 */
export const FLOOR_TO_KEY_MAP = {
  [ProductionFloor.KNITTING]: 'knitting',
  [ProductionFloor.LINKING]: 'linking',
  [ProductionFloor.CHECKING]: 'checking',
  [ProductionFloor.WASHING]: 'washing',
  [ProductionFloor.BOARDING]: 'boarding',
  [ProductionFloor.SILICON]: 'silicon',
  [ProductionFloor.SECONDARY_CHECKING]: 'secondaryChecking',
  [ProductionFloor.BRANDING]: 'branding',
  [ProductionFloor.RE_BOARDING]: 'reBoarding',
  [ProductionFloor.FINAL_CHECKING]: 'finalChecking',
  [ProductionFloor.WAREHOUSE]: 'warehouse',
  [ProductionFloor.DISPATCH]: 'dispatch'
};

/**
 * Map from floorQuantities camelCase key to ProductionFloor enum
 */
export const KEY_TO_FLOOR_MAP = {
  'knitting': ProductionFloor.KNITTING,
  'linking': ProductionFloor.LINKING,
  'checking': ProductionFloor.CHECKING,
  'washing': ProductionFloor.WASHING,
  'boarding': ProductionFloor.BOARDING,
  'silicon': ProductionFloor.SILICON,
  'secondaryChecking': ProductionFloor.SECONDARY_CHECKING,
  'branding': ProductionFloor.BRANDING,
  'reBoarding': ProductionFloor.RE_BOARDING,
  'finalChecking': ProductionFloor.FINAL_CHECKING,
  'warehouse': ProductionFloor.WAREHOUSE,
  'dispatch': ProductionFloor.DISPATCH
};

/**
 * All floor keys in production order
 */
export const ALL_FLOOR_KEYS = [
  'knitting',
  'linking',
  'checking',
  'washing',
  'boarding',
  'silicon',
  'secondaryChecking',
  'branding',
  'reBoarding',
  'finalChecking',
  'dispatch',
  'warehouse'
];

/**
 * All floor names (ProductionFloor enum values) in production order
 */
export const ALL_FLOOR_NAMES = [
  ProductionFloor.KNITTING,
  ProductionFloor.LINKING,
  ProductionFloor.CHECKING,
  ProductionFloor.WASHING,
  ProductionFloor.BOARDING,
  ProductionFloor.SILICON,
  ProductionFloor.SECONDARY_CHECKING,
  ProductionFloor.BRANDING,
  ProductionFloor.RE_BOARDING,
  ProductionFloor.FINAL_CHECKING,
  ProductionFloor.DISPATCH,
  ProductionFloor.WAREHOUSE
];

/**
 * QC floor keys (floors with M1/M2/M3/M4 quality tracking)
 */
export const QC_FLOOR_KEYS = ['checking', 'secondaryChecking', 'finalChecking'];

/**
 * QC floor names
 */
export const QC_FLOOR_NAMES = [
  ProductionFloor.CHECKING,
  ProductionFloor.SECONDARY_CHECKING,
  ProductionFloor.FINAL_CHECKING
];

/**
 * Convert floor name to floorQuantities key
 * @param {string} floorName - ProductionFloor enum value (e.g., "Secondary Checking")
 * @returns {string|null} - camelCase key (e.g., "secondaryChecking")
 */
export const getFloorKeyFromName = (floorName) => {
  return FLOOR_TO_KEY_MAP[floorName] || null;
};

/**
 * Convert floorQuantities key to floor name
 * @param {string} floorKey - camelCase key (e.g., "secondaryChecking")
 * @returns {string|null} - ProductionFloor enum value (e.g., "Secondary Checking")
 */
export const getFloorNameFromKey = (floorKey) => {
  return KEY_TO_FLOOR_MAP[floorKey] || null;
};

/**
 * Check if a floor key is a QC floor (has M1/M2/M3/M4)
 * @param {string} floorKey - camelCase key
 * @returns {boolean}
 */
export const isQcFloorKey = (floorKey) => {
  return QC_FLOOR_KEYS.includes(floorKey);
};

/**
 * Check if a floor name is a QC floor
 * @param {string} floorName - ProductionFloor enum value
 * @returns {boolean}
 */
export const isQcFloorName = (floorName) => {
  return QC_FLOOR_NAMES.includes(floorName);
};

/**
 * Get total completed quantity across all floors for an article
 * @param {Object} floorQuantities - Article's floorQuantities object
 * @returns {number}
 */
export const getTotalCompletedQuantity = (floorQuantities) => {
  if (!floorQuantities) return 0;
  
  let total = 0;
  for (const key of ALL_FLOOR_KEYS) {
    const floor = floorQuantities[key];
    if (floor && typeof floor.completed === 'number') {
      total += floor.completed;
    }
  }
  return total;
};

/**
 * Get the dispatch completed quantity (final output)
 * @param {Object} floorQuantities - Article's floorQuantities object
 * @returns {number}
 */
export const getDispatchedQuantity = (floorQuantities) => {
  return floorQuantities?.dispatch?.transferred || 0;
};

/**
 * Get total WIP (remaining) across all floors for an article
 * @param {Object} floorQuantities - Article's floorQuantities object
 * @returns {number}
 */
export const getTotalWipQuantity = (floorQuantities) => {
  if (!floorQuantities) return 0;
  
  let total = 0;
  for (const key of ALL_FLOOR_KEYS) {
    const floor = floorQuantities[key];
    if (floor && typeof floor.remaining === 'number') {
      total += floor.remaining;
    }
  }
  return total;
};

/**
 * Get floor-specific quantities for an article
 * @param {Object} floorQuantities - Article's floorQuantities object
 * @param {string} floorKey - camelCase floor key
 * @returns {Object} - { received, completed, remaining, transferred, m1, m2, m3, m4 }
 */
export const getFloorData = (floorQuantities, floorKey) => {
  const floor = floorQuantities?.[floorKey];
  if (!floor) {
    return {
      received: 0,
      completed: 0,
      remaining: 0,
      transferred: 0,
      m1Quantity: 0,
      m2Quantity: 0,
      m3Quantity: 0,
      m4Quantity: 0
    };
  }
  
  return {
    received: floor.received || 0,
    completed: floor.completed || 0,
    remaining: floor.remaining || 0,
    transferred: floor.transferred || 0,
    m1Quantity: floor.m1Quantity || 0,
    m2Quantity: floor.m2Quantity || 0,
    m3Quantity: floor.m3Quantity || 0,
    m4Quantity: floor.m4Quantity || 0,
    m1Transferred: floor.m1Transferred || 0,
    m2Transferred: floor.m2Transferred || 0,
    repairReceived: floor.repairReceived || 0
  };
};

/**
 * Build MongoDB query for articles with WIP on a specific floor
 * @param {string} floorKey - camelCase floor key
 * @returns {Object} - MongoDB query object
 */
export const buildFloorWipQuery = (floorKey) => {
  return {
    [`floorQuantities.${floorKey}.remaining`]: { $gt: 0 }
  };
};

/**
 * Build MongoDB query for articles that have received items on a specific floor
 * @param {string} floorKey - camelCase floor key
 * @returns {Object} - MongoDB query object
 */
export const buildFloorReceivedQuery = (floorKey) => {
  return {
    [`floorQuantities.${floorKey}.received`]: { $gt: 0 }
  };
};

/**
 * Aggregate floor statistics from articles
 * @param {Array} articles - Array of article documents
 * @param {string} floorKey - camelCase floor key
 * @returns {Object} - Aggregated statistics
 */
export const aggregateFloorStats = (articles, floorKey) => {
  const stats = {
    totalReceived: 0,
    totalCompleted: 0,
    totalRemaining: 0,
    totalTransferred: 0,
    m1Total: 0,
    m2Total: 0,
    m3Total: 0,
    m4Total: 0,
    articleCount: 0,
    articlesWithWip: 0
  };
  
  for (const article of articles) {
    const floorData = getFloorData(article.floorQuantities, floorKey);
    
    stats.totalReceived += floorData.received;
    stats.totalCompleted += floorData.completed;
    stats.totalRemaining += floorData.remaining;
    stats.totalTransferred += floorData.transferred;
    stats.m1Total += floorData.m1Quantity;
    stats.m2Total += floorData.m2Quantity;
    stats.m3Total += floorData.m3Quantity;
    stats.m4Total += floorData.m4Quantity;
    
    if (floorData.received > 0) {
      stats.articleCount++;
    }
    if (floorData.remaining > 0) {
      stats.articlesWithWip++;
    }
  }
  
  return stats;
};

export default {
  FLOOR_TO_KEY_MAP,
  KEY_TO_FLOOR_MAP,
  ALL_FLOOR_KEYS,
  ALL_FLOOR_NAMES,
  QC_FLOOR_KEYS,
  QC_FLOOR_NAMES,
  getFloorKeyFromName,
  getFloorNameFromKey,
  isQcFloorKey,
  isQcFloorName,
  getTotalCompletedQuantity,
  getDispatchedQuantity,
  getTotalWipQuantity,
  getFloorData,
  buildFloorWipQuery,
  buildFloorReceivedQuery,
  aggregateFloorStats
};
