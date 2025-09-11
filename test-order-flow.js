/**
 * Order Flow Test Script
 * Tests the complete production flow by moving quantities between floors
 * 
 * Flow: Knitting -> Linking -> Checking -> Washing -> Boarding -> Final Checking -> Branding -> Warehouse
 */

import mongoose from 'mongoose';
import Article from './src/models/production/article.model.js';
import ProductionOrder from './src/models/production/productionOrder.model.js';
import { ProductionFloor, OrderStatus, Priority, LinkingType } from './src/models/production/enums.js';
import './src/config/config.js';

// Test configuration
const TEST_CONFIG = {
  orderId: 'TEST_ORDER_001',
  articleNumber: 'TEST001',
  plannedQuantity: 1200,
  userId: 'test_user_001',
  floorSupervisorId: 'supervisor_001',
  machineId: 'machine_001',
  shiftId: 'shift_001'
};

// Floor flow order
const FLOOR_ORDER = [
  ProductionFloor.KNITTING,
  ProductionFloor.LINKING,
  ProductionFloor.CHECKING,
  ProductionFloor.WASHING,
  ProductionFloor.BOARDING,
  ProductionFloor.FINAL_CHECKING,
  ProductionFloor.BRANDING,
  ProductionFloor.WAREHOUSE
];

/**
 * Initialize test data
 */
async function initializeTestData() {
  console.log('🚀 Initializing test data...');
  
  try {
    // Create test production order
    const order = new ProductionOrder({
      orderNumber: TEST_CONFIG.orderId,
      customerName: 'Test Customer',
      orderDate: new Date(),
      deliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      status: OrderStatus.IN_PROGRESS,
      priority: Priority.HIGH,
      totalQuantity: TEST_CONFIG.plannedQuantity,
      remarks: 'Test order for flow validation'
    });
    
    await order.save();
    console.log(`✅ Created test order: ${order._id}`);
    
    // Create test article
    const article = new Article({
      id: `ART_${Date.now()}`,
      orderId: order._id,
      articleNumber: TEST_CONFIG.articleNumber,
      plannedQuantity: TEST_CONFIG.plannedQuantity,
      linkingType: LinkingType.AUTO_LINKING,
      priority: Priority.HIGH,
      status: OrderStatus.IN_PROGRESS,
      currentFloor: ProductionFloor.KNITTING,
      remarks: 'Test article for flow validation'
    });
    
    await article.save();
    console.log(`✅ Created test article: ${article._id}`);
    
    return { order, article };
  } catch (error) {
    console.error('❌ Error initializing test data:', error.message);
    throw error;
  }
}

/**
 * Display current floor status
 */
function displayFloorStatus(article, round) {
  console.log(`\n📊 ROUND ${round} - Current Floor Status:`);
  console.log('=' .repeat(60));
  
  FLOOR_ORDER.forEach(floor => {
    const status = article.getFloorStatus(floor);
    if (status) {
      console.log(`${floor.padEnd(15)} | Received: ${status.received.toString().padStart(4)} | Completed: ${status.completed.toString().padStart(4)} | Remaining: ${status.remaining.toString().padStart(4)} | Transferred: ${status.transferred.toString().padStart(4)}`);
    }
  });
  
  console.log(`\nCurrent Floor: ${article.currentFloor}`);
  console.log(`Overall Progress: ${article.progress}%`);
  console.log('=' .repeat(60));
}

/**
 * Simulate work completion on current floor
 */
async function simulateWorkCompletion(article, quantity, remarks) {
  console.log(`\n🔨 Completing ${quantity} units on ${article.currentFloor} floor...`);
  
  try {
    const result = await article.updateCompletedQuantity(
      quantity,
      TEST_CONFIG.userId,
      TEST_CONFIG.floorSupervisorId,
      remarks,
      TEST_CONFIG.machineId,
      TEST_CONFIG.shiftId
    );
    
    console.log(`✅ Completed ${result.deltaQuantity} units (Total: ${result.newQuantity}, Remaining: ${result.remaining})`);
    return result;
  } catch (error) {
    console.error(`❌ Error completing work: ${error.message}`);
    throw error;
  }
}

/**
 * Simulate transfer to next floor
 */
async function simulateTransfer(article, quantity, remarks) {
  console.log(`\n🚚 Transferring ${quantity} units from ${article.currentFloor} to next floor...`);
  
  try {
    const result = await article.transferToNextFloor(
      quantity,
      TEST_CONFIG.userId,
      TEST_CONFIG.floorSupervisorId,
      remarks,
      `BATCH_${Date.now()}`
    );
    
    console.log(`✅ Transferred ${result.quantity} units from ${result.fromFloor} to ${result.toFloor}`);
    console.log(`   Remaining on ${result.fromFloor}: ${result.currentFloorRemaining}`);
    console.log(`   Received on ${result.toFloor}: ${result.nextFloorReceived}`);
    return result;
  } catch (error) {
    console.error(`❌ Error transferring: ${error.message}`);
    throw error;
  }
}

/**
 * ROUND 1: Initial flow with partial transfers
 */
