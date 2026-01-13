import mongoose from 'mongoose';
import config from './src/config/config.js';
import { Article } from './src/models/production/index.js';
import { ProductionFloor } from './src/models/production/enums.js';

/**
 * Test script for M2 Repair Transfer functionality
 * Tests the repair transfer feature for article A584
 */

async function testM2RepairTransfer() {
  try {
    // Connect to database
    console.log('🔌 Connecting to database...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('✅ Connected to database\n');

    // Find article A584
    console.log('📋 Finding article A584...');
    const article = await Article.findOne({ articleNumber: 'A584' });
    
    if (!article) {
      console.error('❌ Article A584 not found');
      process.exit(1);
    }
    
    console.log(`✅ Found article: ${article.articleNumber}`);
    console.log(`   Order ID: ${article.orderId}`);
    console.log(`   Status: ${article.status}`);
    console.log(`   Current Floor: ${article.currentFloor}\n`);

    // Get floor order from product
    console.log('🔍 Getting floor order from product...');
    let floorOrder;
    try {
      floorOrder = await article.getFloorOrder();
      console.log(`✅ Floor order: ${floorOrder.join(' → ')}\n`);
    } catch (error) {
      console.error(`❌ Error getting floor order: ${error.message}`);
      process.exit(1);
    }

    // Check M2 quantities on all checking floors
    console.log('📊 Checking M2 quantities on checking floors...\n');
    
    const checkingFloors = [
      { name: 'Checking', key: 'checking', enum: ProductionFloor.CHECKING },
      { name: 'Secondary Checking', key: 'secondaryChecking', enum: ProductionFloor.SECONDARY_CHECKING },
      { name: 'Final Checking', key: 'finalChecking', enum: ProductionFloor.FINAL_CHECKING }
    ];

    let foundM2 = false;
    let floorToTest = null;

    for (const floor of checkingFloors) {
      const floorData = article.floorQuantities[floor.key];
      if (!floorData) continue;

      const m2Quantity = floorData.m2Quantity || 0;
      const m2Transferred = floorData.m2Transferred || 0;
      const m2Remaining = m2Quantity - m2Transferred;

      console.log(`📦 ${floor.name}:`);
      console.log(`   M2 Quantity: ${m2Quantity}`);
      console.log(`   M2 Transferred: ${m2Transferred}`);
      console.log(`   M2 Remaining: ${m2Remaining}`);
      console.log(`   Received: ${floorData.received || 0}`);
      console.log(`   Completed: ${floorData.completed || 0}`);
      console.log(`   Transferred: ${floorData.transferred || 0}\n`);

      // Check if this floor is in the process flow
      const floorIndex = floorOrder.indexOf(floor.enum);
      if (floorIndex === -1) {
        console.log(`   ⚠️  Floor not in process flow, skipping\n`);
        continue;
      }

      // Check if there's M2 available and floor is not first
      if (m2Remaining > 0 && floorIndex > 0) {
        foundM2 = true;
        if (!floorToTest) {
          floorToTest = { ...floor, index: floorIndex };
        }
      }
    }

    if (!foundM2) {
      console.log('⚠️  No M2 quantity available for repair transfer on any checking floor');
      console.log('   To test, you need to have M2 quantity on a checking floor that is not the first floor\n');
      
      // Show current state
      console.log('📋 Current Article State:');
      console.log(JSON.stringify(article.floorQuantities, null, 2));
      
      await mongoose.disconnect();
      process.exit(0);
    }

    // Test repair transfer
    console.log(`🧪 Testing M2 repair transfer from ${floorToTest.name}...\n`);

    const previousFloor = floorOrder[floorToTest.index - 1];
    const previousFloorKey = article.getFloorKey(previousFloor);
    const previousFloorData = article.floorQuantities[previousFloorKey];

    console.log(`📥 Previous floor: ${previousFloor}`);
    console.log(`   Current received: ${previousFloorData?.received || 0}`);
    console.log(`   Current completed: ${previousFloorData?.completed || 0}\n`);

    const floorData = article.floorQuantities[floorToTest.key];
    const m2Remaining = (floorData.m2Quantity || 0) - (floorData.m2Transferred || 0);
    const testQuantity = Math.min(1, m2Remaining); // Transfer 1 item for testing

    console.log(`🔄 Transferring ${testQuantity} M2 item(s) for repair...\n`);

    // Perform repair transfer
    try {
      const result = await article.transferM2ForRepair(
        floorToTest.enum,
        testQuantity,
        'test_user_id',
        'test_supervisor_id',
        'Test repair transfer'
      );

      console.log('✅ Repair transfer successful!');
      console.log(`   From: ${result.checkingFloor}`);
      console.log(`   To: ${result.previousFloor}`);
      console.log(`   Quantity: ${result.quantity}`);
      console.log(`   M2 Remaining: ${result.m2Remaining}`);
      console.log(`   Previous Floor Received: ${result.previousFloorReceived}\n`);

      // Save article
      await article.save();
      console.log('💾 Article saved\n');

      // Reload article to verify changes
      console.log('🔄 Reloading article to verify changes...\n');
      await article.populate('orderId');
      const updatedArticle = await Article.findById(article._id);

      // Verify checking floor changes
      const updatedFloorData = updatedArticle.floorQuantities[floorToTest.key];
      console.log(`📊 Updated ${floorToTest.name} floor:`);
      console.log(`   M2 Quantity: ${updatedFloorData.m2Quantity}`);
      console.log(`   M2 Transferred: ${updatedFloorData.m2Transferred} (was ${floorData.m2Transferred})`);
      console.log(`   M2 Remaining: ${updatedFloorData.m2Remaining} (was ${m2Remaining})`);

      // Verify previous floor changes
      const updatedPreviousFloorData = updatedArticle.floorQuantities[previousFloorKey];
      console.log(`\n📊 Updated ${previousFloor} floor:`);
      console.log(`   Received: ${updatedPreviousFloorData.received} (was ${previousFloorData?.received || 0})`);
      console.log(`   Completed: ${updatedPreviousFloorData.completed}`);
      console.log(`   Remaining: ${updatedPreviousFloorData.remaining}`);

      // Validation checks
      console.log('\n✅ Validation Checks:');
      
      // Check 1: M2 transferred should be updated
      const expectedM2Transferred = (floorData.m2Transferred || 0) + testQuantity;
      if (updatedFloorData.m2Transferred === expectedM2Transferred) {
        console.log(`   ✅ M2 Transferred updated correctly: ${updatedFloorData.m2Transferred}`);
      } else {
        console.log(`   ❌ M2 Transferred mismatch: expected ${expectedM2Transferred}, got ${updatedFloorData.m2Transferred}`);
      }

      // Check 2: M2 remaining should be updated
      const expectedM2Remaining = (floorData.m2Quantity || 0) - updatedFloorData.m2Transferred;
      if (updatedFloorData.m2Remaining === expectedM2Remaining) {
        console.log(`   ✅ M2 Remaining calculated correctly: ${updatedFloorData.m2Remaining}`);
      } else {
        console.log(`   ❌ M2 Remaining mismatch: expected ${expectedM2Remaining}, got ${updatedFloorData.m2Remaining}`);
      }

      // Check 3: Previous floor received should be increased
      const expectedPreviousReceived = (previousFloorData?.received || 0) + testQuantity;
      if (updatedPreviousFloorData.received === expectedPreviousReceived) {
        console.log(`   ✅ Previous floor received updated correctly: ${updatedPreviousFloorData.received}`);
      } else {
        console.log(`   ❌ Previous floor received mismatch: expected ${expectedPreviousReceived}, got ${updatedPreviousFloorData.received}`);
      }

      // Check 4: Previous floor remaining should be updated
      const expectedPreviousRemaining = updatedPreviousFloorData.received - (updatedPreviousFloorData.completed || 0);
      if (updatedPreviousFloorData.remaining === expectedPreviousRemaining) {
        console.log(`   ✅ Previous floor remaining calculated correctly: ${updatedPreviousFloorData.remaining}`);
      } else {
        console.log(`   ❌ Previous floor remaining mismatch: expected ${expectedPreviousRemaining}, got ${updatedPreviousFloorData.remaining}`);
      }

      console.log('\n✅ All tests passed! M2 repair transfer is working correctly.\n');

    } catch (error) {
      console.error(`❌ Error during repair transfer: ${error.message}`);
      console.error(error.stack);
      process.exit(1);
    }

    // Disconnect
    await mongoose.disconnect();
    console.log('👋 Disconnected from database');
    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run test
testM2RepairTransfer();
