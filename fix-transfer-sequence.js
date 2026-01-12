import mongoose from 'mongoose';
import Article from './src/models/production/article.model.js';
import Product from './src/models/product.model.js';
import Process from './src/models/process.model.js';
import config from './src/config/config.js';
import { getFloorKey } from './src/utils/productionHelper.js';
import { ProductionFloor } from './src/models/production/enums.js';

/**
 * Fix transfer sequence issues - ensure previous floors have transferred field set correctly
 */
async function fixTransferSequence() {
  try {
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('✅ Connected to MongoDB\n');

    const articles = await Article.find({ articleNumber: 'A584' });
    
    for (const article of articles) {
      const articleNumber = article.articleNumber;
      console.log(`\n🔧 Fixing transfer sequence for ${articleNumber}...`);
      
      // Get product and expected flow
      const product = await Product.findOne({ factoryCode: articleNumber })
        .populate('processes.processId');
      
      if (!product || !product.processes || product.processes.length === 0) {
        console.log(`⚠️  No product or processes found for ${articleNumber}`);
        continue;
      }
      
      // Get expected floor order
      let expectedFloors;
      try {
        expectedFloors = await article.getFloorOrder();
      } catch (error) {
        console.log(`⚠️  Could not get floor order: ${error.message}`);
        continue;
      }
      
      console.log(`   Expected flow: ${expectedFloors.join(' → ')}`);
      
      const floorQuantities = article.floorQuantities || {};
      let fixed = false;
      
      // Check each floor in sequence
      for (let i = 0; i < expectedFloors.length - 1; i++) {
        const currentFloor = expectedFloors[i];
        const nextFloor = expectedFloors[i + 1];
        const currentFloorKey = getFloorKey(currentFloor);
        const nextFloorKey = getFloorKey(nextFloor);
        
        const currentFloorData = floorQuantities[currentFloorKey];
        const nextFloorData = floorQuantities[nextFloorKey];
        
        // If next floor has received work but current floor hasn't transferred
        if (nextFloorData && nextFloorData.received > 0) {
          if (!currentFloorData || currentFloorData.transferred === 0) {
            console.log(`   ⚠️  ${nextFloor} received ${nextFloorData.received} but ${currentFloor} hasn't transferred`);
            
            // Initialize current floor if it doesn't exist
            if (!currentFloorData) {
              floorQuantities[currentFloorKey] = {
                received: nextFloorData.received,
                completed: nextFloorData.received,
                transferred: nextFloorData.received,
                remaining: 0
              };
              console.log(`   ✅ Created ${currentFloor} floor with transferred=${nextFloorData.received}`);
            } else {
              // Update current floor's transferred to match next floor's received
              currentFloorData.transferred = nextFloorData.received;
              
              // Update received if needed
              if (currentFloorData.received < nextFloorData.received) {
                currentFloorData.received = nextFloorData.received;
              }
              
              // Update completed if needed
              if (currentFloorData.completed < nextFloorData.received) {
                currentFloorData.completed = nextFloorData.received;
              }
              
              // Update remaining
              currentFloorData.remaining = Math.max(0, currentFloorData.received - currentFloorData.transferred);
              
              console.log(`   ✅ Updated ${currentFloor}: transferred=${currentFloorData.transferred}, received=${currentFloorData.received}`);
            }
            
            fixed = true;
          }
        }
      }
      
      if (fixed) {
        article.floorQuantities = floorQuantities;
        await article.save();
        console.log(`   ✅ Article ${articleNumber} fixed and saved`);
      } else {
        console.log(`   ✅ Article ${articleNumber} already has correct transfer sequence`);
      }
    }
    
    await mongoose.disconnect();
    console.log('\n✅ Fix completed');
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
    await mongoose.disconnect();
    throw error;
  }
}

// Run the fix
if (import.meta.url === `file://${process.argv[1]}`) {
  fixTransferSequence()
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error('Fix failed:', error);
      process.exit(1);
    });
}

export default fixTransferSequence;
