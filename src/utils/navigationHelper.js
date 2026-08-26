/**
 * Navigation Helper Utilities
 * Provides helper functions for managing user navigation permissions
 */

/**
 * Default navigation structure
 */
export const DEFAULT_NAVIGATION = {
  // Main Sidebar
  Dashboard: {
    'Catalog Dashboard': false,
    'Production Dashboard': false,
    'Vendor Dashboard': false,
    'Yarn Dashboard': false,
  },
  Reports: {
    'Invoice Report': false,
    'Production order summary': false,
    'Core Report': false,
    'Backlog report': false,
    'Daily production summary': false,
    'Advanced Planning': false,
    'Needle Wise Planning': false,
  },
  Catalog: {
    Items: false,
    Categories: false,
    'Raw Material': false,
    Processes: false,
    Attributes: false,
    Machines: false,
    'Needle Configuration': false,
    'Team Master': false,
    'Containers Master': false
  },
  Sales: {
    'All Sales': false,
    'Master Sales': false
  },
  Stores: false,
  Analytics: false,
  'Replenishment Agent': false,
  'File Manager': false,
  'Help & Support': false,
  Users: false,
  'Production Planning': {
    'Production Orders': false,
    'Knitting Floor': false,
    'Linking Floor': false,
    'Checking Floor': false,
    'Washing Floor': false,
    'Boarding Floor': false,
    'Silicon Floor': false,
    'Secondary Checking Floor': false,
    'Branding Floor': false,
    'Re-Boarding Floor': false,
    'Final Checking Floor': false,
    'Dispatch Floor': false,
    'M4 Management': false,
    'M2 Management': false,
    'M3 Management': false,
    'Machine Floor': false,
    'Warehouse Floor': false
  },
  'Yarn Management': {
    'Dashboard': false,
    'Inventory': false,
    'Cataloguing': false,
    'Analytics & reports': false,
    'Purchase Management': {
      'Requisition list': false,
      'Purchase Order': false,
      'Purchase Order Recevied': false,
      'Draft POs': false,
      'PO Return': false,
      'PO Return Challan': false,
      'GRN History': false,
      'Yarn QC': false,
      'Yarn Storage': false,
      'Yarn to Vendor': false
    },
    'Yarn Issue': {
      'Issue for orders': false,
      'Linking & sampling': false
    },
    'Yarn Return': false,
    'Yarn Master': {
      'Brand': false,
      'Yarn Type': false,
      'Count/Size': false,
      'Color': false,
      'Blend': false
    }
  },
  'Warehouse Management': {
    'Orders': false,
    'Inward': false,
    'Clients': false,
    'Pick&Pack': false,
    'Scanning': false,
    'Billing': false,
    'Dispatch': false,
    'Returns': false,
    'Layout': false,
    'Stock': false,
    'Reports': false
  },
  'Vendor PO': {
    'Vendor List': false,
    'Vendor PO Raise': false,
    'Vendor PO Receive': false,
    'Secondary Checking': false,
    'Branding': false,
    'Re-Boarding': false,
    'Final Checking': false,
    'Dispatch': false,
    'M2 Management': false,
    'M3 Management': false,
    'M4 Management': false,
    'Counting & Dispatch': false,
    'GRN': false,
    'Vendor PO Return': false,
    'Vendor PO Return Challan': false
  }
};

/**
 * Role-based navigation templates
 */
