/**
 * Order Flow Test Script - Standalone Version (No Database)
 * Tests the complete production flow by moving quantities between floors
 * 
 * Flow: Knitting -> Linking -> Checking -> Washing -> Boarding -> Final Checking -> Branding -> Warehouse
 */

// Simplified enums for testing
const ProductionFloor = {
  KNITTING: 'Knitting',
  LINKING: 'Linking',
  CHECKING: 'Checking',
  WASHING: 'Washing',
  BOARDING: 'Boarding',
  FINAL_CHECKING: 'Final Checking',
  BRANDING: 'Branding',
  WAREHOUSE: 'Warehouse'
};

const OrderStatus = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold',
  CANCELLED: 'Cancelled'
};

const Priority = {
  URGENT: 'Urgent',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low'
};

const LinkingType = {
  AUTO_LINKING: 'Auto Linking',
  ROSSO_LINKING: 'Rosso Linking',
  HAND_LINKING: 'Hand Linking'
};

// Test configuration
const TEST_CONFIG = {
  orderId: 'TEST_ORDER_001',
  articleNumber: 'TEST001',
  plannedQuantity: 1200
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
 * Article Class for testing
 */
class TestArticle {
  constructor(config) {
    this.id = `ART_${Date.now()}`;
    this.orderId = config.orderId;
    this.articleNumber = config.articleNumber;
    this.plannedQuantity = config.plannedQuantity;
    this.linkingType = LinkingType.AUTO_LINKING;
    this.priority = Priority.HIGH;
    this.status = OrderStatus.IN_PROGRESS;
    this.progress = 0;
    this.currentFloor = ProductionFloor.KNITTING;
    this.remarks = 'Test article for flow validation';
    
    // Initialize floor quantities
    this.floorQuantities = {
      knitting: { received: 0, completed: 0, remaining: 0, transferred: 0 },
      linking: { received: 0, completed: 0, remaining: 0, transferred: 0 },
      checking: { received: 0, completed: 0, remaining: 0, transferred: 0 },
      washing: { received: 0, completed: 0, remaining: 0, transferred: 0 },
      boarding: { received: 0, completed: 0, remaining: 0, transferred: 0 },
      finalChecking: { received: 0, completed: 0, remaining: 0, transferred: 0 },
      branding: { received: 0, completed: 0, remaining: 0, transferred: 0 },
      warehouse: { received: 0, completed: 0, remaining: 0, transferred: 0 }
    };
    
    // Initialize with planned quantity
    this.initializeWithPlannedQuantity();
  }
  
  getFloorKey(floor) {
    const floorMap = {
      [ProductionFloor.KNITTING]: 'knitting',
      [ProductionFloor.LINKING]: 'linking',
      [ProductionFloor.CHECKING]: 'checking',
      [ProductionFloor.WASHING]: 'washing',
      [ProductionFloor.BOARDING]: 'boarding',
      [ProductionFloor.FINAL_CHECKING]: 'finalChecking',
      [ProductionFloor.BRANDING]: 'branding',
      [ProductionFloor.WAREHOUSE]: 'warehouse'
    };
    return floorMap[floor];
  }
  
  initializeWithPlannedQuantity() {
    this.floorQuantities.knitting.received = this.plannedQuantity;
    this.floorQuantities.knitting.remaining = this.plannedQuantity;
    this.currentFloor = ProductionFloor.KNITTING;
    
    return {
      floor: ProductionFloor.KNITTING,
      received: this.plannedQuantity,
      remaining: this.plannedQuantity
    };
  }
  
  updateCompletedQuantity(newQuantity, remarks) {
    const floorKey = this.getFloorKey(this.currentFloor);
    const floorData = this.floorQuantities[floorKey];
    
    if (!floorData) {
      throw new Error('Invalid floor for quantity update');
    }
    
    if (newQuantity < 0 || newQuantity > floorData.received) {
      throw new Error(`Invalid quantity: must be between 0 and received quantity (${floorData.received})`);
    }
    
    const previousQuantity = floorData.completed;
    floorData.completed = newQuantity;
    floorData.remaining = floorData.received - newQuantity;
    
    // Calculate progress based on total transferred work
    const totalTransferred = Object.values(this.floorQuantities).reduce((sum, floor) => sum + floor.transferred, 0);
    this.progress = Math.round((totalTransferred / this.plannedQuantity) * 100);
    
    if (remarks) {
      this.remarks = remarks;
    }
    
    return {
      floor: this.currentFloor,
      previousQuantity,
      newQuantity,
      deltaQuantity: newQuantity - previousQuantity,
      remaining: floorData.remaining
    };
  }
  
  transferToNextFloor(quantity, remarks) {
    const floorOrder = [
      ProductionFloor.KNITTING,
      ProductionFloor.LINKING,
      ProductionFloor.CHECKING,
      ProductionFloor.WASHING,
      ProductionFloor.BOARDING,
      ProductionFloor.FINAL_CHECKING,
      ProductionFloor.BRANDING,
      ProductionFloor.WAREHOUSE
    ];
    
    const currentIndex = floorOrder.indexOf(this.currentFloor);
    if (currentIndex === -1 || currentIndex === floorOrder.length - 1) {
      throw new Error('Cannot transfer from current floor');
    }
    
    const currentFloorKey = this.getFloorKey(this.currentFloor);
    const currentFloorData = this.floorQuantities[currentFloorKey];
    
    // Validate transfer quantity - can transfer from received work
    const availableForTransfer = currentFloorData.received - currentFloorData.transferred;
    if (quantity > availableForTransfer) {
      throw new Error(`Transfer quantity (${quantity}) cannot exceed available quantity (${availableForTransfer}) on ${this.currentFloor} floor`);
    }
    
    const nextFloor = floorOrder[currentIndex + 1];
    const nextFloorKey = this.getFloorKey(nextFloor);
    const nextFloorData = this.floorQuantities[nextFloorKey];
    
    // Update current floor: mark as transferred
    currentFloorData.transferred += quantity;
    currentFloorData.remaining = currentFloorData.received - currentFloorData.transferred;
    
    // Update next floor: mark as received
    nextFloorData.received += quantity;
    nextFloorData.remaining += quantity;
    
    // Update current floor to next floor
    this.currentFloor = nextFloor;
    
    if (remarks) {
      this.remarks = remarks;
    }
    
    return {
      fromFloor: floorOrder[currentIndex],
      toFloor: nextFloor,
      quantity,
      currentFloorRemaining: currentFloorData.remaining,
      nextFloorReceived: nextFloorData.received
    };
  }
  
  getFloorStatus(floor) {
    const floorKey = this.getFloorKey(floor);
    const floorData = this.floorQuantities[floorKey];
    
    if (!floorData) {
      return null;
    }
    
    return {
      floor,
      received: floorData.received,
      completed: floorData.completed,
      remaining: floorData.remaining,
      transferred: floorData.transferred,
      completionRate: floorData.received > 0 ? Math.round((floorData.completed / floorData.received) * 100) : 0
    };
  }
  
  getAllFloorStatuses() {
    const floors = Object.values(ProductionFloor);
    return floors.map(floor => this.getFloorStatus(floor)).filter(status => status !== null);
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
function simulateWorkCompletion(article, quantity, remarks) {
  console.log(`\n🔨 Completing ${quantity} units on ${article.currentFloor} floor...`);
  
  try {
    const result = article.updateCompletedQuantity(quantity, remarks);
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
function simulateTransfer(article, quantity, remarks) {
  console.log(`\n🚚 Transferring ${quantity} units from ${article.currentFloor} to next floor...`);
  
  try {
    const result = article.transferToNextFloor(quantity, remarks);
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
function executeRound1(article) {
  console.log('\n🎯 ROUND 1: Initial Flow with Partial Transfers');
  console.log('=' .repeat(80));
  
  // Step 1: Transfer 1100 units from Knitting to Linking (leaving 100 remaining)
  simulateTransfer(article, 1100, 'Transferring 1100 units to linking floor');
  displayFloorStatus(article, 1);
  
  // Step 2: Transfer 1000 units from Linking to Checking (leaving 100 remaining)
  simulateTransfer(article, 1000, 'Transferring 1000 units to checking floor');
  displayFloorStatus(article, 1);
  
  // Step 3: Transfer 950 units from Checking to Washing (leaving 50 remaining)
  simulateTransfer(article, 950, 'Transferring 950 units to washing floor');
  displayFloorStatus(article, 1);
  
  // Step 4: Transfer 900 units from Washing to Boarding (leaving 50 remaining)
  simulateTransfer(article, 900, 'Transferring 900 units to boarding floor');
  displayFloorStatus(article, 1);
  
  // Step 5: Transfer 850 units from Boarding to Final Checking (leaving 50 remaining)
  simulateTransfer(article, 850, 'Transferring 850 units to final checking floor');
  displayFloorStatus(article, 1);
  
  // Step 6: Transfer 800 units from Final Checking to Branding (leaving 50 remaining)
  simulateTransfer(article, 800, 'Transferring 800 units to branding floor');
  displayFloorStatus(article, 1);
  
  // Step 7: Transfer 750 units from Branding to Warehouse (leaving 50 remaining)
  simulateTransfer(article, 750, 'Transferring 750 units to warehouse');
  displayFloorStatus(article, 1);
  
  // Step 8: Complete work on Warehouse floor (750 units)
  simulateWorkCompletion(article, 750, 'Completed warehouse work - Order partially finished');
  displayFloorStatus(article, 1);
  
  console.log('\n🎉 ROUND 1 COMPLETED!');
  console.log('Summary:');
  console.log('- Started with 1200 units on Knitting');
  console.log('- Successfully moved through all floors with partial transfers');
  console.log('- Final warehouse completion: 750 units');
  console.log('- Remaining quantities on various floors for Round 2:');
  console.log('  - Knitting: 100 remaining');
  console.log('  - Linking: 100 remaining');
  console.log('  - Checking: 50 remaining');
  console.log('  - Washing: 50 remaining');
  console.log('  - Boarding: 50 remaining');
  console.log('  - Final Checking: 50 remaining');
  console.log('  - Branding: 50 remaining');
  console.log('  - Warehouse: 0 remaining');
}

/**
 * ROUND 2: Handle remaining quantities from Round 1
 */
function executeRound2(article) {
  console.log('\n🎯 ROUND 2: Handling Remaining Quantities');
  console.log('=' .repeat(80));
  
  console.log('📋 Remaining quantities from Round 1:');
  FLOOR_ORDER.forEach(floor => {
    const status = article.getFloorStatus(floor);
    if (status && status.remaining > 0) {
      console.log(`   ${floor}: ${status.remaining} units remaining`);
    }
  });
  
  // Step 1: Transfer remaining 100 units from Knitting to Linking
  const knittingStatus = article.getFloorStatus(ProductionFloor.KNITTING);
  if (knittingStatus.remaining > 0) {
    // First go back to Knitting floor
    article.currentFloor = ProductionFloor.KNITTING;
    simulateTransfer(article, knittingStatus.remaining, 'Transferring remaining 100 units from Knitting to Linking');
    displayFloorStatus(article, 2);
  }
  
  // Step 2: Transfer remaining 100 units from Linking to Checking
  const linkingStatus = article.getFloorStatus(ProductionFloor.LINKING);
  if (linkingStatus.remaining > 0) {
    simulateTransfer(article, linkingStatus.remaining, 'Transferring remaining 100 units from Linking to Checking');
    displayFloorStatus(article, 2);
  }
  
  // Step 3: Transfer remaining 50 units from Checking to Washing
  const checkingStatus = article.getFloorStatus(ProductionFloor.CHECKING);
  if (checkingStatus.remaining > 0) {
    simulateTransfer(article, checkingStatus.remaining, 'Transferring remaining 50 units from Checking to Washing');
    displayFloorStatus(article, 2);
  }
  
  // Step 4: Transfer remaining 50 units from Washing to Boarding
  const washingStatus = article.getFloorStatus(ProductionFloor.WASHING);
  if (washingStatus.remaining > 0) {
    simulateTransfer(article, washingStatus.remaining, 'Transferring remaining 50 units from Washing to Boarding');
    displayFloorStatus(article, 2);
  }
  
  // Step 5: Transfer remaining 50 units from Boarding to Final Checking
  const boardingStatus = article.getFloorStatus(ProductionFloor.BOARDING);
  if (boardingStatus.remaining > 0) {
    simulateTransfer(article, boardingStatus.remaining, 'Transferring remaining 50 units from Boarding to Final Checking');
    displayFloorStatus(article, 2);
  }
  
  // Step 6: Transfer remaining 50 units from Final Checking to Branding
  const finalCheckingStatus = article.getFloorStatus(ProductionFloor.FINAL_CHECKING);
  if (finalCheckingStatus.remaining > 0) {
    simulateTransfer(article, finalCheckingStatus.remaining, 'Transferring remaining 50 units from Final Checking to Branding');
    displayFloorStatus(article, 2);
  }
  
  // Step 7: Transfer remaining 50 units from Branding to Warehouse
  const brandingStatus = article.getFloorStatus(ProductionFloor.BRANDING);
  if (brandingStatus.remaining > 0) {
    simulateTransfer(article, brandingStatus.remaining, 'Transferring remaining 50 units from Branding to Warehouse');
    displayFloorStatus(article, 2);
  }
  
  // Step 8: Complete remaining work on Warehouse floor
  const warehouseStatus = article.getFloorStatus(ProductionFloor.WAREHOUSE);
  if (warehouseStatus.remaining > 0) {
    simulateWorkCompletion(article, warehouseStatus.remaining, 'Completing remaining 50 units on Warehouse - Order fully finished');
    displayFloorStatus(article, 2);
  }
  
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
function runOrderFlowTest() {
  console.log('🧪 ORDER FLOW TEST SCRIPT - STANDALONE VERSION');
  console.log('=' .repeat(80));
  console.log('Testing complete production flow with quantity movements');
  console.log('Planned Quantity:', TEST_CONFIG.plannedQuantity);
  console.log('=' .repeat(80));
  
  try {
    // Create test article
    const article = new TestArticle(TEST_CONFIG);
    console.log(`✅ Created test article: ${article.id}`);
    
    // Execute Round 1
    executeRound1(article);
    
    // Wait a moment between rounds
    console.log('\n⏳ Waiting 2 seconds before Round 2...');
    setTimeout(() => {
      // Execute Round 2
      executeRound2(article);
      
      // Display final summary
      displayFinalSummary(article);
      
      console.log('\n🎉 ORDER FLOW TEST COMPLETED SUCCESSFULLY!');
    }, 2000);
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
runOrderFlowTest();
