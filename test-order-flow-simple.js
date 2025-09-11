/**
 * Order Flow Test Script - Simplified Version
 * Tests the complete production flow by moving quantities between floors
 * 
 * Flow: Knitting -> Linking -> Checking -> Washing -> Boarding -> Final Checking -> Branding -> Warehouse
 */

import mongoose from 'mongoose';

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

// Simplified Article Schema for testing
const articleSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  articleNumber: { type: String, required: true },
  plannedQuantity: { type: Number, required: true, min: 1 },
  linkingType: { type: String, required: true, enum: Object.values(LinkingType) },
  priority: { type: String, required: true, enum: Object.values(Priority) },
  status: { type: String, required: true, enum: Object.values(OrderStatus), default: OrderStatus.PENDING },
  progress: { type: Number, required: true, default: 0, min: 0 },
  currentFloor: { type: String, required: true, enum: Object.values(ProductionFloor), default: ProductionFloor.KNITTING },
  remarks: { type: String, required: false },
  
  // Floor-specific tracking
  floorQuantities: {
    knitting: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 }
    },
    linking: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 }
    },
    checking: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 }
    },
    washing: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 }
    },
    boarding: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 }
    },
    finalChecking: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 }
    },
    branding: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 }
    },
    warehouse: {
      received: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      remaining: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 }
    }
  }
}, {
  timestamps: true,
  collection: 'test_articles'
});

// Helper method to get floor key from ProductionFloor enum
articleSchema.methods.getFloorKey = function(floor) {
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
};

// Method to update completed quantity for current floor
articleSchema.methods.updateCompletedQuantity = function(newQuantity, remarks) {
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
  
  // Calculate progress
  const totalCompleted = Object.values(this.floorQuantities).reduce((sum, floor) => sum + floor.completed, 0);
  this.progress = Math.round((totalCompleted / this.plannedQuantity) * 100);
  
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
};

// Method to transfer to next floor
articleSchema.methods.transferToNextFloor = function(quantity, remarks) {
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
  
  // Validate transfer quantity
  if (quantity > currentFloorData.completed) {
    throw new Error(`Transfer quantity (${quantity}) cannot exceed completed quantity (${currentFloorData.completed}) on ${this.currentFloor} floor`);
  }
  
  if (quantity > currentFloorData.remaining) {
    throw new Error(`Transfer quantity (${quantity}) cannot exceed remaining quantity (${currentFloorData.remaining}) on ${this.currentFloor} floor`);
  }
  
  const nextFloor = floorOrder[currentIndex + 1];
  const nextFloorKey = this.getFloorKey(nextFloor);
  const nextFloorData = this.floorQuantities[nextFloorKey];
  
  // Update current floor: mark as transferred
  currentFloorData.transferred += quantity;
  currentFloorData.remaining -= quantity;
  
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
};

// Method to get floor status
articleSchema.methods.getFloorStatus = function(floor) {
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
};

// Method to get all floor statuses
articleSchema.methods.getAllFloorStatuses = function() {
  const floors = Object.values(ProductionFloor);
  return floors.map(floor => this.getFloorStatus(floor)).filter(status => status !== null);
};

// Method to initialize with planned quantity
articleSchema.methods.initializeWithPlannedQuantity = function() {
  this.floorQuantities.knitting.received = this.plannedQuantity;
  this.floorQuantities.knitting.remaining = this.plannedQuantity;
  this.currentFloor = ProductionFloor.KNITTING;
  
  return {
    floor: ProductionFloor.KNITTING,
    received: this.plannedQuantity,
    remaining: this.plannedQuantity
  };
};

const Article = mongoose.model('TestArticle', articleSchema);

