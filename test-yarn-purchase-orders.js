/**
 * Test Script: Create 5 Purchase Orders with 'submitted_to_supplier' status
 * 
 * This script creates 5 test purchase orders with the status 'submitted_to_supplier'.
 * It will use existing suppliers and yarn catalogs, or create them if they don't exist.
 */

import mongoose from 'mongoose';
import YarnPurchaseOrder from './src/models/yarnReq/yarnPurchaseOrder.model.js';
import Supplier from './src/models/yarnManagement/supplier.model.js';
import YarnCatalog from './src/models/yarnManagement/yarnCatalog.model.js';
import config from './src/config/config.js';

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

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    log.success('Connected to MongoDB');
  } catch (error) {
    log.error(`MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

// Get or create a supplier
const getOrCreateSupplier = async (index) => {
  try {
    // Try to find an existing supplier
    const existingSupplier = await Supplier.findOne({ status: 'active' });
    if (existingSupplier) {
      log.info(`Using existing supplier: ${existingSupplier.brandName}`);
      return existingSupplier;
    }

    // Create a new supplier if none exists
    log.test(`Creating supplier ${index + 1}...`);
    const supplier = await Supplier.create({
      brandName: `Test Supplier ${index + 1}`,
      contactPersonName: `Contact Person ${index + 1}`,
      contactNumber: `+91${9000000000 + index}`,
      email: `supplier${index + 1}@test.com`,
      address: `Test Address ${index + 1}`,
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
      country: 'India',
      gstNo: `27AATEST${String(index + 1).padStart(6, '0')}R1ZX`,
      status: 'active',
    });

    log.success(`Created supplier: ${supplier.brandName}`);
    return supplier;
  } catch (error) {
    log.error(`Error getting/creating supplier: ${error.message}`);
    throw error;
  }
};

// Get or create a yarn catalog
const getOrCreateYarnCatalog = async (index) => {
  try {
    // Try to find an existing yarn catalog
    const existingYarn = await YarnCatalog.findOne({ status: 'active' });
    if (existingYarn) {
      log.info(`Using existing yarn catalog: ${existingYarn.yarnName || 'Unnamed'}`);
      return existingYarn;
    }

    // If no yarn catalog exists, we need to create one with minimal required fields
    // But this requires YarnType, CountSize, Blend, and Color
    // For simplicity, we'll just try to find one or log a warning
    log.warning('No active yarn catalog found. Please create at least one yarn catalog manually.');
    log.warning('The script will attempt to use any yarn catalog, even if inactive.');
    
    const anyYarn = await YarnCatalog.findOne();
    if (anyYarn) {
      log.info(`Using yarn catalog: ${anyYarn.yarnName || 'Unnamed'}`);
      return anyYarn;
    }

    throw new Error('No yarn catalog found. Please create at least one yarn catalog before running this script.');
  } catch (error) {
    log.error(`Error getting yarn catalog: ${error.message}`);
    throw error;
  }
};

// Generate a unique PO number
const generatePONumber = (index) => {
  const timestamp = Date.now();
  return `PO-${timestamp}-${String(index + 1).padStart(3, '0')}`;
};

// Create a purchase order
const createPurchaseOrder = async (index, supplier, yarnCatalog) => {
  try {
    const poNumber = generatePONumber(index);
    
    // Create PO items
    const poItems = [
      {
        yarnName: yarnCatalog.yarnName || 'Test Yarn',
        yarn: yarnCatalog._id,
        sizeCount: yarnCatalog.countSize?.name || '40s',
        shadeCode: `SHADE-${index + 1}`,
        rate: 100 + (index * 10),
        quantity: 100 + (index * 50),
        estimatedDeliveryDate: new Date(Date.now() + (index + 1) * 7 * 24 * 60 * 60 * 1000), // 7 days * index
        gstRate: 18,
      },
    ];

    // Calculate totals
    const subTotal = poItems.reduce((sum, item) => sum + (item.rate * item.quantity), 0);
    const gst = poItems.reduce((sum, item) => {
      const itemGst = (item.rate * item.quantity * (item.gstRate || 18)) / 100;
      return sum + itemGst;
    }, 0);
    const total = subTotal + gst;

    // Create status log entry
    const statusLog = {
      statusCode: 'submitted_to_supplier',
      updatedBy: {
        username: 'test-user',
        user: new mongoose.Types.ObjectId(),
      },
      updatedAt: new Date(),
      notes: `Test purchase order ${index + 1}`,
    };

    const purchaseOrder = await YarnPurchaseOrder.create({
      poNumber,
      supplierName: supplier.brandName,
      supplier: supplier._id,
      poItems,
      notes: `Test purchase order ${index + 1} - Created by test script`,
      subTotal,
      gst,
      total,
      currentStatus: 'submitted_to_supplier',
      statusLogs: [statusLog],
    });

    log.success(`Created PO ${index + 1}: ${poNumber} (Total: ₹${total.toFixed(2)})`);
    return purchaseOrder;
  } catch (error) {
    log.error(`Error creating purchase order ${index + 1}: ${error.message}`);
    throw error;
  }
};

// Main function
const createPurchaseOrders = async () => {
  log.section('CREATING 5 PURCHASE ORDERS');

  try {
    // Get or create supplier (we'll reuse the same supplier for all POs)
    log.test('Getting supplier...');
    const supplier = await getOrCreateSupplier(0);

    // Get or create yarn catalog (we'll reuse the same yarn for all POs)
    log.test('Getting yarn catalog...');
    const yarnCatalog = await getOrCreateYarnCatalog(0);

    // Create 5 purchase orders
    const purchaseOrders = [];
    for (let i = 0; i < 5; i++) {
      log.test(`Creating purchase order ${i + 1}/5...`);
      const po = await createPurchaseOrder(i, supplier, yarnCatalog);
      purchaseOrders.push(po);
    }

    log.section('SUMMARY');
    log.success(`Successfully created ${purchaseOrders.length} purchase orders:`);
    purchaseOrders.forEach((po, index) => {
      log.info(`${index + 1}. ${po.poNumber} - Status: ${po.currentStatus} - Total: ₹${po.total.toFixed(2)}`);
    });

    return purchaseOrders;
  } catch (error) {
    log.error(`Error creating purchase orders: ${error.message}`);
    throw error;
  }
};

// Run the script
const run = async () => {
  console.log(`\n${colors.cyan}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}  ${colors.blue}PURCHASE ORDER TEST SCRIPT${colors.reset}                          ${colors.cyan}║${colors.reset}`);
  console.log(`${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}\n`);

  try {
    await connectDB();
    await createPurchaseOrders();
    log.success('\n✅ Script completed successfully!');
  } catch (error) {
    log.error(`\n❌ Script failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    log.info('Disconnected from MongoDB');
  }
};

// Run the script
run().catch((error) => {
  log.error(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});

