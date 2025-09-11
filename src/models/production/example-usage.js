/**
 * Example Usage of Updated Article Model
 * Demonstrates the 8-floor production flow with proper quantity tracking
 */

const { Article, ProductionFloor } = require('./index');
const ProductionLoggingService = require('../../services/production/logging.service');

// Example: Your scenario
// 1000 quantity → Knitting: 750 completed, 250 remaining → 750 transferred to Linking
// Linking: 750 received, 200 completed, 550 remaining → 200 transferred to Checking
// Checking: 200 received, 100 completed, 100 remaining → 100 transferred to Washing

async function demonstrateProductionFlow() {
  // 1. Create article with 1000 planned quantity
  const article = new Article({
    id: 'ART-001',
    articleNumber: 'ART001',
    plannedQuantity: 1000,
    linkingType: 'Auto Linking',
    priority: 'High'
  });
  
  await article.save();
  console.log('✅ Article created with 1000 planned quantity');
  console.log('Initial floor status:', article.getFloorStatus(ProductionFloor.KNITTING));
  
  // 2. Knitting floor: Complete 750 units
  article.updateCompletedQuantity(750, 'user123', 'supervisor456', 'Knitting completed 750 units');
  await article.save();
  console.log('\n✅ Knitting: 750 completed');
  console.log('Knitting status:', article.getFloorStatus(ProductionFloor.KNITTING));
  
  // 3. Transfer 750 from Knitting to Linking
  article.transferToNextFloor(750, 'user123', 'supervisor456', '750 units transferred to Linking');
  await article.save();
  console.log('\n✅ Transferred 750 from Knitting to Linking');
  console.log('Knitting status after transfer:', article.getFloorStatus(ProductionFloor.KNITTING));
  console.log('Linking status after transfer:', article.getFloorStatus(ProductionFloor.LINKING));
  
  // 4. Linking floor: Complete 200 units
  article.updateCompletedQuantity(200, 'user123', 'supervisor456', 'Linking completed 200 units');
  await article.save();
  console.log('\n✅ Linking: 200 completed');
  console.log('Linking status:', article.getFloorStatus(ProductionFloor.LINKING));
  
  // 5. Transfer 200 from Linking to Checking
  article.transferToNextFloor(200, 'user123', 'supervisor456', '200 units transferred to Checking');
  await article.save();
  console.log('\n✅ Transferred 200 from Linking to Checking');
  console.log('Linking status after transfer:', article.getFloorStatus(ProductionFloor.LINKING));
  console.log('Checking status after transfer:', article.getFloorStatus(ProductionFloor.CHECKING));
  
  // 6. Checking floor: Complete 100 units
  article.updateCompletedQuantity(100, 'user123', 'supervisor456', 'Checking completed 100 units');
  await article.save();
  console.log('\n✅ Checking: 100 completed');
  console.log('Checking status:', article.getFloorStatus(ProductionFloor.CHECKING));
  
  // 7. Transfer 100 from Checking to Washing
  article.transferToNextFloor(100, 'user123', 'supervisor456', '100 units transferred to Washing');
  await article.save();
  console.log('\n✅ Transferred 100 from Checking to Washing');
  console.log('Checking status after transfer:', article.getFloorStatus(ProductionFloor.CHECKING));
  console.log('Washing status after transfer:', article.getFloorStatus(ProductionFloor.WASHING));
  
  // 8. Show overall status
  console.log('\n📊 Overall Article Status:');
  console.log('Current floor:', article.currentFloor);
  console.log('Total completed:', article.completedQuantity);
  console.log('Overall progress:', article.progress + '%');
  
  // 9. Show all floor statuses
  console.log('\n📋 All Floor Statuses:');
  const allStatuses = article.getAllFloorStatuses();
  allStatuses.forEach(status => {
    console.log(`${status.floor}: Received=${status.received}, Completed=${status.completed}, Remaining=${status.remaining}, Transferred=${status.transferred}, Rate=${status.completionRate}%`);
  });
  
  // 10. Show logs for this article
  console.log('\n📝 Article Logs:');
  try {
    const logs = await ProductionLoggingService.getArticleLogs(article.id, { limit: 10 });
    logs.forEach(log => {
      console.log(`[${log.timestamp.toISOString()}] ${log.action}: ${log.remarks}`);
      if (log.fromFloor && log.toFloor) {
        console.log(`  └─ Transfer: ${log.quantity} units from ${log.fromFloor} to ${log.toFloor}`);
      }
      if (log.previousValue !== undefined && log.newValue !== undefined) {
        console.log(`  └─ Change: ${log.previousValue} → ${log.newValue}`);
      }
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
  }
}

// Export for testing
module.exports = { demonstrateProductionFlow };

// Run example if called directly
if (require.main === module) {
  demonstrateProductionFlow().catch(console.error);
}
