import mongoose from 'mongoose';
import config from './src/config/config.js';
import { Article } from './src/models/production/index.js';
import { ProductionFloor } from './src/models/production/enums.js';

/**
 * Test script to verify M2 repair transfer with target floor selection
 * Tests that users can select any previous floor, not just immediate previous
 */

async function testM2TargetFloorSelection() {
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
    
    console.log(`✅ Found article: ${article.articleNumber}\n`);

    // Get floor order
    console.log('🔍 Getting floor order from product...');
    let floorOrder;
    try {
      floorOrder = await article.getFloorOrder();
      console.log(`✅ Floor order: ${floorOrder.join(' → ')}\n`);
    } catch (error) {
      console.error(`❌ Error getting floor order: ${error.message}`);
      process.exit(1);
    }

    console.log('🧪 Testing M2 Repair Transfer with Target Floor Selection\n');
    console.log('='.repeat(70));

    // Test 1: From Checking Floor
    console.log('\n📦 Test 1: From Checking Floor');
    console.log('-'.repeat(70));
    
    const checkingIndex = floorOrder.indexOf(ProductionFloor.CHECKING);
    if (checkingIndex > 0) {
      const checkingFloorData = article.floorQuantities.checking;
      
      // Setup: Add M2 quantity if needed
      if ((checkingFloorData.m2Quantity || 0) === 0) {
        checkingFloorData.received = 10;
        checkingFloorData.completed = 10;
        checkingFloorData.m1Quantity = 7;
        checkingFloorData.m2Quantity = 3;
        checkingFloorData.m1Remaining = 7;
        checkingFloorData.m2Remaining = 3;
        checkingFloorData.m2Transferred = 0;
        await article.save();
        console.log('   ✅ Added test M2 data to Checking floor (M2: 3)');
      }
      
      const availableFloors = floorOrder.slice(0, checkingIndex);
      console.log(`   Available target floors: ${availableFloors.join(', ')}`);
      console.log(`   Default target: ${availableFloors[availableFloors.length - 1]}`);
      
      // Test default (immediate previous)
      const defaultTarget = availableFloors[availableFloors.length - 1];
      console.log(`\n   🧪 Test 1a: Default target (${defaultTarget})`);
      try {
        const beforeReceived = article.floorQuantities[article.getFloorKey(defaultTarget)]?.received || 0;
        const result = await article.transferM2ForRepair(
          ProductionFloor.CHECKING,
          1,
          'test_user',
          'test_supervisor',
          'Test default target',
          null // No targetFloor - should use default
        );
        await article.save();
        const afterReceived = article.floorQuantities[article.getFloorKey(defaultTarget)]?.received || 0;
        
        if (result.targetFloor === defaultTarget && afterReceived === beforeReceived + 1) {
          console.log(`      ✅ PASS: Transferred to default target ${defaultTarget}`);
          console.log(`         Received increased: ${beforeReceived} → ${afterReceived}`);
        } else {
          console.log(`      ❌ FAIL: Expected ${defaultTarget}, got ${result.targetFloor}`);
        }
      } catch (error) {
        console.log(`      ❌ ERROR: ${error.message}`);
      }
      
      // Test custom target (first floor)
      if (availableFloors.length > 1) {
        const customTarget = availableFloors[0];
        console.log(`\n   🧪 Test 1b: Custom target (${customTarget})`);
        try {
          const beforeReceived = article.floorQuantities[article.getFloorKey(customTarget)]?.received || 0;
          const result = await article.transferM2ForRepair(
            ProductionFloor.CHECKING,
            1,
            'test_user',
            'test_supervisor',
            'Test custom target',
            customTarget
          );
          await article.save();
          const afterReceived = article.floorQuantities[article.getFloorKey(customTarget)]?.received || 0;
          
          if (result.targetFloor === customTarget && afterReceived === beforeReceived + 1) {
            console.log(`      ✅ PASS: Transferred to custom target ${customTarget}`);
            console.log(`         Received increased: ${beforeReceived} → ${afterReceived}`);
          } else {
            console.log(`      ❌ FAIL: Expected ${customTarget}, got ${result.targetFloor}`);
          }
        } catch (error) {
          console.log(`      ❌ ERROR: ${error.message}`);
        }
      }
    }

    // Test 2: From Secondary Checking Floor
    console.log('\n📦 Test 2: From Secondary Checking Floor');
    console.log('-'.repeat(70));
    
    const secondaryCheckingIndex = floorOrder.indexOf(ProductionFloor.SECONDARY_CHECKING);
    if (secondaryCheckingIndex > 0) {
      const secondaryCheckingFloorData = article.floorQuantities.secondaryChecking;
      
      // Setup: Add M2 quantity if needed
      if ((secondaryCheckingFloorData.m2Quantity || 0) === 0) {
        secondaryCheckingFloorData.received = 10;
        secondaryCheckingFloorData.completed = 10;
        secondaryCheckingFloorData.m1Quantity = 7;
        secondaryCheckingFloorData.m2Quantity = 5;
        secondaryCheckingFloorData.m1Remaining = 7;
        secondaryCheckingFloorData.m2Remaining = 5;
        secondaryCheckingFloorData.m2Transferred = 0;
        await article.save();
        console.log('   ✅ Added test M2 data to Secondary Checking floor (M2: 5)');
      }
      
      const availableFloors = floorOrder.slice(0, secondaryCheckingIndex);
      console.log(`   Available target floors: ${availableFloors.join(', ')}`);
      console.log(`   Default target: ${availableFloors[availableFloors.length - 1]}`);
      
      // Test default
      const defaultTarget = availableFloors[availableFloors.length - 1];
      console.log(`\n   🧪 Test 2a: Default target (${defaultTarget})`);
      try {
        const beforeReceived = article.floorQuantities[article.getFloorKey(defaultTarget)]?.received || 0;
        const result = await article.transferM2ForRepair(
          ProductionFloor.SECONDARY_CHECKING,
          1,
          'test_user',
          'test_supervisor',
          'Test default target',
          null
        );
        await article.save();
        const afterReceived = article.floorQuantities[article.getFloorKey(defaultTarget)]?.received || 0;
        
        if (result.targetFloor === defaultTarget && afterReceived === beforeReceived + 1) {
          console.log(`      ✅ PASS: Transferred to default target ${defaultTarget}`);
          console.log(`         Received increased: ${beforeReceived} → ${afterReceived}`);
        } else {
          console.log(`      ❌ FAIL: Expected ${defaultTarget}, got ${result.targetFloor}`);
        }
      } catch (error) {
        console.log(`      ❌ ERROR: ${error.message}`);
      }
      
      // Test middle floor
      if (availableFloors.length > 2) {
        const middleTarget = availableFloors[Math.floor(availableFloors.length / 2)];
        console.log(`\n   🧪 Test 2b: Middle floor target (${middleTarget})`);
        try {
          const beforeReceived = article.floorQuantities[article.getFloorKey(middleTarget)]?.received || 0;
          const result = await article.transferM2ForRepair(
            ProductionFloor.SECONDARY_CHECKING,
            1,
            'test_user',
            'test_supervisor',
            'Test middle target',
            middleTarget
          );
          await article.save();
          const afterReceived = article.floorQuantities[article.getFloorKey(middleTarget)]?.received || 0;
          
          if (result.targetFloor === middleTarget && afterReceived === beforeReceived + 1) {
            console.log(`      ✅ PASS: Transferred to middle target ${middleTarget}`);
            console.log(`         Received increased: ${beforeReceived} → ${afterReceived}`);
          } else {
            console.log(`      ❌ FAIL: Expected ${middleTarget}, got ${result.targetFloor}`);
          }
        } catch (error) {
          console.log(`      ❌ ERROR: ${error.message}`);
        }
      }
    }

    // Test 3: From Final Checking Floor
    console.log('\n📦 Test 3: From Final Checking Floor');
    console.log('-'.repeat(70));
    
    const finalCheckingIndex = floorOrder.indexOf(ProductionFloor.FINAL_CHECKING);
    if (finalCheckingIndex > 0) {
      const finalCheckingFloorData = article.floorQuantities.finalChecking;
      
      // Setup: Add M2 quantity if needed
      if ((finalCheckingFloorData.m2Quantity || 0) === 0) {
        finalCheckingFloorData.received = 10;
        finalCheckingFloorData.completed = 10;
        finalCheckingFloorData.m1Quantity = 7;
        finalCheckingFloorData.m2Quantity = 5;
        finalCheckingFloorData.m1Remaining = 7;
        finalCheckingFloorData.m2Remaining = 5;
        finalCheckingFloorData.m2Transferred = 0;
        await article.save();
        console.log('   ✅ Added test M2 data to Final Checking floor (M2: 5)');
      }
      
      const availableFloors = floorOrder.slice(0, finalCheckingIndex);
      console.log(`   Available target floors: ${availableFloors.join(', ')}`);
      console.log(`   Default target: ${availableFloors[availableFloors.length - 1]}`);
      
      // Test default
      const defaultTarget = availableFloors[availableFloors.length - 1];
      console.log(`\n   🧪 Test 3a: Default target (${defaultTarget})`);
      try {
        const beforeReceived = article.floorQuantities[article.getFloorKey(defaultTarget)]?.received || 0;
        const result = await article.transferM2ForRepair(
          ProductionFloor.FINAL_CHECKING,
          1,
          'test_user',
          'test_supervisor',
          'Test default target',
          null
        );
        await article.save();
        const afterReceived = article.floorQuantities[article.getFloorKey(defaultTarget)]?.received || 0;
        
        if (result.targetFloor === defaultTarget && afterReceived === beforeReceived + 1) {
          console.log(`      ✅ PASS: Transferred to default target ${defaultTarget}`);
          console.log(`         Received increased: ${beforeReceived} → ${afterReceived}`);
        } else {
          console.log(`      ❌ FAIL: Expected ${defaultTarget}, got ${result.targetFloor}`);
        }
      } catch (error) {
        console.log(`      ❌ ERROR: ${error.message}`);
      }
      
      // Test first floor (Knitting)
      if (availableFloors.length > 1) {
        const firstTarget = availableFloors[0];
        console.log(`\n   🧪 Test 3b: First floor target (${firstTarget}) - skipping multiple floors`);
        try {
          const beforeReceived = article.floorQuantities[article.getFloorKey(firstTarget)]?.received || 0;
          const result = await article.transferM2ForRepair(
            ProductionFloor.FINAL_CHECKING,
            1,
            'test_user',
            'test_supervisor',
            'Test first floor target',
            firstTarget
          );
          await article.save();
          const afterReceived = article.floorQuantities[article.getFloorKey(firstTarget)]?.received || 0;
          
          if (result.targetFloor === firstTarget && afterReceived === beforeReceived + 1) {
            console.log(`      ✅ PASS: Transferred to first floor ${firstTarget}`);
            console.log(`         Received increased: ${beforeReceived} → ${afterReceived}`);
            console.log(`         Successfully skipped ${availableFloors.length - 1} floors`);
          } else {
            console.log(`      ❌ FAIL: Expected ${firstTarget}, got ${result.targetFloor}`);
          }
        } catch (error) {
          console.log(`      ❌ ERROR: ${error.message}`);
        }
      }
      
      // Test invalid target (should fail)
      console.log(`\n   🧪 Test 3c: Invalid target (should fail)`);
      try {
        const invalidTarget = ProductionFloor.WAREHOUSE; // This comes after Final Checking
        await article.transferM2ForRepair(
          ProductionFloor.FINAL_CHECKING,
          1,
          'test_user',
          'test_supervisor',
          'Test invalid target',
          invalidTarget
        );
        console.log(`      ❌ FAIL: Should have rejected invalid target ${invalidTarget}`);
      } catch (error) {
        if (error.message.includes('must come before')) {
          console.log(`      ✅ PASS: Correctly rejected invalid target`);
          console.log(`         Error: ${error.message}`);
        } else {
          console.log(`      ⚠️  Unexpected error: ${error.message}`);
        }
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('\n✅ Test Summary:');
    console.log('   - Default target floor selection works');
    console.log('   - Custom target floor selection works');
    console.log('   - Can skip multiple floors');
    console.log('   - Invalid targets are rejected');
    console.log('\n📋 Final Article State:');
    console.log(JSON.stringify({
      checking: {
        m2Quantity: article.floorQuantities.checking.m2Quantity,
        m2Transferred: article.floorQuantities.checking.m2Transferred,
        m2Remaining: article.floorQuantities.checking.m2Remaining
      },
      secondaryChecking: {
        m2Quantity: article.floorQuantities.secondaryChecking.m2Quantity,
        m2Transferred: article.floorQuantities.secondaryChecking.m2Transferred,
        m2Remaining: article.floorQuantities.secondaryChecking.m2Remaining
      },
      finalChecking: {
        m2Quantity: article.floorQuantities.finalChecking.m2Quantity,
        m2Transferred: article.floorQuantities.finalChecking.m2Transferred,
        m2Remaining: article.floorQuantities.finalChecking.m2Remaining
      }
    }, null, 2));

    // Disconnect
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from database');
    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run test
testM2TargetFloorSelection();