async function executeRound1(article) {
  console.log('\n🎯 ROUND 1: Initial Flow with Partial Transfers');
  console.log('=' .repeat(80));
  
  // Step 1: Complete work on Knitting floor (1200 units)
  await simulateWorkCompletion(article, 1200, 'Completed all knitting work');
  displayFloorStatus(article, 1);
  
  // Step 2: Transfer 1100 units from Knitting to Linking
  await simulateTransfer(article, 1100, 'Transferring 1100 units to linking floor');
  displayFloorStatus(article, 1);
  
  // Step 3: Complete work on Linking floor (1100 units)
  await simulateWorkCompletion(article, 1100, 'Completed all linking work');
  displayFloorStatus(article, 1);
  
  // Step 4: Transfer 1000 units from Linking to Checking
  await simulateTransfer(article, 1000, 'Transferring 1000 units to checking floor');
  displayFloorStatus(article, 1);
  
  // Step 5: Complete work on Checking floor (1000 units)
  await simulateWorkCompletion(article, 1000, 'Completed all checking work');
  displayFloorStatus(article, 1);
  
  // Step 6: Transfer 950 units from Checking to Washing
  await simulateTransfer(article, 950, 'Transferring 950 units to washing floor');
  displayFloorStatus(article, 1);
  
  // Step 7: Complete work on Washing floor (950 units)
  await simulateWorkCompletion(article, 950, 'Completed all washing work');
  displayFloorStatus(article, 1);
  
  // Step 8: Transfer 900 units from Washing to Boarding
  await simulateTransfer(article, 900, 'Transferring 900 units to boarding floor');
  displayFloorStatus(article, 1);
  
  // Step 9: Complete work on Boarding floor (900 units)
  await simulateWorkCompletion(article, 900, 'Completed all boarding work');
  displayFloorStatus(article, 1);
  
  // Step 10: Transfer 850 units from Boarding to Final Checking
  await simulateTransfer(article, 850, 'Transferring 850 units to final checking floor');
  displayFloorStatus(article, 1);
  
  // Step 11: Complete work on Final Checking floor (850 units)
  await simulateWorkCompletion(article, 850, 'Completed all final checking work');
  displayFloorStatus(article, 1);
  
  // Step 12: Transfer 800 units from Final Checking to Branding
  await simulateTransfer(article, 800, 'Transferring 800 units to branding floor');
  displayFloorStatus(article, 1);
  
  // Step 13: Complete work on Branding floor (800 units)
  await simulateWorkCompletion(article, 800, 'Completed all branding work');
  displayFloorStatus(article, 1);
  
  // Step 14: Transfer 750 units from Branding to Warehouse
  await simulateTransfer(article, 750, 'Transferring 750 units to warehouse');
  displayFloorStatus(article, 1);
  
  // Step 15: Complete work on Warehouse floor (750 units)
  await simulateWorkCompletion(article, 750, 'Completed all warehouse work - Order finished');
  displayFloorStatus(article, 1);
  
  console.log('\n🎉 ROUND 1 COMPLETED!');
  console.log('Summary:');
  console.log('- Started with 1200 units on Knitting');
  console.log('- Successfully moved through all floors with partial transfers');
  console.log('- Final warehouse completion: 750 units');
  console.log('- Remaining quantities on various floors for Round 2');
}

/**
 * ROUND 2: Handle remaining quantities from Round 1
 */
