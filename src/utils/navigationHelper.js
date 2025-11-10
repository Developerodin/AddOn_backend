/**
 * Navigation Helper Utilities
 * Provides helper functions for managing user navigation permissions
 */

/**
 * Default navigation structure
 */
export const DEFAULT_NAVIGATION = {
  // Main Sidebar
  Dashboard: false,
  Catalog: {
    Items: false,
    Categories: false,
    'Raw Material': false,
    Processes: false,
    Attributes: false,
    Machines: false
  },
  Sales: {
    'All Sales': false,
    'Master Sales': false
  },
  Stores: false,
  Analytics: false,
  'Replenishment Agent': false,
  'File Manager': false,
  Users: false,
  'Production Planning': {
    'Production Orders': false,
    'Knitting Floor': false,
    'Linking Floor': false,
    'Checking Floor': false,
    'Washing Floor': false,
    'Boarding Floor': false,
    'Final Checking Floor': false,
    'Branding Floor': false,
    'Machine Floor': false,
    'Warehouse Floor': false
  },
  'Yarn Management': {
    'Cataloguing': false,
    'Purchase Order': false,
    'Purchase Order Recevied': false,
    'Inventory': false,
    'Yarn Issue': false,
    'Yarn Master': {
      'Brand': false,
      'Yarn Type': false,
      'Count/Size': false,
      'Color': false
    }
  },
  'Warehouse Management': {
    'Orders': false,
    'Pick&Pack': false,
    'Layout': false,
    'Stock': false,
    'Reports': false
  }
};

/**
 * Role-based navigation templates
 */
export const ROLE_NAVIGATION_TEMPLATES = {
  admin: {
    Dashboard: true,
    Catalog: {
      Items: true,
      Categories: true,
      'Raw Material': true,
      Processes: true,
      Attributes: true,
      Machines: true
    },
    Sales: {
      'All Sales': true,
      'Master Sales': true
    },
    Stores: true,
    Analytics: true,
    'Replenishment Agent': true,
    'File Manager': true,
    Users: true,
    'Production Planning': {
      'Production Orders': true,
      'Knitting Floor': true,
      'Linking Floor': true,
      'Checking Floor': true,
      'Washing Floor': true,
      'Boarding Floor': true,
      'Final Checking Floor': true,
      'Branding Floor': true,
      'Machine Floor': true,
      'Warehouse Floor': true
    },
    'Yarn Management': {
      'Cataloguing': true,
      'Purchase Order': true,
      'Purchase Order Recevied': true,
      'Inventory': true,
      'Yarn Issue': true,
      'Yarn Master': {
        'Brand': true,
        'Yarn Type': true,
        'Count/Size': true,
        'Color': true
      }
    },
    'Warehouse Management': {
      'Orders': true,
      'Pick&Pack': true,
      'Layout': true,
      'Stock': true,
      'Reports': true
    }
  },
  user: {
    Dashboard: true,
    Catalog: {
      Items: true,
      Categories: false,
      'Raw Material': false,
      Processes: false,
      Attributes: false,
      Machines: false
    },
    Sales: {
      'All Sales': true,
      'Master Sales': false
    },
    Stores: false,
    Analytics: false,
    'Replenishment Agent': false,
    'File Manager': false,
    Users: false,
    'Production Planning': {
      'Production Orders': false,
      'Knitting Floor': false,
      'Linking Floor': false,
      'Checking Floor': false,
      'Washing Floor': false,
      'Boarding Floor': false,
      'Final Checking Floor': false,
      'Branding Floor': false,
      'Machine Floor': false,
      'Warehouse Floor': false
    },
    'Yarn Management': {
      'Cataloguing': false,
      'Purchase Order': false,
      'Purchase Order Recevied': false,
      'Inventory': false,
      'Yarn Issue': false,
      'Yarn Master': {
        'Brand': false,
        'Yarn Type': false,
        'Count/Size': false,
        'Color': false
      }
    },
    'Warehouse Management': {
      'Orders': false,
      'Pick&Pack': false,
      'Layout': false,
      'Stock': false,
      'Reports': false
    }
  }
};

/**
 * Get default navigation based on user role
 * @param {string} role - User role
 * @returns {Object} Navigation object
 */
export const getDefaultNavigationByRole = (role) => {
  return ROLE_NAVIGATION_TEMPLATES[role] || DEFAULT_NAVIGATION;
};

/**
 * Merge navigation objects deeply
 * @param {Object} target - Target navigation object
 * @param {Object} source - Source navigation object
 * @returns {Object} Merged navigation object
 */
