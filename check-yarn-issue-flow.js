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

async function checkFlow() {
  try {
    console.log('🔍 Starting yarn issue flow check...\n');
    console.log('='.repeat(80));

    // Step 1: Find Production Order
    console.log('\n📋 Step 1: Finding Production Order...');
    const productionOrder = await ProductionOrder.findOne({ orderNumber: ORDER_NUMBER })
      .populate('articles');
    
    if (!productionOrder) {
      console.error(`❌ Production Order ${ORDER_NUMBER} not found!`);
      return;
    }
    console.log(`✅ Found Production Order: ${productionOrder.orderNumber}`);
    console.log(`   - Status: ${productionOrder.status}`);
    console.log(`   - Priority: ${productionOrder.priority}`);
    console.log(`   - Articles count: ${productionOrder.articles?.length || 0}`);

    // Step 2: Find Article (assuming articleNumber matches factoryCode or we need to check)
    console.log('\n📦 Step 2: Finding Article...');
    let article = null;
    
    // Try to find by articleNumber matching factoryCode
    article = await Article.findOne({ 
      orderId: productionOrder._id,
      articleNumber: FACTORY_CODE 
    });
    
    if (!article) {
      // Try to find any article in this order
      const articles = await Article.find({ orderId: productionOrder._id });
      console.log(`   Found ${articles.length} articles in order:`);
      articles.forEach(a => {
        console.log(`     - Article Number: ${a.articleNumber}, ID: ${a.id}`);
      });
      
      if (articles.length > 0) {
        article = articles[0];
        console.log(`   ⚠️  Using first article: ${article.articleNumber}`);
      }
    }
    
    if (!article) {
      console.error(`❌ No article found for factory code ${FACTORY_CODE} in order ${ORDER_NUMBER}`);
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
      return;
    }
    console.log(`✅ Found Product: ${product.name}`);
    console.log(`   - Factory Code: ${product.factoryCode}`);
    console.log(`   - Software Code: ${product.softwareCode}`);
    console.log(`   - BOM items: ${product.bom?.length || 0}`);

    // Step 4: Check BOM for yarn
    console.log('\n🧵 Step 4: Checking BOM for yarn requirements...');
    if (!product.bom || product.bom.length === 0) {
      console.error(`❌ Product ${FACTORY_CODE} has no BOM items!`);
      return;
    }
    
    console.log(`   BOM Items:`);
    product.bom.forEach((item, idx) => {
      console.log(`     ${idx + 1}. Yarn: ${item.yarnName || 'N/A'}`);
      console.log(`        YarnCatalog ID: ${item.yarnCatalogId || 'N/A'}`);
      console.log(`        Quantity: ${item.quantity || 0}`);
    });

    // Step 5: Find YarnCatalog by yarnName
    console.log('\n📚 Step 5: Finding YarnCatalog...');
    const yarnCatalog = await YarnCatalog.findOne({ yarnName: YARN_NAME });
    
    if (!yarnCatalog) {
      console.error(`❌ YarnCatalog with yarnName "${YARN_NAME}" not found!`);
      console.log(`   Searching for similar yarn names...`);
      const similarYarns = await YarnCatalog.find({ 
        yarnName: { $regex: YARN_NAME.split('/')[0], $options: 'i' } 
      }).limit(5);
      if (similarYarns.length > 0) {
        console.log(`   Found similar yarns:`);
        similarYarns.forEach(y => {
          console.log(`     - ${y.yarnName} (ID: ${y._id})`);
        });
      }
      return;
    }
    console.log(`✅ Found YarnCatalog: ${yarnCatalog.yarnName}`);
    console.log(`   - YarnCatalog ID: ${yarnCatalog._id}`);
    console.log(`   - Status: ${yarnCatalog.status}`);

    // Step 6: Check Storage Slot
    console.log('\n🏢 Step 6: Checking Storage Slot...');
    const storageSlot = await StorageSlot.findOne({ label: STORAGE_RACK });
    
    if (!storageSlot) {
      console.error(`❌ Storage slot ${STORAGE_RACK} not found!`);
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
    if (yarnCones.length > 0) {
      const totalWeight = yarnCones.reduce((sum, cone) => sum + (cone.coneWeight || 0), 0);
      const totalTearWeight = yarnCones.reduce((sum, cone) => sum + (cone.tearWeight || 0), 0);
      const totalNetWeight = totalWeight - totalTearWeight;
      
      console.log(`   - Total Weight: ${totalWeight}`);
      console.log(`   - Total Tear Weight: ${totalTearWeight}`);
      console.log(`   - Total Net Weight: ${totalNetWeight}`);
      console.log(`   - Average Cone Weight: ${totalWeight / yarnCones.length}`);
      
      if (yarnCones.length > 0) {
        console.log(`   Sample cones:`);
        yarnCones.slice(0, 3).forEach((cone, idx) => {
          console.log(`     ${idx + 1}. Cone Weight: ${cone.coneWeight}, Tear: ${cone.tearWeight}, Barcode: ${cone.barcode || 'N/A'}`);
        });
      }
    } else {
      console.log(`   ⚠️  No unissued cones found at ${STORAGE_RACK} for yarn ${YARN_NAME}`);
      
      // Check all cones at this location
      const allCones = await YarnCone.find({ coneStorageId: STORAGE_RACK });
      console.log(`   Total cones at ${STORAGE_RACK}: ${allCones.length}`);
      if (allCones.length > 0) {
        const issuedCount = allCones.filter(c => c.issueStatus === 'issued').length;
        console.log(`   - Issued: ${issuedCount}`);
        console.log(`   - Not Issued: ${allCones.length - issuedCount}`);
      }
    }

    // Step 8: Check Yarn Inventory
    console.log('\n📊 Step 8: Checking Yarn Inventory...');
    const yarnInventory = await YarnInventory.findOne({ yarn: yarnCatalog._id });
    
    if (!yarnInventory) {
      console.log(`   ⚠️  No inventory record found for yarn ${YARN_NAME}`);
      console.log(`   This is normal if no transactions have been created yet.`);
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

    // Step 9: Attempt to create yarn transaction
    console.log('\n🔄 Step 9: Attempting to create yarn transaction...');
    
    // Calculate quantities based on available cones
    const conesToIssue = yarnCones.length > 0 ? Math.min(yarnCones.length, 10) : 1; // Issue up to 10 cones or 1 if none found
    const totalWeight = conesToIssue * CONE_WEIGHT;
    const totalTearWeight = yarnCones.slice(0, conesToIssue).reduce((sum, cone) => sum + (cone.tearWeight || 0), 0);
    const totalNetWeight = totalWeight - totalTearWeight;

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

    console.log(`   Transaction payload:`);
    console.log(JSON.stringify(transactionPayload, null, 2));

    try {
      const transaction = await yarnTransactionService.createYarnTransaction(transactionPayload);
      console.log(`✅ Transaction created successfully!`);
      console.log(`   Transaction ID: ${transaction._id}`);
    } catch (error) {
      console.error(`❌ Failed to create transaction:`);
      console.error(`   Error: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
      
      // Additional debugging
      if (yarnInventory) {
        const shortTermNet = yarnInventory.shortTermInventory?.netWeight || 0;
        const requestedNet = totalNetWeight;
        console.log(`\n   Debug Info:`);
        console.log(`   - Short-term net weight available: ${shortTermNet}`);
        console.log(`   - Requested net weight: ${requestedNet}`);
        console.log(`   - Would result in: ${shortTermNet - requestedNet}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Flow check completed!');

  } catch (error) {
    console.error('\n❌ Error during flow check:');
    console.error(error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed.');
    process.exit(0);
  }
}

// Connect to MongoDB and run
mongoose.connect(config.mongoose.url, config.mongoose.options)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    return checkFlow();
  })
  .catch((error) => {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  });