// Test configuration
const TEST_CONFIG = {
  orderId: new mongoose.Types.ObjectId(),
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
  
  // Step 1: Complete work on Knitting floor (1200 units)
  simulateWorkCompletion(article, 1200, 'Completed all knitting work');
  displayFloorStatus(article, 1);
  
  // Step 2: Transfer 1100 units from Knitting to Linking
  simulateTransfer(article, 1100, 'Transferring 1100 units to linking floor');
  displayFloorStatus(article, 1);
  
  // Step 3: Complete work on Linking floor (1100 units)
  simulateWorkCompletion(article, 1100, 'Completed all linking work');
  displayFloorStatus(article, 1);
  
  // Step 4: Transfer 1000 units from Linking to Checking
  simulateTransfer(article, 1000, 'Transferring 1000 units to checking floor');
  displayFloorStatus(article, 1);
  
  // Step 5: Complete work on Checking floor (1000 units)
  simulateWorkCompletion(article, 1000, 'Completed all checking work');
  displayFloorStatus(article, 1);
  
  // Step 6: Transfer 950 units from Checking to Washing
  simulateTransfer(article, 950, 'Transferring 950 units to washing floor');
  displayFloorStatus(article, 1);
  
  // Step 7: Complete work on Washing floor (950 units)
  simulateWorkCompletion(article, 950, 'Completed all washing work');
  displayFloorStatus(article, 1);
  
  // Step 8: Transfer 900 units from Washing to Boarding
  simulateTransfer(article, 900, 'Transferring 900 units to boarding floor');
  displayFloorStatus(article, 1);
  
  // Step 9: Complete work on Boarding floor (900 units)
  simulateWorkCompletion(article, 900, 'Completed all boarding work');
  displayFloorStatus(article, 1);
  
  // Step 10: Transfer 850 units from Boarding to Final Checking
  simulateTransfer(article, 850, 'Transferring 850 units to final checking floor');
  displayFloorStatus(article, 1);
  
  // Step 11: Complete work on Final Checking floor (850 units)
  simulateWorkCompletion(article, 850, 'Completed all final checking work');
  displayFloorStatus(article, 1);
  
  // Step 12: Transfer 800 units from Final Checking to Branding
  simulateTransfer(article, 800, 'Transferring 800 units to branding floor');
  displayFloorStatus(article, 1);
  
  // Step 13: Complete work on Branding floor (800 units)
  simulateWorkCompletion(article, 800, 'Completed all branding work');
  displayFloorStatus(article, 1);
  
  // Step 14: Transfer 750 units from Branding to Warehouse
  simulateTransfer(article, 750, 'Transferring 750 units to warehouse');
  displayFloorStatus(article, 1);
  
  // Step 15: Complete work on Warehouse floor (750 units)
  simulateWorkCompletion(article, 750, 'Completed all warehouse work - Order finished');
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
  if (article.currentFloor === ProductionFloor.KNITTING) {
    const knittingStatus = article.getFloorStatus(ProductionFloor.KNITTING);
    if (knittingStatus.remaining > 0) {
      simulateTransfer(article, knittingStatus.remaining, 'Transferring remaining knitting units');
    }
  }
  
  // Step 2: Complete remaining work on Linking floor
  const linkingStatus = article.getFloorStatus(ProductionFloor.LINKING);
  if (linkingStatus.remaining > 0) {
    simulateWorkCompletion(article, linkingStatus.remaining, 'Completing remaining linking work');
  }
  
  // Step 3: Transfer remaining units from Linking to Checking
  if (article.currentFloor === ProductionFloor.LINKING) {
    const currentLinkingStatus = article.getFloorStatus(ProductionFloor.LINKING);
    if (currentLinkingStatus.remaining > 0) {
      simulateTransfer(article, currentLinkingStatus.remaining, 'Transferring remaining linking units');
    }
  }
  
  // Step 4: Complete remaining work on Checking floor
  const checkingStatus = article.getFloorStatus(ProductionFloor.CHECKING);
  if (checkingStatus.remaining > 0) {
    simulateWorkCompletion(article, checkingStatus.remaining, 'Completing remaining checking work');
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
    const status = article.getFloorStatus(floor);
    if (status && status.remaining > 0) {
      // Transfer remaining units if we're on the previous floor
      if (article.currentFloor !== floor) {
        const currentStatus = article.getFloorStatus(article.currentFloor);
        if (currentStatus.remaining > 0) {
          simulateTransfer(article, currentStatus.remaining, `Transferring remaining units to ${floor}`);
        }
      }
      
      // Complete remaining work on current floor
      if (article.currentFloor === floor) {
        simulateWorkCompletion(article, status.remaining, `Completing remaining work on ${floor}`);
      }
    }
  }
  
  displayFloorStatus(article, 2);
  
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
  console.log('🧪 ORDER FLOW TEST SCRIPT - SIMPLIFIED VERSION');
  console.log('=' .repeat(80));
  console.log('Testing complete production flow with quantity movements');
  console.log('Planned Quantity:', TEST_CONFIG.plannedQuantity);
  console.log('=' .repeat(80));
  
  try {
    // Connect to MongoDB (using a simple connection for testing)
    await mongoose.connect('mongodb://localhost:27017/addon_production_test');
    console.log('✅ Connected to MongoDB');
    
    // Create test article
    const article = new Article({
      id: `ART_${Date.now()}`,
      orderId: TEST_CONFIG.orderId,
      articleNumber: TEST_CONFIG.articleNumber,
      plannedQuantity: TEST_CONFIG.plannedQuantity,
      linkingType: LinkingType.AUTO_LINKING,
      priority: Priority.HIGH,
      status: OrderStatus.IN_PROGRESS,
      currentFloor: ProductionFloor.KNITTING,
      remarks: 'Test article for flow validation'
    });
    
    // Initialize with planned quantity
    article.initializeWithPlannedQuantity();
    console.log(`✅ Created test article: ${article._id}`);
    
    // Execute Round 1
    executeRound1(article);
    
    // Wait a moment between rounds
    console.log('\n⏳ Waiting 2 seconds before Round 2...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Execute Round 2
    executeRound2(article);
    
    // Display final summary
    displayFinalSummary(article);
    
    console.log('\n🎉 ORDER FLOW TEST COMPLETED SUCCESSFULLY!');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    // Cleanup
    try {
      await Article.deleteMany({ articleNumber: TEST_CONFIG.articleNumber });
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
