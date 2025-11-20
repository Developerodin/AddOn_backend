// Set NODE_ENV if not already set
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

import mongoose from 'mongoose';
import config from './src/config/config.js';
import ProductionOrder from './src/models/production/productionOrder.model.js';
import Article from './src/models/production/article.model.js';
import Product from './src/models/product.model.js';
import YarnCatalog from './src/models/yarnManagement/yarnCatalog.model.js';
import YarnInventory from './src/models/yarnReq/yarnInventory.model.js';
import StorageSlot from './src/models/storageManagement/storageSlot.model.js';
import YarnCone from './src/models/yarnReq/yarnCone.model.js';
import * as yarnTransactionService from './src/services/yarnManagement/yarnTransaction.service.js';

const ORDER_NUMBER = 'ORD-000001';
const FACTORY_CODE = 'FC231';
const YARN_NAME = '100/1-Beige-Nylon/Nylon';
const STORAGE_RACK = 'ST-S001-F3';
const CONE_WEIGHT = 40;

async function testYarnIssueFlow() {
  try {
    console.log('🔍 Testing Yarn Issue Flow\n');
    console.log('='.repeat(80));
    console.log(`Order Number: ${ORDER_NUMBER}`);
    console.log(`Factory Code: ${FACTORY_CODE}`);
    console.log(`Yarn Name: ${YARN_NAME}`);
    console.log(`Storage Rack: ${STORAGE_RACK}`);
    console.log(`Cone Weight: ${CONE_WEIGHT}`);
    console.log('='.repeat(80));

    // Step 1: Find Production Order
    console.log('\n📋 Step 1: Finding Production Order...');
    const productionOrder = await ProductionOrder.findOne({ orderNumber: ORDER_NUMBER })
      .populate('articles');
    
    if (!productionOrder) {
      console.error(`❌ Production Order ${ORDER_NUMBER} not found!`);
      console.log('\n   Available orders:');
      const allOrders = await ProductionOrder.find({}).limit(5).select('orderNumber');
      allOrders.forEach(o => console.log(`     - ${o.orderNumber}`));
      return;
    }
    console.log(`✅ Found Production Order: ${productionOrder.orderNumber}`);
    console.log(`   - ID: ${productionOrder._id}`);
    console.log(`   - Status: ${productionOrder.status}`);
    console.log(`   - Priority: ${productionOrder.priority}`);
    console.log(`   - Articles count: ${productionOrder.articles?.length || 0}`);

    // Step 2: Find Article by articleNumber (should match factoryCode)
    console.log('\n📦 Step 2: Finding Article...');
    let article = null;
    
    // First try exact match
    article = await Article.findOne({ 
      orderId: productionOrder._id,
      articleNumber: FACTORY_CODE 
    });
    
    if (!article) {
      // List all articles in this order
      const articles = await Article.find({ orderId: productionOrder._id });
      console.log(`   Found ${articles.length} articles in order:`);
      articles.forEach(a => {
        console.log(`     - Article Number: ${a.articleNumber}, ID: ${a.id}`);
      });
      
      if (articles.length > 0) {
        article = articles[0];
        console.log(`   ⚠️  Using first article: ${article.articleNumber} (expected: ${FACTORY_CODE})`);
      }
    }
    
    if (!article) {
      console.error(`❌ No article found in order ${ORDER_NUMBER}`);
      return;
    }
    console.log(`✅ Found Article: ${article.articleNumber}`);
    console.log(`   - Article ID: ${article.id}`);
    console.log(`   - Planned Quantity: ${article.plannedQuantity}`);
    console.log(`   - Status: ${article.status}`);

    // Step 3: Find Product by factoryCode
    console.log('\n🏭 Step 3: Finding Product by factoryCode...');
    const product = await Product.findOne({ factoryCode: FACTORY_CODE });
    
    if (!product) {
      console.error(`❌ Product with factoryCode ${FACTORY_CODE} not found!`);
      console.log('\n   Searching for similar factory codes...');
      const similarProducts = await Product.find({ 
        factoryCode: { $regex: FACTORY_CODE.substring(0, 3), $options: 'i' } 
      }).limit(5);
      if (similarProducts.length > 0) {
        similarProducts.forEach(p => {
          console.log(`     - ${p.factoryCode}: ${p.name}`);
        });
      }
      return;
    }
    console.log(`✅ Found Product: ${product.name}`);
    console.log(`   - Factory Code: ${product.factoryCode}`);
    console.log(`   - Software Code: ${product.softwareCode}`);
    console.log(`   - Internal Code: ${product.internalCode}`);
    console.log(`   - BOM items: ${product.bom?.length || 0}`);

    // Step 4: Check BOM for yarn requirements
    console.log('\n🧵 Step 4: Checking BOM for yarn requirements...');
    if (!product.bom || product.bom.length === 0) {
      console.error(`❌ Product ${FACTORY_CODE} has no BOM items!`);
      return;
    }
    
    console.log(`   BOM Items (${product.bom.length}):`);
    product.bom.forEach((item, idx) => {
      console.log(`     ${idx + 1}. Yarn Name: ${item.yarnName || 'N/A'}`);
      console.log(`        YarnCatalog ID: ${item.yarnCatalogId || 'N/A'}`);
      console.log(`        Quantity: ${item.quantity || 0}`);
    });

    // Find the matching yarn in BOM
    const matchingBomItem = product.bom.find(item => 
      item.yarnName === YARN_NAME || 
      (item.yarnCatalogId && item.yarnCatalogId.toString())
    );
    
    if (!matchingBomItem) {
      console.error(`❌ Yarn "${YARN_NAME}" not found in BOM!`);
      console.log(`   Available yarns in BOM:`);
      product.bom.forEach(item => {
        console.log(`     - ${item.yarnName || 'N/A'}`);
      });
      return;
    }
    console.log(`✅ Found matching BOM item: ${matchingBomItem.yarnName}`);

    // Step 5: Find YarnCatalog
    console.log('\n📚 Step 5: Finding YarnCatalog...');
    let yarnCatalog = null;
    
    // Try by yarnCatalogId from BOM first
    if (matchingBomItem.yarnCatalogId) {
      yarnCatalog = await YarnCatalog.findById(matchingBomItem.yarnCatalogId);
      if (yarnCatalog) {
        console.log(`✅ Found YarnCatalog by ID: ${yarnCatalog.yarnName}`);
      }
    }
    
    // If not found, try by yarnName
    if (!yarnCatalog) {
      yarnCatalog = await YarnCatalog.findOne({ yarnName: YARN_NAME });
      if (yarnCatalog) {
        console.log(`✅ Found YarnCatalog by name: ${yarnCatalog.yarnName}`);
      }
    }
    
    if (!yarnCatalog) {
      console.error(`❌ YarnCatalog with yarnName "${YARN_NAME}" not found!`);
      console.log(`   Searching for similar yarn names...`);
      const similarYarns = await YarnCatalog.find({ 
        yarnName: { $regex: YARN_NAME.split('-')[0] || YARN_NAME.split('/')[0], $options: 'i' } 
      }).limit(5);
      if (similarYarns.length > 0) {
        console.log(`   Found similar yarns:`);
        similarYarns.forEach(y => {
          console.log(`     - ${y.yarnName} (ID: ${y._id})`);
        });
      }
      return;
    }
    
    console.log(`✅ YarnCatalog Details:`);
    console.log(`   - ID: ${yarnCatalog._id}`);
    console.log(`   - Yarn Name: ${yarnCatalog.yarnName}`);
    console.log(`   - Status: ${yarnCatalog.status}`);

    // Step 6: Check Storage Slot
    console.log('\n🏢 Step 6: Checking Storage Slot...');
    const storageSlot = await StorageSlot.findOne({ label: STORAGE_RACK });
    
    if (!storageSlot) {
      console.error(`❌ Storage slot ${STORAGE_RACK} not found!`);
      console.log(`   Searching for similar slots...`);
      const similarSlots = await StorageSlot.find({ 
        label: { $regex: STORAGE_RACK.split('-')[0], $options: 'i' } 
      }).limit(5);
      if (similarSlots.length > 0) {
        similarSlots.forEach(s => {
          console.log(`     - ${s.label} (${s.zoneCode})`);
        });
      }
      return;
    }
    console.log(`✅ Found Storage Slot: ${storageSlot.label}`);
    console.log(`   - Zone: ${storageSlot.zoneCode}`);
    console.log(`   - Shelf: ${storageSlot.shelfNumber}`);
    console.log(`   - Floor: ${storageSlot.floorNumber}`);
    console.log(`   - Active: ${storageSlot.isActive}`);

    // Step 7: Check Yarn Cones at storage location
    console.log('\n📦 Step 7: Checking Yarn Cones at storage location...');
    const yarnCones = await YarnCone.find({ 
      coneStorageId: STORAGE_RACK,
      yarn: yarnCatalog._id,
      issueStatus: 'not_issued'
    });
    
    console.log(`   Found ${yarnCones.length} unissued cones at ${STORAGE_RACK}`);
    if (yarnCones.length === 0) {
      // Check all cones at this location
      const allCones = await YarnCone.find({ 
        coneStorageId: STORAGE_RACK,
        yarn: yarnCatalog._id
      });
      console.log(`   Total cones at ${STORAGE_RACK} for this yarn: ${allCones.length}`);
      if (allCones.length > 0) {
        const issuedCount = allCones.filter(c => c.issueStatus === 'issued').length;
        console.log(`     - Issued: ${issuedCount}`);
        console.log(`     - Not Issued: ${allCones.length - issuedCount}`);
      } else {
        // Check if there are any cones at this location for any yarn
        const anyCones = await YarnCone.find({ coneStorageId: STORAGE_RACK });
        console.log(`   Total cones at ${STORAGE_RACK} (any yarn): ${anyCones.length}`);
      }
    } else {
      const totalWeight = yarnCones.reduce((sum, cone) => sum + (cone.coneWeight || 0), 0);
      const totalTearWeight = yarnCones.reduce((sum, cone) => sum + (cone.tearWeight || 0), 0);
      const totalNetWeight = totalWeight - totalTearWeight;
      
      console.log(`   - Total Weight: ${totalWeight}`);
      console.log(`   - Total Tear Weight: ${totalTearWeight}`);
      console.log(`   - Total Net Weight: ${totalNetWeight}`);
      console.log(`   - Average Cone Weight: ${totalWeight / yarnCones.length}`);
      
      if (yarnCones.length > 0) {
        console.log(`   Sample cones (first 3):`);
        yarnCones.slice(0, 3).forEach((cone, idx) => {
          console.log(`     ${idx + 1}. Weight: ${cone.coneWeight}, Tear: ${cone.tearWeight}, Barcode: ${cone.barcode || 'N/A'}`);
        });
      }
    }

    // Step 8: Check Yarn Inventory
    console.log('\n📊 Step 8: Checking Yarn Inventory...');
    const yarnInventory = await YarnInventory.findOne({ yarn: yarnCatalog._id });
    
    if (!yarnInventory) {
      console.log(`   ⚠️  No inventory record found for yarn ${YARN_NAME}`);
      console.log(`   This is normal if no transactions have been created yet.`);
      console.log(`   Inventory will be created automatically when transaction is created.`);
    } else {
      console.log(`✅ Found Yarn Inventory:`);
      console.log(`   Short-term:`);
      console.log(`     - Total Weight: ${yarnInventory.shortTermInventory?.totalWeight || 0}`);
      console.log(`     - Net Weight: ${yarnInventory.shortTermInventory?.netWeight || 0}`);
      console.log(`     - Number of Cones: ${yarnInventory.shortTermInventory?.numberOfCones || 0}`);
      console.log(`   Long-term:`);
      console.log(`     - Total Weight: ${yarnInventory.longTermInventory?.totalWeight || 0}`);
      console.log(`     - Net Weight: ${yarnInventory.longTermInventory?.netWeight || 0}`);
      console.log(`   Total:`);
      console.log(`     - Total Weight: ${yarnInventory.totalInventory?.totalWeight || 0}`);
      console.log(`     - Net Weight: ${yarnInventory.totalInventory?.netWeight || 0}`);
      console.log(`   Blocked:`);
      console.log(`     - Blocked Net Weight: ${yarnInventory.blockedNetWeight || 0}`);
      console.log(`   Status: ${yarnInventory.inventoryStatus}`);
    }

    // Step 9: Calculate quantities for transaction
    console.log('\n🔄 Step 9: Preparing yarn transaction...');
    
    // Use actual cone data if available, otherwise use estimated values
    let conesToIssue = 1;
    let totalWeight = CONE_WEIGHT;
    let totalTearWeight = 0;
    let totalNetWeight = CONE_WEIGHT;
    
    if (yarnCones.length > 0) {
      // Use actual cone data
      const conesToUse = yarnCones.slice(0, Math.min(yarnCones.length, 10));
      conesToIssue = conesToUse.length;
      totalWeight = conesToUse.reduce((sum, cone) => sum + (cone.coneWeight || CONE_WEIGHT), 0);
      totalTearWeight = conesToUse.reduce((sum, cone) => sum + (cone.tearWeight || 0), 0);
      totalNetWeight = totalWeight - totalTearWeight;
      
      console.log(`   Using ${conesToIssue} actual cones from storage`);
    } else {
      console.log(`   ⚠️  No cones found in storage, using estimated values`);
      console.log(`   Estimated: ${conesToIssue} cone(s) × ${CONE_WEIGHT} = ${totalWeight}`);
    }

    const transactionPayload = {
      yarn: yarnCatalog._id.toString(),
      yarnName: yarnCatalog.yarnName,
      transactionType: 'yarn_issued',
      transactionDate: new Date().toISOString(),
      totalWeight: totalWeight,
      totalNetWeight: totalNetWeight,
      totalTearWeight: totalTearWeight,
      numberOfCones: conesToIssue,
      orderno: ORDER_NUMBER
    };

    console.log(`\n   Transaction Payload:`);
    console.log(JSON.stringify(transactionPayload, null, 2));

    // Step 10: Attempt to create yarn transaction
    console.log('\n🚀 Step 10: Attempting to create yarn transaction...');
    
    if (yarnInventory) {
      const shortTermNet = yarnInventory.shortTermInventory?.netWeight || 0;
      const requestedNet = totalNetWeight;
      const wouldResultIn = shortTermNet - requestedNet;
      
      console.log(`   Current short-term net weight: ${shortTermNet}`);
      console.log(`   Requested net weight: ${requestedNet}`);
      console.log(`   Would result in: ${wouldResultIn} (negative values are now allowed)`);
    }

    try {
      const transaction = await yarnTransactionService.createYarnTransaction(transactionPayload);
      console.log(`\n✅ SUCCESS! Transaction created successfully!`);
      console.log(`   Transaction ID: ${transaction._id}`);
      console.log(`   Transaction Type: ${transaction.transactionType}`);
      console.log(`   Transaction Date: ${transaction.transactionDate}`);
      console.log(`   Total Weight: ${transaction.transactionTotalWeight}`);
      console.log(`   Net Weight: ${transaction.transactionNetWeight}`);
      console.log(`   Number of Cones: ${transaction.transactionConeCount}`);
      
      // Check updated inventory
      const updatedInventory = await YarnInventory.findOne({ yarn: yarnCatalog._id });
      if (updatedInventory) {
        console.log(`\n   Updated Inventory:`);
        console.log(`     Short-term net weight: ${updatedInventory.shortTermInventory?.netWeight || 0}`);
        console.log(`     Blocked net weight: ${updatedInventory.blockedNetWeight || 0}`);
      }
    } catch (error) {
      console.error(`\n❌ FAILED to create transaction:`);
      console.error(`   Error Message: ${error.message}`);
      console.error(`   Error Code: ${error.statusCode || 'N/A'}`);
      
      if (error.stack) {
        console.error(`\n   Stack Trace:`);
        console.error(error.stack);
      }
      
      // Additional debugging
      if (yarnInventory) {
        const shortTermNet = yarnInventory.shortTermInventory?.netWeight || 0;
        const requestedNet = totalNetWeight;
        console.log(`\n   Debug Info:`);
        console.log(`     - Short-term net weight available: ${shortTermNet}`);
        console.log(`     - Requested net weight: ${requestedNet}`);
        console.log(`     - Would result in: ${shortTermNet - requestedNet}`);
        console.log(`     - Short-term total weight: ${yarnInventory.shortTermInventory?.totalWeight || 0}`);
        console.log(`     - Short-term cones: ${yarnInventory.shortTermInventory?.numberOfCones || 0}`);
      }
      
      // Check validation errors
      if (error.message.includes('required') || error.message.includes('Missing')) {
        console.log(`\n   ⚠️  Validation Error: Check if all required fields are provided`);
      }
      
      if (error.message.includes('negative')) {
        console.log(`\n   ⚠️  Negative Inventory Error: This should be allowed now after recent changes`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Flow test completed!');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Fatal Error during flow test:');
    console.error(error);
    if (error.stack) {
      console.error('\nStack Trace:');
      console.error(error.stack);
    }
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed.');
    process.exit(0);
  }
}

// Connect to MongoDB and run
mongoose.connect(config.mongoose.url, config.mongoose.options)
  .then(() => {
    console.log('✅ Connected to MongoDB\n');
    return testYarnIssueFlow();
  })
  .catch((error) => {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  });

