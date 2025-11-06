import * as websiteService from './src/services/sources/website.service.js';

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
  data: (msg) => console.log(`${colors.magenta}📦 ${msg}${colors.reset}`),
};

/**
 * Test fetching orders from Medusa API
 */
async function testFetchOrders() {
  log.test('\n1. Testing fetchOrders() - Fetching orders from Medusa API');
  
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days
  const endDate = new Date();
  const limit = 10;

  log.info(`Configuration:`);
  log.info(`  MEDUSA_BACKEND_URL: ${process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000 (default)'}`);
  log.info(`  MEDUSA_API_KEY: ${process.env.MEDUSA_API_KEY ? '✅ Set' : '❌ Not set'}`);
  log.info(`  Start Date: ${startDate.toISOString()}`);
  log.info(`  End Date: ${endDate.toISOString()}`);
  log.info(`  Limit: ${limit}`);

  try {
    log.test('\n📡 Calling fetchOrders()...');
    const orders = await websiteService.fetchOrders({
      startDate,
      endDate,
      limit,
    });

    if (Array.isArray(orders)) {
      log.success(`Successfully fetched ${orders.length} orders from Medusa API!`);
      
      if (orders.length > 0) {
        log.info('\n📋 Sample Order Data:');
        log.data(JSON.stringify(orders[0], null, 2));
        
        log.info(`\n📊 Order Summary:`);
        orders.forEach((order, index) => {
          log.info(`  Order ${index + 1}:`);
          log.info(`    ID: ${order.id || order.display_id || 'N/A'}`);
          log.info(`    Status: ${order.status || 'N/A'}`);
          log.info(`    Total: ${order.total ? `$${(order.total / 100).toFixed(2)}` : 'N/A'}`);
          log.info(`    Customer: ${order.customer?.email || order.email || 'N/A'}`);
          log.info(`    Items: ${order.items?.length || 0}`);
        });
      } else {
        log.warning('No orders found in the specified date range.');
      }
      
      return { success: true, orders, count: orders.length };
    } else {
      log.error(`Unexpected response format. Expected array, got: ${typeof orders}`);
      return { success: false, error: 'Invalid response format' };
    }
  } catch (error) {
    log.error(`Failed to fetch orders: ${error.message}`);
    
    if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
      log.warning('\n💡 Connection Error - Possible issues:');
      log.warning('  1. Medusa backend is not running');
      log.warning('  2. MEDUSA_BACKEND_URL is incorrect');
      log.warning('  3. Network connectivity issue');
    } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      log.warning('\n💡 Authentication Error - Possible issues:');
      log.warning('  1. MEDUSA_API_KEY is missing or incorrect');
      log.warning('  2. API key has expired');
      log.warning('  3. API key does not have required permissions');
    } else if (error.message.includes('404')) {
      log.warning('\n💡 Not Found Error - Possible issues:');
      log.warning('  1. Medusa API endpoint path is incorrect');
      log.warning('  2. Medusa version might be different');
    }
    
    log.info(`\n📝 Full Error Details:`);
    console.error(error);
    
    return { success: false, error: error.message };
  }
}

/**
 * Test normalizing a sample Medusa order
 */
async function testNormalizeOrder() {
  log.test('\n2. Testing normalizeOrder() - Converting Medusa order to internal format');
  
  // Sample Medusa order structure
  const sampleMedusaOrder = {
    id: 'order_123456',
    display_id: 12345,
    status: 'completed',
    fulfillment_status: 'fulfilled',
    payment_status: 'captured',
    email: 'customer@example.com',
    created_at: '2024-01-15T10:30:00.000Z',
    updated_at: '2024-01-20T14:45:00.000Z',
    total: 10998, // $109.98 in cents
    currency_code: 'USD',
    payment_method: 'Credit Card',
    customer: {
      id: 'cus_123',
      email: 'customer@example.com',
      first_name: 'John',
      last_name: 'Doe',
      phone: '+1234567890',
    },
    shipping_address: {
      address_1: '123 Main Street',
      address_2: 'Apt 4B',
      city: 'New York',
      province: 'NY',
      country_code: 'US',
      postal_code: '10001',
      phone: '+1234567890',
    },
    items: [
      {
        id: 'item_1',
        title: 'Test Product 1',
        quantity: 2,
        unit_price: 2999, // $29.99 in cents
        variant: {
          id: 'var_1',
          sku: 'SKU-001',
          title: 'Test Product 1',
        },
      },
      {
        id: 'item_2',
        title: 'Test Product 2',
        quantity: 1,
        unit_price: 4999, // $49.99 in cents
        variant: {
          id: 'var_2',
          sku: 'SKU-002',
          title: 'Test Product 2',
        },
      },
    ],
    fulfillments: [
      {
        tracking_numbers: ['TRACK123456789'],
      },
    ],
    metadata: {
      warehouse: 'Warehouse A',
      picker: 'John Smith',
    },
    region: {
      id: 'reg_1',
      name: 'US',
    },
  };

  try {
    log.info('Input (Medusa format):');
    log.data(JSON.stringify(sampleMedusaOrder, null, 2));
    
    log.test('\n🔄 Normalizing order...');
    const normalizedOrder = websiteService.normalizeOrder(sampleMedusaOrder);
    
    log.success('Order normalized successfully!');
    log.info('\n📋 Normalized Order (Internal format):');
    log.data(JSON.stringify(normalizedOrder, null, 2));
    
    // Validate normalized order structure
    log.test('\n🔍 Validating normalized order structure...');
    const requiredFields = [
      'source',
      'externalOrderId',
      'customer',
      'items',
      'payment',
      'logistics',
      'orderStatus',
      'timestamps',
    ];
    
    const missingFields = requiredFields.filter(field => !normalizedOrder[field]);
    
    if (missingFields.length === 0) {
      log.success('All required fields present!');
    } else {
      log.error(`Missing required fields: ${missingFields.join(', ')}`);
      return { success: false, error: 'Missing required fields' };
    }
    
    // Validate nested structures
    if (!normalizedOrder.customer.name) {
      log.error('Customer name is missing');
      return { success: false, error: 'Customer name missing' };
    }
    
    if (!Array.isArray(normalizedOrder.items) || normalizedOrder.items.length === 0) {
      log.error('Items array is missing or empty');
      return { success: false, error: 'Items missing' };
    }
    
    if (!normalizedOrder.payment.amount) {
      log.error('Payment amount is missing');
      return { success: false, error: 'Payment amount missing' };
    }
    
    log.success('All validations passed!');
    
    log.info('\n📊 Normalized Order Summary:');
    log.info(`  Source: ${normalizedOrder.source}`);
    log.info(`  External Order ID: ${normalizedOrder.externalOrderId}`);
    log.info(`  Customer: ${normalizedOrder.customer.name} (${normalizedOrder.customer.email})`);
    log.info(`  Items Count: ${normalizedOrder.items.length}`);
    log.info(`  Total Amount: $${normalizedOrder.payment.amount}`);
    log.info(`  Order Status: ${normalizedOrder.orderStatus}`);
    log.info(`  Logistics Status: ${normalizedOrder.logistics.status}`);
    
    return { success: true, normalizedOrder };
  } catch (error) {
    log.error(`Failed to normalize order: ${error.message}`);
    console.error(error);
    return { success: false, error: error.message };
  }
}

