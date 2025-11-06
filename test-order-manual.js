import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3003/v1';
let authToken = '';
let createdOrderId = '';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.cyan}ℹ️  ${msg}${colors.reset}`),
  test: (msg) => console.log(`${colors.blue}🧪 ${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
};

/**
 * Authenticate and get JWT token
 */
async function authenticate() {
  try {
    log.test('Authenticating...');
    
    // First, create a test admin user or use existing credentials
    // For testing, you can either:
    // 1. Use existing admin credentials
    // 2. Create a test user first
    
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: process.env.TEST_ADMIN_EMAIL || 'admin@example.com',
        password: process.env.TEST_ADMIN_PASSWORD || 'password123',
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      log.warning('Login failed. Creating test admin user...');
      
      // Try to create admin user first
      const createResponse = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'password123',
          name: 'Test Admin',
          role: 'admin',
        }),
      });

      if (createResponse.ok) {
        log.success('Test admin user created');
        // Try login again
        const loginResponse = await fetch(`${BASE_URL}/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: 'admin@example.com',
            password: 'password123',
          }),
        });

        if (loginResponse.ok) {
          const data = await loginResponse.json();
          authToken = data.tokens.access.token;
          log.success('Authentication successful');
          return true;
        }
      }
      
      log.error('Authentication failed. Please ensure server is running and user exists.');
      log.info('You can set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD env variables');
      return false;
    }

    const data = await response.json();
    authToken = data.tokens.access.token;
    log.success('Authentication successful');
    return true;
  } catch (error) {
    log.error(`Authentication error: ${error.message}`);
    return false;
  }
}

/**
 * Test 1: Create Order Manually
 */
async function testCreateOrder() {
  log.test('\n1. Testing Create Order Manually');
  
  const orderData = {
    source: 'Website',
    externalOrderId: `TEST-ORD-${Date.now()}`,
    customer: {
      name: 'John Doe',
      phone: '+1234567890',
      email: 'john.doe@example.com',
      address: {
        street: '123 Main Street',
        city: 'New York',
        state: 'NY',
        country: 'USA',
        zipCode: '10001',
        addressLine1: '123 Main Street',
        addressLine2: 'Apt 4B',
      },
    },
    items: [
      {
        sku: 'SKU-001',
        name: 'Test Product 1',
        quantity: 2,
        price: 29.99,
      },
      {
        sku: 'SKU-002',
        name: 'Test Product 2',
        quantity: 1,
        price: 49.99,
      },
    ],
    payment: {
      method: 'Credit Card',
      status: 'pending',
      amount: 109.98,
    },
    logistics: {
      status: 'pending',
      trackingId: '',
      warehouse: 'Warehouse A',
      picker: '',
    },
    orderStatus: 'pending',
    meta: {
      notes: 'Test order created manually',
      testOrder: true,
    },
  };

  try {
    const response = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderData),
    });

    const data = await response.json();

    if (response.ok && data.id) {
      createdOrderId = data.id;
      log.success(`Order created successfully! ID: ${createdOrderId}`);
      log.info(`External Order ID: ${data.externalOrderId}`);
      log.info(`Order Status: ${data.orderStatus}`);
      log.info(`Total Amount: $${data.payment.amount}`);
      return true;
    } else {
      log.error(`Failed to create order: ${data.message || JSON.stringify(data)}`);
      return false;
    }
  } catch (error) {
    log.error(`Create order error: ${error.message}`);
    return false;
  }
}

/**
 * Test 2: Get All Orders
 */
async function testGetAllOrders() {
  log.test('\n2. Testing Get All Orders');
  
  try {
    const response = await fetch(`${BASE_URL}/orders?page=1&limit=10&sortBy=createdAt:desc`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    const data = await response.json();

    if (response.ok && data.results) {
      log.success(`Retrieved ${data.results.length} orders`);
      log.info(`Total Results: ${data.totalResults}`);
      log.info(`Total Pages: ${data.totalPages}`);
      log.info(`Current Page: ${data.page}`);
      return true;
    } else {
      log.error(`Failed to get orders: ${data.message || JSON.stringify(data)}`);
      return false;
    }
  } catch (error) {
    log.error(`Get orders error: ${error.message}`);
    return false;
  }
}

/**
 * Test 3: Get Single Order
 */
async function testGetSingleOrder() {
  log.test('\n3. Testing Get Single Order');
  
  if (!createdOrderId) {
    log.warning('No order ID available. Skipping test.');
    return false;
  }

  try {
    const response = await fetch(`${BASE_URL}/orders/${createdOrderId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    const data = await response.json();

    if (response.ok && data.id) {
      log.success(`Order retrieved successfully!`);
      log.info(`Order ID: ${data.id}`);
      log.info(`Source: ${data.source}`);
      log.info(`Status: ${data.orderStatus}`);
      log.info(`Customer: ${data.customer.name}`);
      log.info(`Items Count: ${data.items.length}`);
      return true;
    } else {
      log.error(`Failed to get order: ${data.message || JSON.stringify(data)}`);
      return false;
    }
  } catch (error) {
    log.error(`Get single order error: ${error.message}`);
    return false;
  }
}

/**
 * Test 4: Update Order Status
 */
async function testUpdateOrderStatus() {
  log.test('\n4. Testing Update Order Status');
  
  if (!createdOrderId) {
    log.warning('No order ID available. Skipping test.');
    return false;
  }

  const statuses = ['processing', 'completed'];
  
  for (const status of statuses) {
    try {
      const response = await fetch(`${BASE_URL}/orders/${createdOrderId}/status`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderStatus: status,
        }),
      });

      const data = await response.json();

      if (response.ok && data.orderStatus === status) {
        log.success(`Order status updated to: ${status}`);
      } else {
        log.error(`Failed to update status: ${data.message || JSON.stringify(data)}`);
        return false;
      }
    } catch (error) {
      log.error(`Update status error: ${error.message}`);
      return false;
    }
  }

  return true;
}