async function executeRound2(article) {
  console.log('\n🎯 ROUND 2: Handling Remaining Quantities');
  console.log('=' .repeat(80));
  
  // Get current article state
  await article.populate('orderId');
  const freshArticle = await Article.findById(article._id);
  
  console.log('📋 Remaining quantities from Round 1:');
  FLOOR_ORDER.forEach(floor => {
    const status = freshArticle.getFloorStatus(floor);
    if (status && status.remaining > 0) {
      console.log(`   ${floor}: ${status.remaining} units remaining`);
    }
  });
  
  // Step 1: Transfer remaining 100 units from Knitting to Linking
  if (freshArticle.currentFloor === ProductionFloor.KNITTING) {
    const knittingStatus = freshArticle.getFloorStatus(ProductionFloor.KNITTING);
    if (knittingStatus.remaining > 0) {
      await simulateTransfer(freshArticle, knittingStatus.remaining, 'Transferring remaining knitting units');
    }
  }
  
  // Step 2: Complete remaining work on Linking floor
  const linkingStatus = freshArticle.getFloorStatus(ProductionFloor.LINKING);
  if (linkingStatus.remaining > 0) {
    await simulateWorkCompletion(freshArticle, linkingStatus.remaining, 'Completing remaining linking work');
  }
  
  // Step 3: Transfer remaining units from Linking to Checking
  if (freshArticle.currentFloor === ProductionFloor.LINKING) {
    const currentLinkingStatus = freshArticle.getFloorStatus(ProductionFloor.LINKING);
    if (currentLinkingStatus.remaining > 0) {
      await simulateTransfer(freshArticle, currentLinkingStatus.remaining, 'Transferring remaining linking units');
    }
  }
  
  // Step 4: Complete remaining work on Checking floor
  const checkingStatus = freshArticle.getFloorStatus(ProductionFloor.CHECKING);
  if (checkingStatus.remaining > 0) {
    await simulateWorkCompletion(freshArticle, checkingStatus.remaining, 'Completing remaining checking work');
  }
  
  // Continue with remaining floors...
  const floorsToProcess = [
    ProductionFloor.WASHING,
    ProductionFloor.BOARDING,
    ProductionFloor.FINAL_CHECKING,
    ProductionFloor.BRANDING,
    ProductionFloor.WAREHOUSE
  ];
  
  for (const floor of floorsToProcess) {
    const status = freshArticle.getFloorStatus(floor);
    if (status && status.remaining > 0) {
      // Transfer remaining units if we're on the previous floor
      if (freshArticle.currentFloor !== floor) {
        const currentStatus = freshArticle.getFloorStatus(freshArticle.currentFloor);
        if (currentStatus.remaining > 0) {
          await simulateTransfer(freshArticle, currentStatus.remaining, `Transferring remaining units to ${floor}`);
        }
      }
      
      // Complete remaining work on current floor
      if (freshArticle.currentFloor === floor) {
        await simulateWorkCompletion(freshArticle, status.remaining, `Completing remaining work on ${floor}`);
      }
    }
  }
  
  displayFloorStatus(freshArticle, 2);
  
  console.log('\n🎉 ROUND 2 COMPLETED!');
  console.log('Summary:');
  console.log('- Processed all remaining quantities from Round 1');
  console.log('- Moved through floors systematically');
  console.log('- Final status shows complete order processing');
}

/**
 * Display final summary
 */
function displayFinalSummary(article) {
  console.log('\n📈 FINAL ORDER FLOW SUMMARY');
  console.log('=' .repeat(80));
  
  const allStatuses = article.getAllFloorStatuses();
  let totalReceived = 0;
  let totalCompleted = 0;
  let totalTransferred = 0;
  let totalRemaining = 0;
  
  allStatuses.forEach(status => {
    totalReceived += status.received;
    totalCompleted += status.completed;
    totalTransferred += status.transferred;
    totalRemaining += status.remaining;
    
    console.log(`${status.floor.padEnd(15)} | R:${status.received.toString().padStart(4)} | C:${status.completed.toString().padStart(4)} | T:${status.transferred.toString().padStart(4)} | Rem:${status.remaining.toString().padStart(4)} | Rate:${status.completionRate}%`);
  });
  
  console.log('=' .repeat(80));
  console.log(`TOTALS: Received: ${totalReceived} | Completed: ${totalCompleted} | Transferred: ${totalTransferred} | Remaining: ${totalRemaining}`);
  console.log(`Planned Quantity: ${article.plannedQuantity}`);
  console.log(`Overall Progress: ${article.progress}%`);
  console.log(`Current Floor: ${article.currentFloor}`);
  console.log(`Order Status: ${article.status}`);
  
  // Validation
  console.log('\n🔍 VALIDATION:');
  if (totalReceived === article.plannedQuantity) {
    console.log('✅ Total received matches planned quantity');
  } else {
    console.log('❌ Total received does not match planned quantity');
  }
  
  if (totalRemaining === 0) {
    console.log('✅ All quantities have been processed');
  } else {
    console.log('❌ Some quantities remain unprocessed');
  }
  
  if (article.currentFloor === ProductionFloor.WAREHOUSE && article.progress === 100) {
    console.log('✅ Order successfully completed and moved to warehouse');
  } else {
    console.log('❌ Order not fully completed or not in warehouse');
  }
}

/**
 * Main test execution
 */
async function runOrderFlowTest() {
  console.log('🧪 ORDER FLOW TEST SCRIPT');
  console.log('=' .repeat(80));
  console.log('Testing complete production flow with quantity movements');
  console.log('Planned Quantity:', TEST_CONFIG.plannedQuantity);
  console.log('=' .repeat(80));
  
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/addon_production');
    console.log('✅ Connected to MongoDB');
    
    // Initialize test data
    const { order, article } = await initializeTestData();
    
    // Execute Round 1
    await executeRound1(article);
    
    // Wait a moment between rounds
    console.log('\n⏳ Waiting 2 seconds before Round 2...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Execute Round 2
    await executeRound2(article);
    
    // Display final summary
    const finalArticle = await Article.findById(article._id);
    displayFinalSummary(finalArticle);
    
    console.log('\n🎉 ORDER FLOW TEST COMPLETED SUCCESSFULLY!');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    // Cleanup
    try {
      await Article.deleteMany({ articleNumber: TEST_CONFIG.articleNumber });
      await ProductionOrder.deleteMany({ orderNumber: TEST_CONFIG.orderId });
      console.log('\n🧹 Test data cleaned up');
    } catch (cleanupError) {
      console.error('⚠️ Cleanup error:', cleanupError.message);
    }
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

// Run the test
runOrderFlowTest().catch(console.error);
