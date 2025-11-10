import fetch from 'node-fetch';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000/v1';
let authToken = '';

// Store created IDs for cleanup
const createdIds = {
  colors: [],
  countSizes: [],
  yarnTypes: [],
  suppliers: [],
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const log = {
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.cyan}ℹ️  ${msg}${colors.reset}`),
  test: (msg) => console.log(`${colors.blue}🧪 ${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  section: (msg) => console.log(`\n${colors.magenta}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n${colors.magenta}${msg}${colors.reset}\n${colors.magenta}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`),
};

/**
 * Check if server is running
 */
async function checkServer() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${BASE_URL.replace('/v1', '')}/`, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.ok || response.status === 404; // 404 is ok, means server is running
  } catch (error) {
    if (error.name === 'AbortError') {
      log.warning('Server check timed out');
    }
    return false;
  }
}

/**
 * Authenticate and get JWT token
 */
async function authenticate() {
  try {
    // First check if server is running
    log.test('Checking if server is running...');
    const serverRunning = await checkServer();
    if (!serverRunning) {
      log.error(`Server is not running or not accessible at ${BASE_URL}`);
      log.info('Please start the server first: npm run dev');
      return false;
    }
    log.success('Server is running');
    
    log.test('Authenticating...');
    const email = process.env.TEST_ADMIN_EMAIL || 'admin@example.com';
    const password = process.env.TEST_ADMIN_PASSWORD || 'password123';
    
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      log.warning(`Login failed: ${errorData.message || 'Invalid credentials'}`);
      log.info('\nTo fix this, you have a few options:');
      log.info('1. Create an admin user manually in the database');
      log.info('2. Use existing admin credentials:');
      log.info(`   TEST_ADMIN_EMAIL=your@email.com TEST_ADMIN_PASSWORD=yourpassword node test-yarn-management.js`);
      log.info('3. Or manually set a JWT token:');
      log.info(`   AUTH_TOKEN=your-jwt-token node test-yarn-management.js\n`);
      
      // Check if AUTH_TOKEN is provided as env variable
      if (process.env.AUTH_TOKEN) {
        authToken = process.env.AUTH_TOKEN;
        log.success('Using AUTH_TOKEN from environment variable');
        return true;
      }
      
      return false;
    }

    const data = await response.json();
    if (data.tokens && data.tokens.access && data.tokens.access.token) {
      authToken = data.tokens.access.token;
      log.success('Authentication successful');
      return true;
    } else {
      log.error('Unexpected response format from login endpoint');
      log.info('Response:', JSON.stringify(data, null, 2));
      return false;
    }
  } catch (error) {
    log.error(`Authentication error: ${error.message}`);
    if (error.code === 'ECONNREFUSED') {
      log.error(`Cannot connect to ${BASE_URL}`);
      log.info('Please ensure the server is running');
    }
    return false;
  }
}

/**
 * Make API request helper
 */
async function apiRequest(method, endpoint, body = null) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  };

  const options = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, options);
    const data = await response.json().catch(() => ({}));
    
    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: { message: error.message },
    };
  }
}

// ============================================================================
// COLORS API TESTS
// ============================================================================

async function testColorsAPI() {
  log.section('COLORS API TESTS');
  
  // Test 1: Create Color
  log.test('1. Creating a new color...');
  const createColorData = {
    name: `TestColor_${Date.now()}`,
    colorCode: '#FF5733',
    status: 'active',
  };
  
  let createResult = await apiRequest('POST', '/yarn-management/colors', createColorData);
  if (createResult.ok) {
    log.success(`Color created: ${createResult.data.name} (ID: ${createResult.data.id})`);
    createdIds.colors.push(createResult.data.id);
    
    const colorId = createResult.data.id;
    
    // Test 2: Get Color by ID
    log.test('2. Getting color by ID...');
    let getResult = await apiRequest('GET', `/yarn-management/colors/${colorId}`);
    if (getResult.ok) {
      log.success(`Color retrieved: ${getResult.data.name}`);
    } else {
      log.error(`Failed to get color: ${getResult.data.message || 'Unknown error'}`);
    }
    
    // Test 3: Get All Colors
    log.test('3. Getting all colors...');
    let getAllResult = await apiRequest('GET', '/yarn-management/colors?limit=10&page=1');
    if (getAllResult.ok) {
      log.success(`Retrieved ${getAllResult.data.results?.length || 0} colors`);
    } else {
      log.error(`Failed to get colors: ${getAllResult.data.message || 'Unknown error'}`);
    }
    
    // Test 4: Update Color
    log.test('4. Updating color...');
    const updateColorData = {
      name: `UpdatedColor_${Date.now()}`,
      colorCode: '#DC143C',
    };
    let updateResult = await apiRequest('PATCH', `/yarn-management/colors/${colorId}`, updateColorData);
    if (updateResult.ok) {
      log.success(`Color updated: ${updateResult.data.name}`);
    } else {
      log.error(`Failed to update color: ${updateResult.data.message || 'Unknown error'}`);
    }
    
    // Test 5: Delete Color
    log.test('5. Deleting color...');
    let deleteResult = await apiRequest('DELETE', `/yarn-management/colors/${colorId}`);
    if (deleteResult.ok || deleteResult.status === 204) {
      log.success('Color deleted successfully');
      createdIds.colors = createdIds.colors.filter(id => id !== colorId);
    } else {
      log.error(`Failed to delete color: ${deleteResult.data.message || 'Unknown error'}`);
    }
  } else {
    log.error(`Failed to create color: ${createResult.data.message || 'Unknown error'}`);
  }
  
  // Test 6: Validation Error
  log.test('6. Testing validation (invalid color code)...');
  const invalidColorData = {
    name: `InvalidColor_${Date.now()}`,
    colorCode: 'INVALID',
  };
  let invalidResult = await apiRequest('POST', '/yarn-management/colors', invalidColorData);
  if (!invalidResult.ok) {
    log.success('Validation error caught correctly');
  } else {
    log.error('Validation should have failed');
  }
}

// ============================================================================
// COUNT SIZES API TESTS
// ============================================================================

async function testCountSizesAPI() {
  log.section('COUNT SIZES API TESTS');
  
  // Test 1: Create Count Size
  log.test('1. Creating a new count size...');
  const createCountSizeData = {
    name: `40s_${Date.now()}`,
    status: 'active',
  };
  
  let createResult = await apiRequest('POST', '/yarn-management/count-sizes', createCountSizeData);
  if (createResult.ok) {
    log.success(`Count size created: ${createResult.data.name} (ID: ${createResult.data.id})`);
    createdIds.countSizes.push(createResult.data.id);
    
    const countSizeId = createResult.data.id;
    
    // Test 2: Get Count Size by ID
    log.test('2. Getting count size by ID...');
    let getResult = await apiRequest('GET', `/yarn-management/count-sizes/${countSizeId}`);
    if (getResult.ok) {
      log.success(`Count size retrieved: ${getResult.data.name}`);
    } else {
      log.error(`Failed to get count size: ${getResult.data.message || 'Unknown error'}`);
    }
    
    // Test 3: Get All Count Sizes
    log.test('3. Getting all count sizes...');
    let getAllResult = await apiRequest('GET', '/yarn-management/count-sizes?limit=10&page=1');
    if (getAllResult.ok) {
      log.success(`Retrieved ${getAllResult.data.results?.length || 0} count sizes`);
    } else {
      log.error(`Failed to get count sizes: ${getAllResult.data.message || 'Unknown error'}`);
    }
    
    // Test 4: Update Count Size
    log.test('4. Updating count size...');
    const updateCountSizeData = {
      name: `60s_${Date.now()}`,
      status: 'inactive',
    };
    let updateResult = await apiRequest('PATCH', `/yarn-management/count-sizes/${countSizeId}`, updateCountSizeData);
    if (updateResult.ok) {
      log.success(`Count size updated: ${updateResult.data.name}`);
    } else {
      log.error(`Failed to update count size: ${updateResult.data.message || 'Unknown error'}`);
    }
    
    // Test 5: Delete Count Size
    log.test('5. Deleting count size...');
    let deleteResult = await apiRequest('DELETE', `/yarn-management/count-sizes/${countSizeId}`);
    if (deleteResult.ok || deleteResult.status === 204) {
      log.success('Count size deleted successfully');
      createdIds.countSizes = createdIds.countSizes.filter(id => id !== countSizeId);
    } else {
      log.error(`Failed to delete count size: ${deleteResult.data.message || 'Unknown error'}`);
    }
  } else {
    log.error(`Failed to create count size: ${createResult.data.message || 'Unknown error'}`);
  }
}

// ============================================================================
// YARN TYPES API TESTS
// ============================================================================

async function testYarnTypesAPI() {
  log.section('YARN TYPES API TESTS');
  
  // Test 1: Create Yarn Type
  log.test('1. Creating a new yarn type...');
  const createYarnTypeData = {
    name: `Cotton_${Date.now()}`,
    details: [
      {
        subtype: 'Combed Cotton',
        countSize: ['40s', '60s'],
        weight: 'Light',
      },
    ],
    status: 'active',
  };
  
  let createResult = await apiRequest('POST', '/yarn-management/yarn-types', createYarnTypeData);
  if (createResult.ok) {
    log.success(`Yarn type created: ${createResult.data.name} (ID: ${createResult.data.id})`);
    createdIds.yarnTypes.push(createResult.data.id);
    
    const yarnTypeId = createResult.data.id;
    
    // Test 2: Get Yarn Type by ID
    log.test('2. Getting yarn type by ID...');
    let getResult = await apiRequest('GET', `/yarn-management/yarn-types/${yarnTypeId}`);
    if (getResult.ok) {
      log.success(`Yarn type retrieved: ${getResult.data.name}`);
    } else {
      log.error(`Failed to get yarn type: ${getResult.data.message || 'Unknown error'}`);
    }
    
    // Test 3: Get All Yarn Types
    log.test('3. Getting all yarn types...');
    let getAllResult = await apiRequest('GET', '/yarn-management/yarn-types?limit=10&page=1');
    if (getAllResult.ok) {
      log.success(`Retrieved ${getAllResult.data.results?.length || 0} yarn types`);
    } else {
      log.error(`Failed to get yarn types: ${getAllResult.data.message || 'Unknown error'}`);
    }
    
    // Test 4: Update Yarn Type
    log.test('4. Updating yarn type...');
    const updateYarnTypeData = {
      name: `Premium Cotton_${Date.now()}`,
      details: [
        {
          subtype: 'Combed Cotton',
          countSize: ['40s', '60s', '80s'],
          weight: 'Light',
        },
      ],
    };
    let updateResult = await apiRequest('PATCH', `/yarn-management/yarn-types/${yarnTypeId}`, updateYarnTypeData);
    if (updateResult.ok) {
      log.success(`Yarn type updated: ${updateResult.data.name}`);
    } else {
      log.error(`Failed to update yarn type: ${updateResult.data.message || 'Unknown error'}`);
    }
    
    // Test 5: Delete Yarn Type
    log.test('5. Deleting yarn type...');
    let deleteResult = await apiRequest('DELETE', `/yarn-management/yarn-types/${yarnTypeId}`);
    if (deleteResult.ok || deleteResult.status === 204) {
      log.success('Yarn type deleted successfully');
      createdIds.yarnTypes = createdIds.yarnTypes.filter(id => id !== yarnTypeId);
    } else {
      log.error(`Failed to delete yarn type: ${deleteResult.data.message || 'Unknown error'}`);
    }
  } else {
    log.error(`Failed to create yarn type: ${createResult.data.message || 'Unknown error'}`);
  }
}

// ============================================================================
// SUPPLIERS API TESTS
// ============================================================================

async function testSuppliersAPI() {
  log.section('SUPPLIERS API TESTS');
  
  // Test 1: Create Supplier
  log.test('1. Creating a new supplier...');
  const createSupplierData = {
    brandName: `Test Supplier ${Date.now()}`,
    contactPersonName: 'John Doe',
    contactNumber: '+1234567890',
    email: `test${Date.now()}@supplier.com`,
    address: '123 Test Street, Test City, TC 12345',
    gstNo: `27ATEST${Date.now().toString().slice(-6)}R1ZX`,
    yarnDetails: [
      {
        yarnType: 'Cotton',
        color: 'Red',
        shadeNumber: 'RD-001',
      },
    ],
    status: 'active',
  };
  
  let createResult = await apiRequest('POST', '/yarn-management/suppliers', createSupplierData);
  if (createResult.ok) {
    log.success(`Supplier created: ${createResult.data.brandName} (ID: ${createResult.data.id})`);
    createdIds.suppliers.push(createResult.data.id);
    
    const supplierId = createResult.data.id;
    
    // Test 2: Get Supplier by ID
    log.test('2. Getting supplier by ID...');
    let getResult = await apiRequest('GET', `/yarn-management/suppliers/${supplierId}`);
    if (getResult.ok) {
      log.success(`Supplier retrieved: ${getResult.data.brandName}`);
    } else {
      log.error(`Failed to get supplier: ${getResult.data.message || 'Unknown error'}`);
    }
    
    // Test 3: Get All Suppliers
    log.test('3. Getting all suppliers...');
    let getAllResult = await apiRequest('GET', '/yarn-management/suppliers?limit=10&page=1');
    if (getAllResult.ok) {
      log.success(`Retrieved ${getAllResult.data.results?.length || 0} suppliers`);
    } else {
      log.error(`Failed to get suppliers: ${getAllResult.data.message || 'Unknown error'}`);
    }
    
    // Test 4: Update Supplier
    log.test('4. Updating supplier...');
    const updateSupplierData = {
      brandName: `Updated Supplier ${Date.now()}`,
      contactPersonName: 'Jane Smith',
    };
    let updateResult = await apiRequest('PATCH', `/yarn-management/suppliers/${supplierId}`, updateSupplierData);
    if (updateResult.ok) {
      log.success(`Supplier updated: ${updateResult.data.brandName}`);
    } else {
      log.error(`Failed to update supplier: ${updateResult.data.message || 'Unknown error'}`);
    }
    
    // Test 5: Delete Supplier
    log.test('5. Deleting supplier...');
    let deleteResult = await apiRequest('DELETE', `/yarn-management/suppliers/${supplierId}`);
    if (deleteResult.ok || deleteResult.status === 204) {
      log.success('Supplier deleted successfully');
      createdIds.suppliers = createdIds.suppliers.filter(id => id !== supplierId);
    } else {
      log.error(`Failed to delete supplier: ${deleteResult.data.message || 'Unknown error'}`);
    }
  } else {
    log.error(`Failed to create supplier: ${createResult.data.message || 'Unknown error'}`);
  }
  
  // Test 6: Validation Error
  log.test('6. Testing validation (invalid email)...');
  const invalidSupplierData = {
    brandName: `Invalid Supplier ${Date.now()}`,
    contactPersonName: 'Test Person',
    contactNumber: '+1234567890',
    email: 'invalid-email',
    address: '123 Test Street',
  };
  let invalidResult = await apiRequest('POST', '/yarn-management/suppliers', invalidSupplierData);
  if (!invalidResult.ok) {
    log.success('Validation error caught correctly');
  } else {
    log.error('Validation should have failed');
  }
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runTests() {
  console.log(`\n${colors.cyan}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}  ${colors.blue}YARN MANAGEMENT API TEST SUITE${colors.reset}                    ${colors.cyan}║${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}  Base URL: ${BASE_URL.padEnd(50)} ${colors.cyan}║${colors.reset}`);
  console.log(`${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}\n`);
  
  // Check if AUTH_TOKEN is provided directly
  if (process.env.AUTH_TOKEN) {
    authToken = process.env.AUTH_TOKEN;
    log.success('Using AUTH_TOKEN from environment variable');
  } else {
    // Authenticate first
    const authSuccess = await authenticate();
    if (!authSuccess) {
      log.error('Cannot proceed without authentication. Exiting...');
      log.info('\nQuick fix: Get a JWT token from your server and run:');
      log.info('AUTH_TOKEN=your-jwt-token node test-yarn-management.js\n');
      process.exit(1);
    }
  }
  
  // Run all test suites
  try {
    await testColorsAPI();
    await testCountSizesAPI();
    await testYarnTypesAPI();
    await testSuppliersAPI();
    
    // Summary
    log.section('TEST SUMMARY');
    log.info(`Created Colors: ${createdIds.colors.length}`);
    log.info(`Created Count Sizes: ${createdIds.countSizes.length}`);
    log.info(`Created Yarn Types: ${createdIds.yarnTypes.length}`);
    log.info(`Created Suppliers: ${createdIds.suppliers.length}`);
    
    log.success('\n✅ All tests completed!');
    log.info('\nNote: Some resources may still exist in the database.');
    log.info('You may want to clean them up manually if needed.\n');
    
  } catch (error) {
    log.error(`Test execution error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run the tests
runTests().catch((error) => {
  log.error(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});

