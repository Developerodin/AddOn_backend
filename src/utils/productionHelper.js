import { LinkingType, ProductionFloor } from '../models/production/enums.js';

/**
 * Get floor order based on linking type
 * @param {string} linkingType - The linking type (Auto Linking, Hand Linking, Rosso Linking)
 * @returns {Array<string>} Array of floor names in order
 */
export const getFloorOrderByLinkingType = (linkingType) => {
  if (linkingType === LinkingType.AUTO_LINKING) {
    // Auto Linking: Skip linking floor
    return [
      ProductionFloor.KNITTING,
      ProductionFloor.CHECKING,
      ProductionFloor.WASHING,
      ProductionFloor.BOARDING,
      ProductionFloor.SILICON,
      ProductionFloor.SECONDARY_CHECKING,
      ProductionFloor.BRANDING,
      ProductionFloor.FINAL_CHECKING,
      ProductionFloor.WAREHOUSE,
      ProductionFloor.DISPATCH
    ];
  } else {
    // Hand Linking and Rosso Linking: Include linking floor
    return [
      ProductionFloor.KNITTING,
      ProductionFloor.LINKING,
      ProductionFloor.CHECKING,
      ProductionFloor.WASHING,
      ProductionFloor.BOARDING,
      ProductionFloor.SILICON,
      ProductionFloor.SECONDARY_CHECKING,
      ProductionFloor.BRANDING,
      ProductionFloor.FINAL_CHECKING,
      ProductionFloor.WAREHOUSE,
      ProductionFloor.DISPATCH
    ];
  }
};

/**
 * Get comprehensive floor order (includes all possible floors)
 * @returns {Array<string>} Array of all floor names in order
 */
export const getAllFloorsOrder = () => {
  return [
    ProductionFloor.KNITTING,
    ProductionFloor.LINKING,
    ProductionFloor.CHECKING,
    ProductionFloor.WASHING,
    ProductionFloor.BOARDING,
    ProductionFloor.SILICON,
    ProductionFloor.SECONDARY_CHECKING,
    ProductionFloor.BRANDING,
    ProductionFloor.FINAL_CHECKING,
    ProductionFloor.WAREHOUSE,
    ProductionFloor.DISPATCH
  ];
};

/**
 * Get floor key from ProductionFloor enum
 * @param {string} floor - Floor name from ProductionFloor enum
 * @returns {string} Floor key for database operations
 */
export const getFloorKey = (floor) => {
  const floorMap = {
    [ProductionFloor.KNITTING]: 'knitting',
    [ProductionFloor.LINKING]: 'linking',
    [ProductionFloor.CHECKING]: 'checking',
    [ProductionFloor.WASHING]: 'washing',
    [ProductionFloor.BOARDING]: 'boarding',
    [ProductionFloor.SILICON]: 'silicon',
    [ProductionFloor.SECONDARY_CHECKING]: 'secondaryChecking',
    [ProductionFloor.BRANDING]: 'branding',
    [ProductionFloor.FINAL_CHECKING]: 'finalChecking',
    [ProductionFloor.WAREHOUSE]: 'warehouse',
    [ProductionFloor.DISPATCH]: 'dispatch'
  };
  return floorMap[floor];
};

/**
 * Get next floor in the sequence based on linking type
 * @param {string} currentFloor - Current floor name
 * @param {string} linkingType - Linking type
 * @returns {string|null} Next floor name or null if at end
 */
export const getNextFloor = (currentFloor, linkingType) => {
  const floorOrder = getFloorOrderByLinkingType(linkingType);
  const currentIndex = floorOrder.indexOf(currentFloor);
  
  if (currentIndex === -1 || currentIndex === floorOrder.length - 1) {
    return null;
  }
  
  return floorOrder[currentIndex + 1];
};

/**
 * Check if a floor is valid for a given linking type
 * @param {string} floor - Floor name to check
 * @param {string} linkingType - Linking type
 * @returns {boolean} True if floor is valid for the linking type
 */
export const isValidFloorForLinkingType = (floor, linkingType) => {
  const floorOrder = getFloorOrderByLinkingType(linkingType);
  return floorOrder.includes(floor);
};

/**
 * Get floor index in the comprehensive floor order
 * @param {string} floor - Floor name
 * @returns {number} Index of floor in comprehensive order
 */
export const getFloorIndex = (floor) => {
  const allFloors = getAllFloorsOrder();
  return allFloors.indexOf(floor);
};

/**
 * Compare two floors to determine which comes first in the production flow
 * @param {string} floor1 - First floor
 * @param {string} floor2 - Second floor
 * @returns {number} Negative if floor1 comes before floor2, positive if after, 0 if same
 */
export const compareFloors = (floor1, floor2) => {
  const index1 = getFloorIndex(floor1);
  const index2 = getFloorIndex(floor2);
  return index1 - index2;
};

