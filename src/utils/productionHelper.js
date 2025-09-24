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
      ProductionFloor.FINAL_CHECKING,
      ProductionFloor.BRANDING,
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
      ProductionFloor.FINAL_CHECKING,
      ProductionFloor.BRANDING,
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
    ProductionFloor.FINAL_CHECKING,
    ProductionFloor.BRANDING,
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
    [ProductionFloor.FINAL_CHECKING]: 'finalChecking',
    [ProductionFloor.BRANDING]: 'branding',
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
