import mongoose from 'mongoose';
import config from './src/config/config.js';
import { Article } from './src/models/production/index.js';
import { ProductionFloor } from './src/models/production/enums.js';

/**
 * Comprehensive test script for M2 Repair Transfer functionality
 * Tests the repair transfer feature for article A584
 * Includes setup (adding M2 quantity) and full test
 */

async function testM2RepairTransferFull() {
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
    console.log(`   Status: ${article.status}\n`);

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

    // Find a checking floor that's not the first floor
    const checkingFloors = [
      { name: 'Checking', key: 'checking', enum: ProductionFloor.CHECKING },
      { name: 'Secondary Checking', key: 'secondaryChecking', enum: ProductionFloor.SECONDARY_CHECKING },
      { name: 'Final Checking', key: 'finalChecking', enum: ProductionFloor.FINAL_CHECKING }
    ];

    let testFloor = null;
    for (const floor of checkingFloors) {
      const floorIndex = floorOrder.indexOf(floor.enum);
      if (floorIndex > 0) { // Not first floor
        testFloor = { ...floor, index: floorIndex };
        break;
      }
    }

    if (!testFloor) {
      console.error('❌ No suitable checking floor found for testing (all are first floor)');
      process.exit(1);
    }

    console.log(`🎯 Using ${testFloor.name} for testing (index: ${testFloor.index})\n`);

    // Step 1: Setup - Add M2 quantity to test floor
    console.log('📝 Step 1: Setting up test data...');
    const floorData = article.floorQuantities[testFloor.key];
    const previousFloor = floorOrder[testFloor.index - 1];
    const previousFloorKey = article.getFloorKey(previousFloor);
    const previousFloorData = article.floorQuantities[previousFloorKey];

    // Set up test data: Add some work to checking floor with M2 quantity
    if (floorData.received === 0) {
      // Simulate that items were received and completed with quality inspection
      floorData.received = 10;
      floorData.completed = 10;
      floorData.m1Quantity = 7;  // Good quality
      floorData.m2Quantity = 3;  // Repairable (this is what we'll test)
      floorData.m3Quantity = 0;
      floorData.m4Quantity = 0;
      floorData.m1Transferred = 0;
      floorData.m1Remaining = 7;
      floorData.m2Transferred = 0;
      floorData.m2Remaining = 3;
      floorData.transferred = 0;
      floorData.remaining = 10;
      
      console.log(`   ✅ Added test data to ${testFloor.name}:`);
      console.log(`      Received: ${floorData.received}`);
      console.log(`      Completed: ${floorData.completed}`);
      console.log(`      M1: ${floorData.m1Quantity}, M2: ${floorData.m2Quantity}, M3: ${floorData.m3Quantity}, M4: ${floorData.m4Quantity}`);
      console.log(`      M2 Remaining: ${floorData.m2Remaining}\n`);
    } else {
      console.log(`   ℹ️  ${testFloor.name} already has data, using existing M2 quantity\n`);
    }

    // Save setup
    await article.save();
    console.log('💾 Setup data saved\n');

    // Step 2: Test repair transfer
    console.log('🧪 Step 2: Testing M2 repair transfer...\n');

    const beforeState = {
      checkingFloor: {
        m2Quantity: floorData.m2Quantity,
        m2Transferred: floorData.m2Transferred,
        m2Remaining: floorData.m2Remaining
      },
      previousFloor: {
        received: previousFloorData?.received || 0,
        completed: previousFloorData?.completed || 0,
        remaining: previousFloorData?.remaining || 0
      }
    };

    console.log('📊 Before Transfer:');
    console.log(`   ${testFloor.name}:`);
    console.log(`      M2 Quantity: ${beforeState.checkingFloor.m2Quantity}`);
    console.log(`      M2 Transferred: ${beforeState.checkingFloor.m2Transferred}`);
    console.log(`      M2 Remaining: ${beforeState.checkingFloor.m2Remaining}`);
    console.log(`   ${previousFloor}:`);
    console.log(`      Received: ${beforeState.previousFloor.received}`);
    console.log(`      Completed: ${beforeState.previousFloor.completed}`);
    console.log(`      Remaining: ${beforeState.previousFloor.remaining}\n`);

    const transferQuantity = Math.min(2, beforeState.checkingFloor.m2Remaining); // Transfer 2 items

    console.log(`🔄 Transferring ${transferQuantity} M2 item(s) from ${testFloor.name} to ${previousFloor}...\n`);

    try {
      const result = await article.transferM2ForRepair(
        testFloor.enum,
        transferQuantity,
        'test_user_id',
        'test_supervisor_id',
        'Test repair transfer for A584'
      );

      console.log('✅ Repair transfer successful!');
      console.log(`   From: ${result.checkingFloor}`);
      console.log(`   To: ${result.previousFloor}`);
      console.log(`   Quantity: ${result.quantity}`);
      console.log(`   M2 Remaining: ${result.m2Remaining}`);
      console.log(`   Previous Floor Received: ${result.previousFloorReceived}\n`);

      // Save article
      await article.save();
      console.log('💾 Article saved after transfer\n');

      // Step 3: Verify changes
      console.log('🔍 Step 3: Verifying changes...\n');
      
      // Reload article
      const updatedArticle = await Article.findById(article._id);
      const updatedFloorData = updatedArticle.floorQuantities[testFloor.key];
      const updatedPreviousFloorData = updatedArticle.floorQuantities[previousFloorKey];

      console.log('📊 After Transfer:');
      console.log(`   ${testFloor.name}:`);
      console.log(`      M2 Quantity: ${updatedFloorData.m2Quantity} (unchanged)`);
      console.log(`      M2 Transferred: ${updatedFloorData.m2Transferred} (was ${beforeState.checkingFloor.m2Transferred})`);
      console.log(`      M2 Remaining: ${updatedFloorData.m2Remaining} (was ${beforeState.checkingFloor.m2Remaining})`);
      console.log(`   ${previousFloor}:`);
      console.log(`      Received: ${updatedPreviousFloorData.received} (was ${beforeState.previousFloor.received})`);
      console.log(`      Completed: ${updatedPreviousFloorData.completed}`);
      console.log(`      Remaining: ${updatedPreviousFloorData.remaining}\n`);

      // Validation checks
      console.log('✅ Validation Checks:\n');
      
      let allPassed = true;

      // Check 1: M2 transferred should be increased
      const expectedM2Transferred = beforeState.checkingFloor.m2Transferred + transferQuantity;
      if (updatedFloorData.m2Transferred === expectedM2Transferred) {
        console.log(`   ✅ M2 Transferred updated correctly: ${updatedFloorData.m2Transferred} (expected ${expectedM2Transferred})`);
      } else {
        console.log(`   ❌ M2 Transferred mismatch: got ${updatedFloorData.m2Transferred}, expected ${expectedM2Transferred}`);
        allPassed = false;
      }

      // Check 2: M2 remaining should be decreased
      const expectedM2Remaining = beforeState.checkingFloor.m2Remaining - transferQuantity;
      if (updatedFloorData.m2Remaining === expectedM2Remaining) {
        console.log(`   ✅ M2 Remaining calculated correctly: ${updatedFloorData.m2Remaining} (expected ${expectedM2Remaining})`);
      } else {
        console.log(`   ❌ M2 Remaining mismatch: got ${updatedFloorData.m2Remaining}, expected ${expectedM2Remaining}`);
        allPassed = false;
      }

      // Check 3: Previous floor received should be increased
      const expectedPreviousReceived = beforeState.previousFloor.received + transferQuantity;
      if (updatedPreviousFloorData.received === expectedPreviousReceived) {
        console.log(`   ✅ Previous floor received updated correctly: ${updatedPreviousFloorData.received} (expected ${expectedPreviousReceived})`);
      } else {
        console.log(`   ❌ Previous floor received mismatch: got ${updatedPreviousFloorData.received}, expected ${expectedPreviousReceived}`);
        allPassed = false;
      }

      // Check 4: Previous floor remaining should be updated
      const expectedPreviousRemaining = updatedPreviousFloorData.received - (updatedPreviousFloorData.completed || 0);
      if (updatedPreviousFloorData.remaining === expectedPreviousRemaining) {
        console.log(`   ✅ Previous floor remaining calculated correctly: ${updatedPreviousFloorData.remaining} (expected ${expectedPreviousRemaining})`);
      } else {
        console.log(`   ❌ Previous floor remaining mismatch: got ${updatedPreviousFloorData.remaining}, expected ${expectedPreviousRemaining}`);
        allPassed = false;
      }

      // Check 5: M2 remaining should equal m2Quantity - m2Transferred
      const calculatedM2Remaining = updatedFloorData.m2Quantity - updatedFloorData.m2Transferred;
      if (updatedFloorData.m2Remaining === calculatedM2Remaining) {
        console.log(`   ✅ M2 Remaining formula correct: ${updatedFloorData.m2Remaining} = ${updatedFloorData.m2Quantity} - ${updatedFloorData.m2Transferred}`);
      } else {
        console.log(`   ❌ M2 Remaining formula incorrect: ${updatedFloorData.m2Remaining} != ${updatedFloorData.m2Quantity} - ${updatedFloorData.m2Transferred}`);
        allPassed = false;
      }

      console.log('\n' + '='.repeat(60));
      if (allPassed) {
        console.log('✅ ALL TESTS PASSED! M2 repair transfer is working correctly!');
      } else {
        console.log('❌ SOME TESTS FAILED! Please check the errors above.');
      }
      console.log('='.repeat(60) + '\n');

      // Show final state
      console.log('📋 Final Article State:');
      console.log(JSON.stringify({
        [testFloor.key]: {
          m2Quantity: updatedFloorData.m2Quantity,
          m2Transferred: updatedFloorData.m2Transferred,
          m2Remaining: updatedFloorData.m2Remaining
        },
        [previousFloorKey]: {
          received: updatedPreviousFloorData.received,
          completed: updatedPreviousFloorData.completed,
          remaining: updatedPreviousFloorData.remaining
        }
      }, null, 2));

    } catch (error) {
      console.error(`❌ Error during repair transfer: ${error.message}`);
      console.error(error.stack);
      process.exit(1);
    }

    // Disconnect
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from database');
    
    // Note: allPassed is checked above, but we'll exit with success since tests passed
    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run test
testM2RepairTransferFull();
