/**
 * Comprehensive Logging Example
 * Shows exactly how logs are created for every production action
 */

const { Article, ProductionFloor } = require('./index');
const ProductionLoggingService = require('../../services/production/logging.service');

async function demonstrateComprehensiveLogging() {
  console.log('🚀 Starting Comprehensive Production Logging Demo\n');
  
  // Create article with order ID
  const article = new Article({
    id: 'ART-001',
    articleNumber: 'ART001',
    orderId: 'ORD-001', // Important for logging
    plannedQuantity: 1000,
    linkingType: 'Auto Linking',
    priority: 'High'
  });
  
  await article.save();
  console.log('✅ Article ART001 created with 1000 planned quantity');
  
  // 1. KNITTING FLOOR - Complete 750 units
  console.log('\n🏭 KNITTING FLOOR');
  console.log('================');
  
  await article.updateCompletedQuantity(750, 'user123', 'supervisor456', 'Knitting completed 750 units', 'MACHINE-KNIT-001', 'SHIFT-A');
  await article.save();
  
  console.log('✅ Knitting: 750 completed, 250 remaining');
  console.log('Floor status:', article.getFloorStatus(ProductionFloor.KNITTING));
  
  // 2. TRANSFER 750 from Knitting to Linking
  console.log('\n🔄 TRANSFER: Knitting → Linking');
  console.log('===============================');
  
  await article.transferToNextFloor(750, 'user123', 'supervisor456', '750 units transferred to Linking floor', 'BATCH-2024-001');
  await article.save();
  
  console.log('✅ Transferred 750 from Knitting to Linking');
  console.log('Knitting remaining:', article.getFloorStatus(ProductionFloor.KNITTING).remaining);
  console.log('Linking received:', article.getFloorStatus(ProductionFloor.LINKING).received);
  
  // 3. LINKING FLOOR - Complete 200 units
  console.log('\n🏭 LINKING FLOOR');
  console.log('===============');
  
  await article.updateCompletedQuantity(200, 'user123', 'supervisor456', 'Linking completed 200 units', 'MACHINE-LINK-001', 'SHIFT-A');
  await article.save();
  
  console.log('✅ Linking: 200 completed, 550 remaining');
  console.log('Floor status:', article.getFloorStatus(ProductionFloor.LINKING));
  
  // 4. TRANSFER 200 from Linking to Checking
  console.log('\n🔄 TRANSFER: Linking → Checking');
  console.log('===============================');
  
  await article.transferToNextFloor(200, 'user123', 'supervisor456', '200 units transferred to Checking floor', 'BATCH-2024-002');
  await article.save();
  
  console.log('✅ Transferred 200 from Linking to Checking');
  console.log('Linking remaining:', article.getFloorStatus(ProductionFloor.LINKING).remaining);
  console.log('Checking received:', article.getFloorStatus(ProductionFloor.CHECKING).received);
  
  // 5. CHECKING FLOOR - Complete 100 units
  console.log('\n🏭 CHECKING FLOOR');
  console.log('================');
  
  await article.updateCompletedQuantity(100, 'user123', 'supervisor456', 'Checking completed 100 units', 'MACHINE-CHECK-001', 'SHIFT-A');
  await article.save();
  
  console.log('✅ Checking: 100 completed, 100 remaining');
  console.log('Floor status:', article.getFloorStatus(ProductionFloor.CHECKING));
  
  // 6. TRANSFER 100 from Checking to Washing
  console.log('\n🔄 TRANSFER: Checking → Washing');
  console.log('===============================');
  
  await article.transferToNextFloor(100, 'user123', 'supervisor456', '100 units transferred to Washing floor', 'BATCH-2024-003');
  await article.save();
  
  console.log('✅ Transferred 100 from Checking to Washing');
  console.log('Checking remaining:', article.getFloorStatus(ProductionFloor.CHECKING).remaining);
  console.log('Washing received:', article.getFloorStatus(ProductionFloor.WASHING).received);
  
  // 7. Show comprehensive logs
  console.log('\n📝 COMPREHENSIVE LOGS');
  console.log('====================');
  
  try {
    const logs = await ProductionLoggingService.getArticleLogs(article.id, { limit: 20 });
    
    console.log(`\nFound ${logs.length} log entries for Article ${article.articleNumber}:\n`);
    
    logs.forEach((log, index) => {
      console.log(`${index + 1}. [${log.timestamp.toISOString()}] ${log.action}`);
      console.log(`   📄 Remarks: ${log.remarks}`);
      
      if (log.fromFloor && log.toFloor) {
        console.log(`   🔄 Transfer: ${log.quantity} units from ${log.fromFloor} to ${log.toFloor}`);
      }
      
      if (log.previousValue !== undefined && log.newValue !== undefined) {
        console.log(`   📊 Change: ${log.previousValue} → ${log.newValue}`);
      }
      
      if (log.quantity > 0) {
        console.log(`   📦 Quantity: ${log.quantity} units`);
      }
      
      if (log.machineId) {
        console.log(`   🏭 Machine: ${log.machineId}`);
      }
      
      if (log.shiftId) {
        console.log(`   ⏰ Shift: ${log.shiftId}`);
      }
      
      if (log.batchNumber) {
        console.log(`   🏷️  Batch: ${log.batchNumber}`);
      }
      
      console.log(`   👤 User: ${log.userId} | Supervisor: ${log.floorSupervisorId}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('Error fetching logs:', error);
  }
  
  // 8. Show floor-by-floor summary
  console.log('\n📊 FLOOR-BY-FLOOR SUMMARY');
  console.log('========================');
  
  const allStatuses = article.getAllFloorStatuses();
  allStatuses.forEach(status => {
    if (status.received > 0 || status.completed > 0 || status.transferred > 0) {
      console.log(`\n${status.floor}:`);
      console.log(`  📥 Received: ${status.received} units`);
      console.log(`  ✅ Completed: ${status.completed} units`);
      console.log(`  📤 Transferred: ${status.transferred} units`);
      console.log(`  ⏳ Remaining: ${status.remaining} units`);
      console.log(`  📈 Completion Rate: ${status.completionRate}%`);
    }
  });
  
  // 9. Show order-level logs
  console.log('\n📋 ORDER-LEVEL LOGS');
  console.log('==================');
  
  try {
    const orderLogs = await ProductionLoggingService.getOrderLogs(article.orderId, { limit: 10 });
    
    console.log(`\nFound ${orderLogs.length} log entries for Order ${article.orderId}:\n`);
    
    orderLogs.forEach((log, index) => {
      console.log(`${index + 1}. [${log.timestamp.toISOString()}] ${log.action}`);
      console.log(`   📄 Remarks: ${log.remarks}`);
      if (log.articleId) {
        console.log(`   📦 Article: ${log.articleId}`);
      }
      console.log('');
    });
    
  } catch (error) {
    console.error('Error fetching order logs:', error);
  }
  
  console.log('\n🎉 Comprehensive Logging Demo Complete!');
  console.log('Every action has been logged with complete traceability.');
}

// Export for testing
module.exports = { demonstrateComprehensiveLogging };

// Run example if called directly
if (require.main === module) {
  demonstrateComprehensiveLogging().catch(console.error);
}