export const ROLE_NAVIGATION_TEMPLATES = {
  admin: {
    Dashboard: {
      'Catalog Dashboard': true,
      'Production Dashboard': true,
      'Vendor Dashboard': true,
      'Yarn Dashboard': true,
    },
    Reports: {
      'Invoice Report': true,
      'Production order summary': true,
      'Core Report': true,
      'Backlog report': true,
      'Daily production summary': true,
      'Advanced Planning': true,
      'Needle Wise Planning': true,
    },
    Catalog: {
      Items: true,
      Categories: true,
      'Raw Material': true,
      Processes: true,
      Attributes: true,
      Machines: true,
      'Needle Configuration': true,
      'Team Master': true,
      'Containers Master': true
    },
    Sales: {
      'All Sales': true,
      'Master Sales': true
    },
    Stores: true,
    Analytics: true,
    'Replenishment Agent': true,
    'File Manager': true,
    'Help & Support': false,
    Users: true,
    'Production Planning': {
      'Production Orders': true,
      'Knitting Floor': true,
      'Linking Floor': true,
      'Checking Floor': true,
      'Washing Floor': true,
      'Boarding Floor': true,
      'Silicon Floor': true,
      'Secondary Checking Floor': true,
      'Branding Floor': true,
      'Re-Boarding Floor': true,
      'Final Checking Floor': true,
      'Dispatch Floor': true,
      'M4 Management': true,
      'M2 Management': true,
      'M3 Management': true,
      'Machine Floor': true,
      'Warehouse Floor': true
    },
    'Yarn Management': {
      'Dashboard': true,
      'Inventory': true,
      'Cataloguing': true,
      'Analytics & reports': true,
      'Purchase Management': {
        'Requisition list': true,
        'Purchase Order': true,
        'Purchase Order Recevied': true,
        'Draft POs': true,
        'PO Return': true,
        'PO Return Challan': true,
        'GRN History': true,
        'Yarn QC': true,
        'Yarn Storage': true,
        'Yarn to Vendor': true
      },
      'Yarn Issue': {
        'Issue for orders': true,
        'Linking & sampling': true
      },
      'Yarn Return': true,
      'Yarn Master': {
        'Brand': true,
        'Yarn Type': true,
        'Count/Size': true,
        'Color': true,
        'Blend': true
      }
    },
    'Warehouse Management': {
      'Orders': true,
      'Inward': true,
      'Clients': true,
      'Pick&Pack': true,
      'Scanning': true,
      'Billing': true,
      'Dispatch': true,
      'Returns': true,
      'Layout': true,
      'Stock': true,
      'Reports': true
    },
    'Vendor PO': {
      'Vendor List': true,
      'Vendor PO Raise': true,
      'Vendor PO Receive': true,
      'Secondary Checking': true,
      'Branding': true,
      'Re-Boarding': true,
      'Final Checking': true,
      'Dispatch': true,
      'M2 Management': true,
      'M3 Management': true,
      'M4 Management': true,
      'Counting & Dispatch': true,
      'GRN': true,
      'Vendor PO Return': true,
      'Vendor PO Return Challan': true
    }
  },
  user: {
    Dashboard: {
      'Catalog Dashboard': true,
      'Production Dashboard': true,
      'Vendor Dashboard': true,
      'Yarn Dashboard': true,
    },
    Reports: {
      'Invoice Report': false,
      'Production order summary': false,
      'Core Report': false,
      'Backlog report': false,
      'Daily production summary': false,
      'Advanced Planning': false,
      'Needle Wise Planning': false,
    },
    Catalog: {
      Items: true,
      Categories: false,
      'Raw Material': false,
      Processes: false,
      Attributes: false,
      Machines: false,
      'Needle Configuration': false,
      'Team Master': false,
      'Containers Master': false
    },
    Sales: {
      'All Sales': true,
      'Master Sales': false
    },
    Stores: false,
    Analytics: false,
    'Replenishment Agent': false,
    'File Manager': false,
    'Help & Support': false,
    Users: false,
    'Production Planning': {
      'Production Orders': false,
      'Knitting Floor': false,
      'Linking Floor': false,
      'Checking Floor': false,
      'Washing Floor': false,
      'Boarding Floor': false,
      'Silicon Floor': false,
      'Secondary Checking Floor': false,
    'Branding Floor': false,
    'Re-Boarding Floor': false,
    'Final Checking Floor': false,
    'Dispatch Floor': false,
    'M4 Management': false,
    'M2 Management': false,
    'M3 Management': false,
    'Machine Floor': false,
    'Warehouse Floor': false
  },
  'Yarn Management': {
      'Dashboard': false,
      'Inventory': false,
      'Cataloguing': false,
      'Analytics & reports': false,
      'Purchase Management': {
        'Requisition list': false,
        'Purchase Order': false,
        'Purchase Order Recevied': false,
        'Draft POs': false,
        'PO Return': false,
        'PO Return Challan': false,
        'GRN History': false,
        'Yarn QC': false,
        'Yarn Storage': false,
        'Yarn to Vendor': false
      },
      'Yarn Issue': {
        'Issue for orders': false,
        'Linking & sampling': false
      },
      'Yarn Return': false,
      'Yarn Master': {
        'Brand': false,
        'Yarn Type': false,
        'Count/Size': false,
        'Color': false,
        'Blend': false
      }
    },
    'Warehouse Management': {
      'Orders': false,
      'Inward': false,
      'Clients': false,
      'Pick&Pack': false,
      'Scanning': false,
      'Billing': false,
      'Dispatch': false,
      'Returns': false,
      'Layout': false,
      'Stock': false,
      'Reports': false
    },
    'Vendor PO': {
      'Vendor List': false,
      'Vendor PO Raise': false,
      'Vendor PO Receive': false,
      'Secondary Checking': false,
      'Branding': false,
      'Final Checking': false,
      'Dispatch': false,
      'M2 Management': false,
      'M3 Management': false,
      'M4 Management': false,
      'Counting & Dispatch': false,
      'GRN': false,
      'Vendor PO Return': false,
      'Vendor PO Return Challan': false
    }
  }
};

