/**
 * Example Usage of Updated Article Model
 * Demonstrates the 11-floor production flow with proper quantity tracking
 * Flow: knitting → linking → checking → washing → boarding → silicon → secondaryChecking → branding → finalChecking → warehouse → dispatch
 */

import { Article, ProductionFloor, ArticleLog } from './index.js';

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
  await article.updateCompletedQuantity(ProductionFloor.KNITTING, 750, 'user123', 'supervisor456', 'Knitting completed 750 units');
  await article.save();
  console.log('\n✅ Knitting: 750 completed');
  console.log('Knitting status:', article.getFloorStatus(ProductionFloor.KNITTING));
  
  // 3. Transfer 750 from Knitting to Linking
  await article.transferFromFloor(ProductionFloor.KNITTING, 750, 'user123', 'supervisor456', '750 units transferred to Linking');
  await article.save();
  console.log('\n✅ Transferred 750 from Knitting to Linking');
  console.log('Knitting status after transfer:', article.getFloorStatus(ProductionFloor.KNITTING));
  console.log('Linking status after transfer:', article.getFloorStatus(ProductionFloor.LINKING));
  
  // 4. Linking floor: Complete 200 units
  await article.updateCompletedQuantity(ProductionFloor.LINKING, 200, 'user123', 'supervisor456', 'Linking completed 200 units');
  await article.save();
  console.log('\n✅ Linking: 200 completed');
  console.log('Linking status:', article.getFloorStatus(ProductionFloor.LINKING));
  
  // 5. Transfer 200 from Linking to Checking
  await article.transferFromFloor(ProductionFloor.LINKING, 200, 'user123', 'supervisor456', '200 units transferred to Checking');
  await article.save();
  console.log('\n✅ Transferred 200 from Linking to Checking');
  console.log('Linking status after transfer:', article.getFloorStatus(ProductionFloor.LINKING));
  console.log('Checking status after transfer:', article.getFloorStatus(ProductionFloor.CHECKING));
  
  // 6. Checking floor: Complete 100 units with quality inspection
  const qualityData = {
    completedQuantity: 100,
    m1Quantity: 80,
    m2Quantity: 15,
    m3Quantity: 3,
    m4Quantity: 2
  };
  await article.updateCompletedQuantityWithQuality(qualityData, 'user123', 'supervisor456', 'Checking completed 100 units with quality inspection');
  await article.save();
  console.log('\n✅ Checking: 100 completed (M1: 80, M2: 15, M3: 3, M4: 2)');
  console.log('Checking status:', article.getFloorStatus(ProductionFloor.CHECKING));
  
  // 7. Transfer 80 M1 units from Checking to Washing
  await article.transferM1FromFloor(ProductionFloor.CHECKING, 80, 'user123', 'supervisor456', '80 M1 units transferred to Washing');
  await article.save();
  console.log('\n✅ Transferred 80 M1 units from Checking to Washing');
  console.log('Checking status after transfer:', article.getFloorStatus(ProductionFloor.CHECKING));
  console.log('Washing status after transfer:', article.getFloorStatus(ProductionFloor.WASHING));
  
  // 8. Continue flow: Washing → Boarding → Silicon → Secondary Checking → Branding → Final Checking
  await article.updateCompletedQuantity(ProductionFloor.WASHING, 80, 'user123', 'supervisor456', 'Washing completed 80 units');
  await article.transferFromFloor(ProductionFloor.WASHING, 80, 'user123', 'supervisor456', '80 units transferred to Boarding');
  await article.save();
  
  await article.updateCompletedQuantity(ProductionFloor.BOARDING, 80, 'user123', 'supervisor456', 'Boarding completed 80 units');
  await article.transferFromFloor(ProductionFloor.BOARDING, 80, 'user123', 'supervisor456', '80 units transferred to Silicon');
  await article.save();
  
  await article.updateCompletedQuantity(ProductionFloor.SILICON, 80, 'user123', 'supervisor456', 'Silicon completed 80 units');
  await article.transferFromFloor(ProductionFloor.SILICON, 80, 'user123', 'supervisor456', '80 units transferred to Secondary Checking');
  await article.save();
  
  // Secondary Checking with quality inspection
  const secondaryQualityData = {
    completedQuantity: 80,
    m1Quantity: 75,
    m2Quantity: 3,
    m3Quantity: 1,
    m4Quantity: 1
  };
  await article.updateCompletedQuantityWithQuality(secondaryQualityData, 'user123', 'supervisor456', 'Secondary Checking completed 80 units');
  await article.transferM1FromFloor(ProductionFloor.SECONDARY_CHECKING, 75, 'user123', 'supervisor456', '75 M1 units transferred to Branding');
  await article.save();
  
  await article.updateCompletedQuantity(ProductionFloor.BRANDING, 75, 'user123', 'supervisor456', 'Branding completed 75 units');
  await article.transferFromFloor(ProductionFloor.BRANDING, 75, 'user123', 'supervisor456', '75 units transferred to Final Checking');
  await article.save();
  
  // Final Checking with quality inspection
  const finalQualityData = {
    completedQuantity: 75,
    m1Quantity: 73,
    m2Quantity: 1,
    m3Quantity: 0,
    m4Quantity: 1
  };
  await article.updateCompletedQuantityWithQuality(finalQualityData, 'user123', 'supervisor456', 'Final Checking completed 75 units');
  await article.transferM1FromFloor(ProductionFloor.FINAL_CHECKING, 73, 'user123', 'supervisor456', '73 M1 units transferred to Warehouse');
  await article.save();
  
  // 9. Show overall status
  console.log('\n📊 Overall Article Status:');
  console.log('Current floor:', article.getCurrentActiveFloor());
  console.log('Planned quantity:', article.plannedQuantity);
  console.log('Overall progress:', article.progress + '%');
  
  // 10. Show all floor statuses
  console.log('\n📋 All Floor Statuses:');
  const allStatuses = article.getAllFloorStatuses();
  allStatuses.forEach(status => {
    if (status.received > 0 || status.completed > 0) {
      console.log(`${status.floor}: Received=${status.received}, Completed=${status.completed}, Remaining=${status.remaining}, Transferred=${status.transferred}, Rate=${status.completionRate}%`);
    }
  });
  
  // 11. Show logs for this article
  console.log('\n📝 Article Logs:');
  try {
    const logs = await ArticleLog.find({ articleId: article._id.toString() }).sort({ createdAt: -1 }).limit(10);
    logs.forEach(log => {
      console.log(`[${log.createdAt.toISOString()}] ${log.action}: ${log.remarks}`);
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
export { demonstrateProductionFlow };

// Run example if called directly (ES modules)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('example-usage.js')) {
  demonstrateProductionFlow().catch(console.error);
}
