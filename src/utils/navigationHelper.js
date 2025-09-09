/**
 * Navigation Helper Utilities
 * Provides helper functions for managing user navigation permissions
 */

/**
 * Default navigation structure
 */
export const DEFAULT_NAVIGATION = {
  // Main Sidebar
  Users: false,
  Dashboard: false,
  Catalog: {
    Items: false,
    Categories: false,
    'Raw Material': false,
    Processes: false,
    Attributes: false
  },
  Sales: {
    'All Sales': false,
    'Master Sales': false
  },
  Stores: false,
  Analytics: false,
  'Replenishment Agent': false,
  'File Manager': false,
  Production: {
    'Production Supervisor': false,
    'Knitting Floor Supervisor': false,
    'Linking Floor Supervisor': false,
    'Checking Floor Supervisor': false,
    'Washing Floor Supervisor': false,
    'Boarding Floor Supervisor': false,
    'Final Checking Floor Supervisor': false,
    'Branding Floor Supervisor': false,
    'Warehouse Floor Supervisor': false
  }
};

/**
 * Role-based navigation templates
 */
export const ROLE_NAVIGATION_TEMPLATES = {
  admin: {
    Users: true,
    Dashboard: true,
    Catalog: {
      Items: true,
      Categories: true,
      'Raw Material': true,
      Processes: true,
      Attributes: true
    },
    Sales: {
      'All Sales': true,
      'Master Sales': true
    },
    Stores: true,
    Analytics: true,
    'Replenishment Agent': true,
    'File Manager': true,
    Production: {
      'Production Supervisor': true,
      'Knitting Floor Supervisor': true,
      'Linking Floor Supervisor': true,
      'Checking Floor Supervisor': true,
      'Washing Floor Supervisor': true,
      'Boarding Floor Supervisor': true,
      'Final Checking Floor Supervisor': true,
      'Branding Floor Supervisor': true,
      'Warehouse Floor Supervisor': true
    }
  },
  user: {
    Users: false,
    Dashboard: true,
    Catalog: {
      Items: true,
      Categories: false,
      'Raw Material': false,
      Processes: false,
      Attributes: false
    },
    Sales: {
      'All Sales': true,
      'Master Sales': false
    },
    Stores: false,
    Analytics: false,
    'Replenishment Agent': false,
    'File Manager': false,
    Production: {
      'Production Supervisor': false,
      'Knitting Floor Supervisor': false,
      'Linking Floor Supervisor': false,
      'Checking Floor Supervisor': false,
      'Washing Floor Supervisor': false,
      'Boarding Floor Supervisor': false,
      'Final Checking Floor Supervisor': false,
      'Branding Floor Supervisor': false,
      'Warehouse Floor Supervisor': false
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
    return false;
  }

  // Check required top-level keys
  const requiredKeys = ['Users', 'Dashboard', 'Catalog', 'Sales', 'Stores', 'Analytics', 'Replenishment Agent', 'File Manager', 'Production'];
  for (const key of requiredKeys) {
    if (!(key in navigation)) {
      return false;
    }
  }

  // Check Catalog structure
  if (!navigation.Catalog || typeof navigation.Catalog !== 'object') {
    return false;
  }
  const catalogKeys = ['Items', 'Categories', 'Raw Material', 'Processes', 'Attributes'];
  for (const key of catalogKeys) {
    if (!(key in navigation.Catalog) || typeof navigation.Catalog[key] !== 'boolean') {
      return false;
    }
  }

  // Check Sales structure
  if (!navigation.Sales || typeof navigation.Sales !== 'object') {
    return false;
  }
  const salesKeys = ['All Sales', 'Master Sales'];
  for (const key of salesKeys) {
    if (!(key in navigation.Sales) || typeof navigation.Sales[key] !== 'boolean') {
      return false;
    }
  }

  // Check Production structure
  if (!navigation.Production || typeof navigation.Production !== 'object') {
    return false;
  }
  const productionKeys = [
    'Production Supervisor',
    'Knitting Floor Supervisor',
    'Linking Floor Supervisor',
    'Checking Floor Supervisor',
    'Washing Floor Supervisor',
    'Boarding Floor Supervisor',
    'Final Checking Floor Supervisor',
    'Branding Floor Supervisor',
    'Warehouse Floor Supervisor'
  ];
  for (const key of productionKeys) {
    if (!(key in navigation.Production) || typeof navigation.Production[key] !== 'boolean') {
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