/** Same default navigation as `user` — label-only role for accounts team. */
ROLE_NAVIGATION_TEMPLATES.accounts = ROLE_NAVIGATION_TEMPLATES.user;

/** Same full navigation as admin. */
ROLE_NAVIGATION_TEMPLATES.super_admin = ROLE_NAVIGATION_TEMPLATES.admin;

/**
 * Get default navigation based on user role.
 * Role templates are merged onto DEFAULT_NAVIGATION so new keys are always present.
 * @param {string} role - User role
 * @returns {Object} Navigation object
 */
export const getDefaultNavigationByRole = (role) => {
  const roleTemplate = ROLE_NAVIGATION_TEMPLATES[role];
  if (!roleTemplate) {
    return JSON.parse(JSON.stringify(DEFAULT_NAVIGATION));
  }
  return mergeNavigation(JSON.parse(JSON.stringify(DEFAULT_NAVIGATION)), roleTemplate);
};

/**
 * Infer Reports flags from parent pages when a stored nav object has no Reports key.
 * Skips partial patches that do not look like a full navigation document.
 * @param {Object} navigation
 * @returns {Object}
 */
export const backfillMissingReports = (navigation) => {
  if (!navigation || typeof navigation !== 'object' || Array.isArray(navigation)) {
    return navigation;
  }
  const looksLikeFullNav =
    'Dashboard' in navigation ||
    'Production Planning' in navigation ||
    'Vendor PO' in navigation;
  if (!looksLikeFullNav) {
    return navigation;
  }
  if (navigation.Reports === true) {
    return {
      ...navigation,
      Reports: {
        'Invoice Report': true,
        'Production order summary': true,
        'Core Report': true,
        'Backlog report': true,
        'Daily production summary': true,
        'Advanced Planning': true,
        'Needle Wise Planning': true,
      },
    };
  }
  if (navigation.Reports && typeof navigation.Reports === 'object') {
    return navigation;
  }
  const vendorList = Boolean(navigation['Vendor PO']?.['Vendor List']);
  const productionOrders = Boolean(navigation['Production Planning']?.['Production Orders']);
  const knittingFloor = Boolean(navigation['Production Planning']?.['Knitting Floor']);
  return {
    ...navigation,
    Reports: {
      'Invoice Report': vendorList,
      'Production order summary': productionOrders,
      'Core Report': productionOrders,
      'Backlog report': productionOrders,
      'Daily production summary': productionOrders,
      'Advanced Planning': knittingFloor,
      'Needle Wise Planning': knittingFloor,
    },
  };
};

