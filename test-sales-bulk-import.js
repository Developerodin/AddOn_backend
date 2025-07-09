import mongoose from 'mongoose';
import Sales from './src/models/sales.model.js';
import Store from './src/models/store.model.js';
import Product from './src/models/product.model.js';
import { bulkImportSales } from './src/services/sales.service.js';

// Test data
const testStore = {
  storeId: 'TEST001',
  storeName: 'Test Store',
  city: 'Test City',
  addressLine1: 'Test Address',
  storeNumber: 'ST001',
  pincode: '123456',
  contactPerson: 'Test Person',
  contactEmail: 'test@example.com',
  contactPhone: '1234567890',
  creditRating: 'A'
};

const testProduct = {
  name: 'Test Product',
  softwareCode: 'PRD-TEST-001',
  internalCode: 'INT001',
  vendorCode: 'VEND001',
  factoryCode: 'FACT001',
  styleCode: 'STYLE001',
  eanCode: '1234567890123',
  description: 'Test product description',
  category: new mongoose.Types.ObjectId(),
  status: 'active'
};

const testSalesRecords = [
  {
    date: new Date(),
    plant: 'TEST001', // storeId
    materialCode: 'STYLE001', // styleCode
    quantity: 10,
    mrp: 100,
    discount: 5,
    gsv: 950,
    nsv: 900,
    totalTax: 50
  },
  {
    date: new Date(),
    plant: 'TEST001',
    materialCode: 'STYLE001',
    quantity: 5,
    mrp: 200,
    discount: 10,
    gsv: 900,
    nsv: 850,
    totalTax: 60
  }
];

async function testBulkImport() {
  try {
    console.log('🚀 Starting sales bulk import test...');
    
    // Create test store
    console.log('📦 Creating test store...');
    const store = await Store.create(testStore);
    console.log('✅ Store created:', store.storeId);
    
    // Create test product
    console.log('📦 Creating test product...');
    const product = await Product.create(testProduct);
    console.log('✅ Product created:', product.styleCode);
    
    // Test bulk import
    console.log('📊 Testing bulk import...');
    const results = await bulkImportSales(testSalesRecords, 10);
    
    console.log('📈 Import Results:');
    console.log('- Total records:', results.total);
    console.log('- Created:', results.created);
    console.log('- Updated:', results.updated);
    console.log('- Failed:', results.failed);
    console.log('- Processing time:', results.processingTime + 'ms');
    
    if (results.errors.length > 0) {
      console.log('❌ Errors:');
      results.errors.forEach(error => {
        console.log(`  - Record ${error.index}: ${error.error}`);
      });
    } else {
      console.log('✅ No errors occurred');
    }
    
    // Verify records were created
    const salesCount = await Sales.countDocuments();
    console.log('📊 Total sales records in database:', salesCount);
    
    // Cleanup
    console.log('🧹 Cleaning up test data...');
    await Store.deleteOne({ storeId: testStore.storeId });
    await Product.deleteOne({ styleCode: testProduct.styleCode });
    await Sales.deleteMany({ plant: store._id });
    
    console.log('✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // Connect to MongoDB (you'll need to set up your connection)
  mongoose.connect(process.env.MONGODB_URL || 'mongodb://localhost:27017/test')
    .then(() => {
      console.log('🔌 Connected to MongoDB');
      return testBulkImport();
    })
    .then(() => {
      console.log('🏁 Test finished');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Test failed:', error);
      process.exit(1);
    });
} 