export const mergeNavigation = (target, source) => {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = mergeNavigation(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
};

/**
 * Validate navigation structure
 * @param {Object} navigation - Navigation object to validate
 * @returns {boolean} True if valid
 */
export const validateNavigationStructure = (navigation) => {
  if (!navigation || typeof navigation !== 'object') {
    console.error('Validation failed: navigation is not an object');
    return false;
  }

  // Check required top-level keys
  const requiredKeys = ['Dashboard', 'Catalog', 'Sales', 'Stores', 'Analytics', 'Replenishment Agent', 'File Manager', 'Users', 'Production Planning', 'Yarn Management', 'Warehouse Management'];
  for (const key of requiredKeys) {
    if (!(key in navigation)) {
      console.error(`Validation failed: Missing top-level key: ${key}`);
      return false;
    }
  }

  // Check Catalog structure
  if (!navigation.Catalog || typeof navigation.Catalog !== 'object') {
    console.error('Validation failed: Catalog is not an object');
    return false;
  }
  const catalogKeys = ['Items', 'Categories', 'Raw Material', 'Processes', 'Attributes', 'Machines'];
  for (const key of catalogKeys) {
    if (!(key in navigation.Catalog) || typeof navigation.Catalog[key] !== 'boolean') {
      console.error(`Validation failed: Catalog.${key} is missing or not a boolean`);
      return false;
    }
  }

  // Check Sales structure
  if (!navigation.Sales || typeof navigation.Sales !== 'object') {
    console.error('Validation failed: Sales is not an object');
    return false;
  }
  const salesKeys = ['All Sales', 'Master Sales'];
  for (const key of salesKeys) {
    if (!(key in navigation.Sales) || typeof navigation.Sales[key] !== 'boolean') {
      console.error(`Validation failed: Sales.${key} is missing or not a boolean`);
      return false;
    }
  }

  // Check Production Planning structure
  if (!navigation['Production Planning'] || typeof navigation['Production Planning'] !== 'object') {
    console.error('Validation failed: Production Planning is not an object');
    return false;
  }
  const productionKeys = [
    'Production Orders',
    'Knitting Floor',
    'Linking Floor',
    'Checking Floor',
    'Washing Floor',
    'Boarding Floor',
    'Final Checking Floor',
    'Branding Floor',
    'Machine Floor',
    'Warehouse Floor'
  ];
  for (const key of productionKeys) {
    if (!(key in navigation['Production Planning']) || typeof navigation['Production Planning'][key] !== 'boolean') {
      console.error(`Validation failed: Production Planning.${key} is missing or not a boolean`);
      console.error('Production Planning keys:', Object.keys(navigation['Production Planning']));
      return false;
    }
  }

  // Check Yarn Management structure
  if (!navigation['Yarn Management'] || typeof navigation['Yarn Management'] !== 'object') {
    console.error('Validation failed: Yarn Management is not an object');
    return false;
  }
  const yarnKeys = ['Cataloguing', 'Purchase Order', 'Purchase Order Recevied', 'Inventory', 'Yarn Issue', 'Yarn Master'];
  for (const key of yarnKeys) {
    if (key === 'Yarn Master') {
      // Yarn Master is a nested object
      if (!navigation['Yarn Management']['Yarn Master'] || typeof navigation['Yarn Management']['Yarn Master'] !== 'object') {
        console.error('Validation failed: Yarn Management.Yarn Master is missing or not an object');
        return false;
      }
      const yarnMasterKeys = ['Brand', 'Yarn Type', 'Count/Size', 'Color'];
      for (const masterKey of yarnMasterKeys) {
        if (!(masterKey in navigation['Yarn Management']['Yarn Master']) || typeof navigation['Yarn Management']['Yarn Master'][masterKey] !== 'boolean') {
          console.error(`Validation failed: Yarn Management.Yarn Master.${masterKey} is missing or not a boolean`);
          return false;
        }
      }
    } else {
      if (!(key in navigation['Yarn Management']) || typeof navigation['Yarn Management'][key] !== 'boolean') {
        console.error(`Validation failed: Yarn Management.${key} is missing or not a boolean`);
        return false;
      }
    }
  }

  // Check Warehouse Management structure
  if (!navigation['Warehouse Management'] || typeof navigation['Warehouse Management'] !== 'object') {
    console.error('Validation failed: Warehouse Management is not an object');
    return false;
  }
  const warehouseKeys = ['Orders', 'Pick&Pack', 'Layout', 'Stock', 'Reports'];
  for (const key of warehouseKeys) {
    if (!(key in navigation['Warehouse Management']) || typeof navigation['Warehouse Management'][key] !== 'boolean') {
      console.error(`Validation failed: Warehouse Management.${key} is missing or not a boolean`);
      return false;
    }
  }

  return true;
};

/**
 * Get navigation permissions for a specific path
 * @param {Object} navigation - Navigation object
 * @param {string} path - Dot-separated path (e.g., 'Catalog.Items')
 * @returns {boolean} Permission value
 */
export const getNavigationPermission = (navigation, path) => {
  const keys = path.split('.');
  let current = navigation;
  
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return false;
    }
  }
  
  return Boolean(current);
};

/**
 * Set navigation permission for a specific path
 * @param {Object} navigation - Navigation object
 * @param {string} path - Dot-separated path (e.g., 'Catalog.Items')
 * @param {boolean} value - Permission value
 * @returns {Object} Updated navigation object
 */
export const setNavigationPermission = (navigation, path, value) => {
  const keys = path.split('.');
  const result = JSON.parse(JSON.stringify(navigation)); // Deep clone
  let current = result;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  
  current[keys[keys.length - 1]] = Boolean(value);
  return result;
};

/**
 * Get all navigation paths as flat array
 * @param {Object} navigation - Navigation object
 * @returns {Array} Array of paths
 */
export const getAllNavigationPaths = (navigation) => {
  const paths = [];
  
  const traverse = (obj, prefix = '') => {
    for (const key in obj) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof obj[key] === 'boolean') {
        paths.push(path);
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        traverse(obj[key], path);
      }
    }
  };
  
  traverse(navigation);
  return paths;
};