/**
 * Test 5: Update Logistics Information
 */
async function testUpdateLogistics() {
  log.test('\n5. Testing Update Logistics Information');
  
  if (!createdOrderId) {
    log.warning('No order ID available. Skipping test.');
    return false;
  }

  const logisticsUpdates = [
    {
      status: 'picked',
      warehouse: 'Warehouse A',
      picker: 'John Smith',
    },
    {
      status: 'packed',
      trackingId: '',
    },
    {
      status: 'shipped',
      trackingId: 'TRACK123456789',
    },
  ];

  for (const update of logisticsUpdates) {
    try {
      const response = await fetch(`${BASE_URL}/orders/${createdOrderId}/logistics`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(update),
      });

      const data = await response.json();

      if (response.ok && data.logistics) {
        log.success(`Logistics updated: ${update.status}`);
        if (update.trackingId) {
          log.info(`Tracking ID: ${data.logistics.trackingId}`);
        }
        if (update.picker) {
          log.info(`Picker: ${data.logistics.picker}`);
        }
      } else {
        log.error(`Failed to update logistics: ${data.message || JSON.stringify(data)}`);
        return false;
      }
    } catch (error) {
      log.error(`Update logistics error: ${error.message}`);
      return false;
    }
  }

  return true;
}

/**
 * Test 6: Update Payment Status
 */
async function testUpdatePayment() {
  log.test('\n6. Testing Update Payment Status');
  
  if (!createdOrderId) {
    log.warning('No order ID available. Skipping test.');
    return false;
  }

  // First get the order to get current payment amount
  try {
    const getResponse = await fetch(`${BASE_URL}/orders/${createdOrderId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    const orderData = await getResponse.json();
    
    if (!orderData.payment) {
      log.error('Order payment data not found');
      return false;
    }

    const paymentUpdates = [
      {
        payment: {
          status: 'completed',
          method: 'Credit Card',
          amount: orderData.payment.amount, // Include required amount field
        },
      },
    ];

    const response = await fetch(`${BASE_URL}/orders/${createdOrderId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(paymentUpdates[0]),
    });

    const data = await response.json();

    if (response.ok && data.payment.status === 'completed') {
      log.success('Payment status updated to: completed');
      log.info(`Payment Method: ${data.payment.method}`);
      log.info(`Payment Amount: $${data.payment.amount}`);
      return true;
    } else {
      log.error(`Failed to update payment: ${data.message || JSON.stringify(data)}`);
      return false;
    }
  } catch (error) {
    log.error(`Update payment error: ${error.message}`);
    return false;
  }
}

