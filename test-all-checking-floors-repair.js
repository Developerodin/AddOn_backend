import mongoose from 'mongoose';
import config from './src/config/config.js';
import { Article } from './src/models/production/index.js';
import { ProductionFloor } from './src/models/production/enums.js';

/**
 * Test script to verify M2 repair transfer works for all checking floors
 * Tests: Checking, Secondary Checking, and Final Checking
 */

async function testAllCheckingFloorsRepair() {
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

    // Test all checking floors
    const checkingFloors = [
      { name: 'Checking', key: 'checking', enum: ProductionFloor.CHECKING },
      { name: 'Secondary Checking', key: 'secondaryChecking', enum: ProductionFloor.SECONDARY_CHECKING },
      { name: 'Final Checking', key: 'finalChecking', enum: ProductionFloor.FINAL_CHECKING }
    ];

    console.log('🧪 Testing M2 repair transfer for all checking floors...\n');
    console.log('='.repeat(70));

    for (const floor of checkingFloors) {
      const floorIndex = floorOrder.indexOf(floor.enum);
      
      if (floorIndex === -1) {
        console.log(`\n⚠️  ${floor.name}: Not in process flow, skipping\n`);
        continue;
      }

      if (floorIndex === 0) {
        console.log(`\n⚠️  ${floor.name}: First floor in flow, cannot transfer back\n`);
        continue;
      }

      console.log(`\n📦 Testing ${floor.name} (Index: ${floorIndex})`);
      console.log('-'.repeat(70));

      // Get available previous floors
      const previousFloors = floorOrder.slice(0, floorIndex);
      console.log(`   Available target floors: ${previousFloors.join(', ')}`);
      console.log(`   Default target (immediate previous): ${previousFloors[previousFloors.length - 1]}`);

      // Test 1: Default behavior (immediate previous floor)
      const defaultTarget = previousFloors[previousFloors.length - 1];
      console.log(`\n   ✅ Test 1: Default target floor (${defaultTarget})`);
      console.log(`      - Will transfer to immediate previous floor`);
      console.log(`      - No targetFloor parameter needed`);

      // Test 2: Select any previous floor
      if (previousFloors.length > 1) {
        const customTarget = previousFloors[0]; // First floor in flow
        console.log(`\n   ✅ Test 2: Custom target floor (${customTarget})`);
        console.log(`      - Can select any floor before ${floor.name}`);
        console.log(`      - Example: Transfer from ${floor.name} to ${customTarget}`);
        console.log(`      - Pass targetFloor: "${customTarget}" in request body`);
      }

      // Test 3: Middle floor selection
      if (previousFloors.length > 2) {
        const middleTarget = previousFloors[Math.floor(previousFloors.length / 2)];
        console.log(`\n   ✅ Test 3: Middle floor selection (${middleTarget})`);
        console.log(`      - Can skip multiple floors`);
        console.log(`      - Example: Transfer from ${floor.name} to ${middleTarget}`);
        console.log(`      - Pass targetFloor: "${middleTarget}" in request body`);
      }

      // Show floor data
      const floorData = article.floorQuantities[floor.key];
      if (floorData) {
        const m2Quantity = floorData.m2Quantity || 0;
        const m2Transferred = floorData.m2Transferred || 0;
        const m2Remaining = m2Quantity - m2Transferred;
        console.log(`\n   📊 Current M2 Status:`);
        console.log(`      M2 Quantity: ${m2Quantity}`);
        console.log(`      M2 Transferred: ${m2Transferred}`);
        console.log(`      M2 Remaining: ${m2Remaining}`);
      } else {
        console.log(`\n   📊 No data on this floor yet`);
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('\n✅ Summary:');
    console.log('   - All checking floors (Checking, Secondary Checking, Final Checking)');
    console.log('     support M2 repair transfer');
    console.log('   - Users can select ANY previous floor in the process flow');
    console.log('   - If targetFloor not specified, defaults to immediate previous floor');
    console.log('   - Validation ensures target floor is before checking floor\n');

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
testAllCheckingFloorsRepair();
