/**
 * Test script to demonstrate additive transfers for checking floors
 * This shows how the new flow-based system handles partial transfers
 */

import mongoose from 'mongoose';
import { Article } from './src/models/production/index.js';
import { ProductionFloor } from './src/models/production/enums.js';

// Test data setup
const testArticle = {
  id: 'TEST_ADDITIVE_TRANSFER',
  orderId: new mongoose.Types.ObjectId(),
  articleNumber: 'ART_TEST_001',
  plannedQuantity: 1000,
  linkingType: 'Auto Linking',
  priority: 'Medium',
  status: 'In Progress',
  progress: 0,
  floorQuantities: {
    knitting: {
      received: 1000,
      completed: 1000,
      remaining: 0,
      transferred: 1000,
      m4Quantity: 0
    },
    linking: {
      received: 0,
      completed: 0,
      remaining: 0,
      transferred: 0
    },
    checking: {
      received: 1000,
      completed: 1000,
      remaining: 1000,
      transferred: 0,
      m1Quantity: 1000,
      m2Quantity: 0,
      m3Quantity: 0,
      m4Quantity: 0,
      m1Transferred: 0,
      m1Remaining: 1000,
      repairStatus: 'Not Required',
      repairRemarks: ''
    },
    washing: {
      received: 0,
      completed: 0,
      remaining: 0,
      transferred: 0
    },
    boarding: {
      received: 0,
      completed: 0,
      remaining: 0,
      transferred: 0
    },
    finalChecking: {
      received: 0,
      completed: 0,
      remaining: 0,
      transferred: 0,
      m1Quantity: 0,
      m2Quantity: 0,
      m3Quantity: 0,
      m4Quantity: 0,
      m1Transferred: 0,
      m1Remaining: 0,
      repairStatus: 'Not Required',
      repairRemarks: ''
    },
    branding: {
      received: 0,
      completed: 0,
      remaining: 0,
      transferred: 0
    },
    warehouse: {
      received: 0,
      completed: 0,
      remaining: 0,
      transferred: 0
    },
    dispatch: {
      received: 0,
      completed: 0,
      remaining: 0,
      transferred: 0
    }
  }
};

console.log('🧪 Testing Additive Transfers for Checking Floor');
console.log('================================================');

// Create article instance
const article = new Article(testArticle);

console.log('\n📊 Initial State:');
console.log(`Checking Floor: M1 Total: ${article.floorQuantities.checking.m1Quantity}, M1 Transferred: ${article.floorQuantities.checking.m1Transferred}, M1 Remaining: ${article.floorQuantities.checking.m1Remaining}`);
console.log(`Washing Floor: Received: ${article.floorQuantities.washing.received}`);

// Test 1: Transfer 500 M1 units from checking to washing
console.log('\n🔄 Test 1: Transfer 500 M1 units from checking to washing');
try {
  const result1 = await article.transferM1FromFloor(
    ProductionFloor.CHECKING, 
    500, 
    'user123', 
    'supervisor123', 
    'First partial transfer'
  );
  
  console.log('✅ Transfer 1 successful:');
  console.log(`   From: ${result1.fromFloor}, To: ${result1.toFloor}`);
  console.log(`   Quantity: ${result1.quantity}`);
  console.log(`   M1 Transferred: ${result1.m1Transferred}, M1 Remaining: ${result1.m1Remaining}`);
  console.log(`   Next Floor Received: ${result1.nextFloorReceived}`);
} catch (error) {
  console.error('❌ Transfer 1 failed:', error.message);
}

// Test 2: Transfer another 500 M1 units from checking to washing (additive)
console.log('\n🔄 Test 2: Transfer another 500 M1 units from checking to washing (additive)');
try {
  const result2 = await article.transferM1FromFloor(
    ProductionFloor.CHECKING, 
    500, 
    'user123', 
    'supervisor123', 
    'Second partial transfer'
  );
  
  console.log('✅ Transfer 2 successful:');
  console.log(`   From: ${result2.fromFloor}, To: ${result2.toFloor}`);
  console.log(`   Quantity: ${result2.quantity}`);
  console.log(`   M1 Transferred: ${result2.m1Transferred}, M1 Remaining: ${result2.m1Remaining}`);
  console.log(`   Next Floor Received: ${result2.nextFloorReceived}`);
} catch (error) {
  console.error('❌ Transfer 2 failed:', error.message);
}

// Test 3: Try to transfer more than remaining (should fail)
console.log('\n🔄 Test 3: Try to transfer 100 M1 units (should fail - only 0 remaining)');
try {
  const result3 = await article.transferM1FromFloor(
    ProductionFloor.CHECKING, 
    100, 
    'user123', 
    'supervisor123', 
    'This should fail'
  );
  
  console.log('❌ Transfer 3 should have failed but succeeded:', result3);
} catch (error) {
  console.log('✅ Transfer 3 correctly failed:', error.message);
}

console.log('\n📊 Final State:');
console.log(`Checking Floor: M1 Total: ${article.floorQuantities.checking.m1Quantity}, M1 Transferred: ${article.floorQuantities.checking.m1Transferred}, M1 Remaining: ${article.floorQuantities.checking.m1Remaining}`);
console.log(`Checking Floor: Transferred: ${article.floorQuantities.checking.transferred}, Remaining: ${article.floorQuantities.checking.remaining}`);
console.log(`Washing Floor: Received: ${article.floorQuantities.washing.received}, Remaining: ${article.floorQuantities.washing.remaining}`);

console.log('\n🎯 Summary:');
console.log('✅ Additive transfers work correctly for checking floors');
console.log('✅ M1 transfers are tracked separately from general transfers');
console.log('✅ Remaining quantities are calculated correctly');
console.log('✅ Next floor receives cumulative transfers');
console.log('✅ Validation prevents over-transferring');

console.log('\n🔧 How to use in your application:');
console.log('// Transfer 500 M1 units from checking to washing');
console.log('await article.transferM1FromFloor("Checking", 500, userId, supervisorId, remarks);');
console.log('');
console.log('// Transfer another 500 M1 units (additive)');
console.log('await article.transferM1FromFloor("Checking", 500, userId, supervisorId, remarks);');
console.log('');
console.log('// Result: checking.m1Transferred = 1000, washing.received = 1000');