/**
 * Test 7: Update Order (Multiple Fields)
 */
async function testUpdateOrder() {
  log.test('\n7. Testing Update Order (Multiple Fields)');
  
  if (!createdOrderId) {
    log.warning('No order ID available. Skipping test.');
    return false;
  }

  // First get the order to get current customer name
  try {
    const getResponse = await fetch(`${BASE_URL}/orders/${createdOrderId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    const orderData = await getResponse.json();

    const updateData = {
      customer: {
        name: orderData.customer.name, // Include required name field
        email: 'updated.email@example.com',
        phone: '+9876543210',
      },
      items: [
        {
          sku: 'SKU-001-UPDATED',
          name: 'Updated Product 1',
          quantity: 3,
          price: 29.99,
        },
        {
          sku: 'SKU-003',
          name: 'New Product 3',
          quantity: 1,
          price: 79.99,
        },
      ],
      meta: {
        notes: 'Order updated with new items and customer info',
        updatedAt: new Date().toISOString(),
      },
    };

    const response = await fetch(`${BASE_URL}/orders/${createdOrderId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });

    const data = await response.json();

    if (response.ok && data.id) {
      log.success('Order updated successfully!');
      log.info(`Updated Customer Email: ${data.customer.email}`);
      log.info(`Updated Items Count: ${data.items.length}`);
      log.info(`Updated Items Total: ${data.items.reduce((sum, item) => sum + (item.price * item.quantity), 0).toFixed(2)}`);
      return true;
    } else {
      log.error(`Failed to update order: ${data.message || JSON.stringify(data)}`);
      return false;
    }
  } catch (error) {
    log.error(`Update order error: ${error.message}`);
    return false;
  }
}

/**
 * Test 8: Get Order by Source + External ID
 */
async function testGetOrderBySourceAndExternalId() {
  log.test('\n8. Testing Get Order by Source + External ID');
  
  if (!createdOrderId) {
    log.warning('No order ID available. Skipping test.');
    return false;
  }

  // First get the order to get its externalOrderId
  try {
    const getResponse = await fetch(`${BASE_URL}/orders/${createdOrderId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    const orderData = await getResponse.json();

    if (!orderData.id) {
      log.warning('Could not get order details. Skipping test.');
      return false;
    }

    const response = await fetch(
      `${BASE_URL}/orders/source/${orderData.source}/${orderData.externalOrderId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      }
    );

    const data = await response.json();

    if (response.ok && data.id) {
      log.success('Order retrieved by source + external ID!');
      log.info(`Source: ${data.source}`);
      log.info(`External Order ID: ${data.externalOrderId}`);
      return true;
    } else {
      log.error(`Failed to get order: ${data.message || JSON.stringify(data)}`);
      return false;
    }
  } catch (error) {
    log.error(`Get order by source error: ${error.message}`);
    return false;
  }
}

/**
 * Test 9: Get Orders with Filters
 */