/**
 * Map process name/type to ProductionFloor enum value
 * Case-insensitive matching with various name formats
 * @param {string} processName - Process name or type from Process model
 * @returns {string|null} ProductionFloor enum value or null if no match
 */
export const mapProcessToFloor = (processName) => {
  if (!processName || typeof processName !== 'string') {
    return null;
  }

  const normalizedName = processName.trim().toLowerCase();
  
  // Map process names to ProductionFloor enum values
  const processToFloorMap = {
    // Direct matches
    'knitting': ProductionFloor.KNITTING,
    'linking': ProductionFloor.LINKING,
    'checking': ProductionFloor.CHECKING,
    'washing': ProductionFloor.WASHING,
    'boarding': ProductionFloor.BOARDING,
    'silicon': ProductionFloor.SILICON,
    'secondary checking': ProductionFloor.SECONDARY_CHECKING,
    'secondarychecking': ProductionFloor.SECONDARY_CHECKING,
    'branding': ProductionFloor.BRANDING,
    'final checking': ProductionFloor.FINAL_CHECKING,
    'finalchecking': ProductionFloor.FINAL_CHECKING,
    'warehouse': ProductionFloor.WAREHOUSE,
    'dispatch': ProductionFloor.DISPATCH,
    
    // Alternative names/variations
    'knit': ProductionFloor.KNITTING,
    'link': ProductionFloor.LINKING,
    'check': ProductionFloor.CHECKING,
    'wash': ProductionFloor.WASHING,
    'board': ProductionFloor.BOARDING,
    'silicone': ProductionFloor.SILICON,
    'secondary check': ProductionFloor.SECONDARY_CHECKING,
    'brand': ProductionFloor.BRANDING,
    'final check': ProductionFloor.FINAL_CHECKING,
    'warehouse': ProductionFloor.WAREHOUSE,
    'dispatch': ProductionFloor.DISPATCH
  };

  // Direct match
  if (processToFloorMap[normalizedName]) {
    return processToFloorMap[normalizedName];
  }

  // Partial match (contains floor name)
  for (const [key, floor] of Object.entries(processToFloorMap)) {
    if (normalizedName.includes(key) || key.includes(normalizedName)) {
      return floor;
    }
  }

  // Try matching against ProductionFloor enum values directly
  const allFloors = Object.values(ProductionFloor);
  for (const floor of allFloors) {
    if (normalizedName === floor.toLowerCase() || 
        normalizedName.includes(floor.toLowerCase()) ||
        floor.toLowerCase().includes(normalizedName)) {
      return floor;
    }
  }

  return null;
};

/**
 * Get available floor keys from article model
 * @returns {Array<string>} Array of floor keys available in article floorQuantities
 */
export const getAvailableArticleFloors = () => {
  return [
    'knitting',
    'linking',
    'checking',
    'washing',
    'boarding',
    'silicon',
    'secondaryChecking',
    'finalChecking',
    'branding',
    'warehouse',
    'dispatch'
  ];
};

/**
 * Get available ProductionFloor enum values
 * @returns {Array<string>} Array of ProductionFloor enum values
 */
export const getAvailableProductionFloors = () => {
  return Object.values(ProductionFloor);
};

/**
 * Validate product processes against available article floors
 * @param {Array} processes - Array of Process documents or process objects
 * @param {string} articleNumber - Article number (for error messages)
 * @returns {Object} { valid: boolean, errors: Array<string>, mappedFloors: Array<string> }
 */
export const validateProductProcesses = (processes, articleNumber) => {
  const errors = [];
  const mappedFloors = [];
  const availableFloors = getAvailableProductionFloors();

  if (!processes || !Array.isArray(processes) || processes.length === 0) {
    return {
      valid: false,
      errors: [`Article ${articleNumber}: Product has no processes defined`],
      mappedFloors: []
    };
  }

  for (const processItem of processes) {
    // Handle both populated and unpopulated process references
    const process = processItem.processId || processItem;
    
    // Get process name (try name first, then type)
    const processName = process.name || process.type || process.stepTitle || '';
    
    if (!processName) {
      errors.push(`Article ${articleNumber}: Process has no name or type defined`);
      continue;
    }

    // Map process to floor
    const floor = mapProcessToFloor(processName);
    
    if (!floor) {
      errors.push(
        `Article ${articleNumber}: Process "${processName}" does not match any available floor. ` +
        `Available floors: ${availableFloors.join(', ')}`
      );
      continue;
    }

    // Check if floor is available in article floorQuantities
    const floorKey = getFloorKey(floor);
    const availableFloorKeys = getAvailableArticleFloors();
    
    if (!availableFloorKeys.includes(floorKey)) {
      errors.push(
        `Article ${articleNumber}: Floor "${floor}" (from process "${processName}") is not available in article floor data. ` +
        `Available floors: ${availableFloors.join(', ')}`
      );
      continue;
    }

    mappedFloors.push(floor);
  }

  return {
    valid: errors.length === 0,
    errors,
    mappedFloors
  };
};