/**
 * Merge navigation objects deeply
 * @param {Object} target - Target navigation object
 * @param {Object} source - Source navigation object
 * @param {boolean} [isRoot=true] - When true, backfill missing Reports on source
 * @returns {Object} Merged navigation object
 */
export const mergeNavigation = (target, source, isRoot = true) => {
  const sourceFilled = isRoot ? backfillMissingReports(source) : source;
  const result = { ...target };

  for (const key in sourceFilled) {
    const sourceValue = sourceFilled[key];
    const targetValue = result[key];

    if (
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue)
    ) {
      const targetIsObject =
        targetValue !== null &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue);
      result[key] = mergeNavigation(targetIsObject ? targetValue : {}, sourceValue, false);
      continue;
    }

    // Do not replace a nested object with a primitive (legacy/corrupt user docs).
    if (
      typeof sourceValue === 'boolean' &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      if (key === 'Yarn Issue') {
        result[key] = sourceValue;
      }
      continue;
    }

    result[key] = sourceValue;
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
  const requiredKeys = ['Dashboard', 'Reports', 'Catalog', 'Sales', 'Stores', 'Analytics', 'Replenishment Agent', 'File Manager', 'Help & Support', 'Users', 'Production Planning', 'Yarn Management', 'Warehouse Management', 'Vendor PO'];
  for (const key of requiredKeys) {
    if (!(key in navigation)) {
      console.error(`Validation failed: Missing top-level key: ${key}`);
      return false;
    }
  }

  const dashboardKeys = ['Catalog Dashboard', 'Production Dashboard', 'Vendor Dashboard', 'Yarn Dashboard'];
  if (typeof navigation.Dashboard === 'boolean') {
    // Legacy boolean flag is still valid
  } else if (navigation.Dashboard && typeof navigation.Dashboard === 'object') {
    for (const key of dashboardKeys) {
      if (typeof navigation.Dashboard[key] !== 'boolean') {
        console.error(`Validation failed: Dashboard.${key} is missing or not a boolean`);
        return false;
      }
    }
  } else {
    console.error('Validation failed: Dashboard is missing or invalid');
    return false;
  }

  const reportKeys = [
    'Invoice Report',
    'Production order summary',
    'Core Report',
    'Backlog report',
    'Daily production summary',
    'Advanced Planning',
    'Needle Wise Planning',
  ];
  if (typeof navigation.Reports === 'boolean') {
    // Legacy boolean flag is still valid
  } else if (navigation.Reports && typeof navigation.Reports === 'object') {
    for (const key of reportKeys) {
      if (typeof navigation.Reports[key] !== 'boolean') {
        console.error(`Validation failed: Reports.${key} is missing or not a boolean`);
        return false;
      }
    }
  } else {
    console.error('Validation failed: Reports is missing or invalid');
    return false;
  }

  // Check Catalog structure
  if (!navigation.Catalog || typeof navigation.Catalog !== 'object') {
    console.error('Validation failed: Catalog is not an object');
    return false;
  }
  const catalogKeys = ['Items', 'Categories', 'Raw Material', 'Processes', 'Attributes', 'Machines', 'Needle Configuration', 'Team Master', 'Containers Master'];
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
    'Silicon Floor',
    'Secondary Checking Floor',
    'Branding Floor',
    'Re-Boarding Floor',
    'Final Checking Floor',
    'Dispatch Floor',
    'M4 Management',
    'M2 Management',
    'M3 Management',
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
  const yarnKeys = ['Dashboard', 'Inventory', 'Cataloguing', 'Analytics & reports', 'Purchase Management', 'Yarn Issue', 'Yarn Return', 'Yarn Master'];
  for (const key of yarnKeys) {
    if (key === 'Yarn Master') {
      // Yarn Master is a nested object
      if (!navigation['Yarn Management']['Yarn Master'] || typeof navigation['Yarn Management']['Yarn Master'] !== 'object') {
        console.error('Validation failed: Yarn Management.Yarn Master is missing or not an object');
        return false;
      }
      const yarnMasterKeys = ['Brand', 'Yarn Type', 'Count/Size', 'Color', 'Blend'];
      for (const masterKey of yarnMasterKeys) {
        if (!(masterKey in navigation['Yarn Management']['Yarn Master']) || typeof navigation['Yarn Management']['Yarn Master'][masterKey] !== 'boolean') {
          console.error(`Validation failed: Yarn Management.Yarn Master.${masterKey} is missing or not a boolean`);
          return false;
        }
      }
    } else if (key === 'Purchase Management') {
      // Purchase Management is a nested object
      if (!navigation['Yarn Management']['Purchase Management'] || typeof navigation['Yarn Management']['Purchase Management'] !== 'object') {
        console.error('Validation failed: Yarn Management.Purchase Management is missing or not an object');
        return false;
      }
      const purchaseManagementKeys = ['Requisition list', 'Purchase Order', 'Purchase Order Recevied', 'Draft POs', 'PO Return', 'PO Return Challan', 'GRN History', 'Yarn QC', 'Yarn Storage', 'Yarn to Vendor'];
      for (const purchaseKey of purchaseManagementKeys) {
        if (!(purchaseKey in navigation['Yarn Management']['Purchase Management']) || typeof navigation['Yarn Management']['Purchase Management'][purchaseKey] !== 'boolean') {
          console.error(`Validation failed: Yarn Management.Purchase Management.${purchaseKey} is missing or not a boolean`);
          return false;
        }
      }
    } else if (key === 'Yarn Issue') {
      const yi = navigation['Yarn Management']['Yarn Issue'];
      if (yi === true || yi === false) {
        continue;
      }
      if (!yi || typeof yi !== 'object') {
        console.error('Validation failed: Yarn Management.Yarn Issue is missing or not an object');
        return false;
      }
      const yarnIssueAllowedKeys = new Set(['Issue for orders', 'Linking & sampling', 'Linking', 'Sampling']);
      for (const [yk, val] of Object.entries(yi)) {
        if (!yarnIssueAllowedKeys.has(yk) || typeof val !== 'boolean') {
          console.error(`Validation failed: Yarn Management.Yarn Issue.${yk} invalid`);
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
  const warehouseKeys = ['Orders', 'Inward', 'Clients', 'Pick&Pack', 'Scanning', 'Billing', 'Dispatch', 'Returns', 'Layout', 'Stock', 'Reports'];
  for (const key of warehouseKeys) {
    if (!(key in navigation['Warehouse Management']) || typeof navigation['Warehouse Management'][key] !== 'boolean') {
      console.error(`Validation failed: Warehouse Management.${key} is missing or not a boolean`);
      return false;
    }
  }

  // Check Vendor PO structure
  if (!navigation['Vendor PO'] || typeof navigation['Vendor PO'] !== 'object') {
    console.error('Validation failed: Vendor PO is not an object');
    return false;
  }
  const vendorPOKeys = ['Vendor List', 'Vendor PO Raise', 'Vendor PO Receive', 'Secondary Checking', 'Branding', 'Final Checking', 'Dispatch', 'M2 Management', 'M3 Management', 'M4 Management', 'Counting & Dispatch', 'GRN', 'Vendor PO Return', 'Vendor PO Return Challan'];
  for (const key of vendorPOKeys) {
    if (!(key in navigation['Vendor PO']) || typeof navigation['Vendor PO'][key] !== 'boolean') {
      console.error(`Validation failed: Vendor PO.${key} is missing or not a boolean`);
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