async function testGetOrdersWithFilters() {
  log.test('\n9. Testing Get Orders with Filters');
  
  const filters = [
    { source: 'Website' },
    { orderStatus: 'completed' },
    { source: 'Website', orderStatus: 'pending' },
  ];

  for (const filter of filters) {
    try {
      const params = new URLSearchParams(filter);
      const response = await fetch(`${BASE_URL}/orders?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      const data = await response.json();

      if (response.ok && Array.isArray(data.results)) {
        log.success(`Filter ${JSON.stringify(filter)}: Found ${data.results.length} orders`);
      } else {
        log.error(`Filter failed: ${data.message || JSON.stringify(data)}`);
        return false;
      }
    } catch (error) {
      log.error(`Filter error: ${error.message}`);
      return false;
    }
  }

  return true;
}

/**
 * Test 10: Get Order Statistics
 */
async function testGetOrderStatistics() {
  log.test('\n10. Testing Get Order Statistics');
  
  try {
    const response = await fetch(`${BASE_URL}/orders/stats`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    const data = await response.json();

    if (response.ok && Array.isArray(data)) {
      log.success('Order statistics retrieved!');
      data.forEach((stat) => {
        log.info(`\nSource: ${stat._id}`);
        log.info(`Total Orders: ${stat.totalOrders}`);
        log.info(`Total Revenue: $${stat.totalRevenue}`);
        log.info(`Status Breakdown:`);
        stat.statuses.forEach((statusInfo) => {
          log.info(`  - ${statusInfo.status}: ${statusInfo.count} orders ($${statusInfo.amount})`);
        });
      });
      return true;
    } else {
      log.error(`Failed to get statistics: ${data.message || JSON.stringify(data)}`);
      return false;
    }
  } catch (error) {
    log.error(`Get statistics error: ${error.message}`);
    return false;
  }
}

/**
 * Test 11: Delete Order
 */
async function testDeleteOrder() {
  log.test('\n11. Testing Delete Order');
  
  if (!createdOrderId) {
    log.warning('No order ID available. Skipping test.');
    return false;
  }

  try {
    const response = await fetch(`${BASE_URL}/orders/${createdOrderId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    if (response.status === 204 || response.ok) {
      log.success('Order deleted successfully!');
      
      // Verify deletion
      const verifyResponse = await fetch(`${BASE_URL}/orders/${createdOrderId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (verifyResponse.status === 404) {
        log.success('Deletion verified - order no longer exists');
        return true;
      } else {
        log.warning('Order still exists after deletion');
        return false;
      }
    } else {
      const data = await response.json();
      log.error(`Failed to delete order: ${data.message || JSON.stringify(data)}`);
      return false;
    }
  } catch (error) {
    log.error(`Delete order error: ${error.message}`);
    return false;
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 ORDER MANAGEMENT API TEST SUITE');
  console.log('='.repeat(60));
  console.log(`📍 Base URL: ${BASE_URL}`);
  console.log(`⏰ Started: ${new Date().toLocaleString()}\n`);

  const startTime = Date.now();
  const results = {
    passed: 0,
    failed: 0,
    total: 0,
  };

  // Authenticate first
  const authSuccess = await authenticate();
  if (!authSuccess) {
    log.error('Authentication failed. Cannot proceed with tests.');
    log.info('\n💡 Tips:');
    log.info('1. Make sure the server is running (npm run dev)');
    log.info('2. Create an admin user first or set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD');
    process.exit(1);
  }

  // Run all tests
  const tests = [
    { name: 'Create Order', fn: testCreateOrder },
    { name: 'Get All Orders', fn: testGetAllOrders },
    { name: 'Get Single Order', fn: testGetSingleOrder },
    { name: 'Update Order Status', fn: testUpdateOrderStatus },
    { name: 'Update Logistics', fn: testUpdateLogistics },
    { name: 'Update Payment', fn: testUpdatePayment },
    { name: 'Update Order (Multiple Fields)', fn: testUpdateOrder },
    { name: 'Get Order by Source + External ID', fn: testGetOrderBySourceAndExternalId },
    { name: 'Get Orders with Filters', fn: testGetOrdersWithFilters },
    { name: 'Get Order Statistics', fn: testGetOrderStatistics },
    { name: 'Delete Order', fn: testDeleteOrder },
  ];

  for (const test of tests) {
    results.total++;
    try {
      const success = await test.fn();
      if (success) {
        results.passed++;
      } else {
        results.failed++;
      }
    } catch (error) {
      log.error(`Test "${test.name}" threw an error: ${error.message}`);
      results.failed++;
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const endTime = Date.now();
  const totalTime = ((endTime - startTime) / 1000).toFixed(2);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('='.repeat(60));
  console.log(`⏱️  Total Time: ${totalTime} seconds`);
  console.log(`✅ Passed: ${results.passed}/${results.total}`);
  console.log(`❌ Failed: ${results.failed}/${results.total}`);
  console.log(`📈 Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);
  console.log('='.repeat(60));

  if (results.failed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! Order management system is working perfectly!');
  } else {
    console.log(`\n⚠️  ${results.failed} test(s) failed. Please review the errors above.`);
  }

  console.log(`\n⏰ Completed: ${new Date().toLocaleString()}\n`);
}

// Run the tests
runAllTests().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});