/**
 * Test with different date ranges
 */
async function testDifferentDateRanges() {
  log.test('\n3. Testing with different date ranges');
  
  const testCases = [
    {
      name: 'Last 24 hours',
      startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      endDate: new Date(),
    },
    {
      name: 'Last 7 days',
      startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      endDate: new Date(),
    },
    {
      name: 'Last 30 days',
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate: new Date(),
    },
  ];

  const results = [];

  for (const testCase of testCases) {
    try {
      log.info(`\n📅 Testing: ${testCase.name}`);
      log.info(`   From: ${testCase.startDate.toISOString()}`);
      log.info(`   To: ${testCase.endDate.toISOString()}`);
      
      const orders = await websiteService.fetchOrders({
        startDate: testCase.startDate,
        endDate: testCase.endDate,
        limit: 5,
      });

      log.success(`   Found ${orders.length} orders`);
      results.push({ ...testCase, success: true, count: orders.length });
    } catch (error) {
      log.error(`   Failed: ${error.message}`);
      results.push({ ...testCase, success: false, error: error.message });
    }
  }

  return results;
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 WEBSITE SERVICE (MEDUSA API) TEST SUITE');
  console.log('='.repeat(70));
  console.log(`⏰ Started: ${new Date().toLocaleString()}\n`);

  const startTime = Date.now();
  const results = {
    fetchOrders: null,
    normalizeOrder: null,
    dateRanges: null,
  };

  // Test 1: Fetch orders from API
  results.fetchOrders = await testFetchOrders();
  
  // Small delay
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 2: Normalize order
  results.normalizeOrder = await testNormalizeOrder();
  
  // Small delay
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 3: Different date ranges (only if first test succeeded)
  if (results.fetchOrders.success) {
    results.dateRanges = await testDifferentDateRanges();
  } else {
    log.warning('\n⚠️  Skipping date range tests due to API connection failure');
  }

  const endTime = Date.now();
  const totalTime = ((endTime - startTime) / 1000).toFixed(2);

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('='.repeat(70));
  console.log(`⏱️  Total Time: ${totalTime} seconds\n`);

  // Fetch Orders Test
  console.log('1. Fetch Orders from Medusa API:');
  if (results.fetchOrders.success) {
    log.success(`   ✅ SUCCESS - Fetched ${results.fetchOrders.count} orders`);
  } else {
    log.error(`   ❌ FAILED - ${results.fetchOrders.error}`);
  }

  // Normalize Order Test
  console.log('\n2. Normalize Order:');
  if (results.normalizeOrder.success) {
    log.success('   ✅ SUCCESS - Order normalized correctly');
  } else {
    log.error(`   ❌ FAILED - ${results.normalizeOrder.error}`);
  }

  // Date Range Tests
  if (results.dateRanges) {
    console.log('\n3. Date Range Tests:');
    results.dateRanges.forEach((result, index) => {
      if (result.success) {
        log.success(`   ✅ ${result.name}: ${result.count} orders`);
      } else {
        log.error(`   ❌ ${result.name}: ${result.error}`);
      }
    });
  }

  console.log('\n' + '='.repeat(70));

  const allTestsPassed = results.fetchOrders.success && results.normalizeOrder.success;
  
  if (allTestsPassed) {
    console.log('\n🎉 ALL TESTS PASSED! Website service is working correctly!');
    console.log('\n💡 Next Steps:');
    console.log('   1. Verify the fetched orders match your Medusa database');
    console.log('   2. Check that normalized orders have correct structure');
    console.log('   3. Test with real order sync endpoint');
  } else {
    console.log('\n⚠️  SOME TESTS FAILED. Please review the errors above.');
    console.log('\n💡 Troubleshooting Tips:');
    console.log('   1. Ensure Medusa backend is running');
    console.log('   2. Check MEDUSA_BACKEND_URL environment variable');
    console.log('   3. Verify MEDUSA_API_KEY is correct');
    console.log('   4. Check Medusa API documentation for endpoint changes');
  }

  console.log(`\n⏰ Completed: ${new Date().toLocaleString()}\n`);
}

// Run the tests
runAllTests().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});

