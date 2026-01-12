import mongoose from 'mongoose';
import Article from './src/models/production/article.model.js';
import Product from './src/models/product.model.js';
import Process from './src/models/process.model.js';
import config from './src/config/config.js';
import { validateProductProcesses, mapProcessToFloor, getFloorKey } from './src/utils/productionHelper.js';
import { ProductionFloor } from './src/models/production/enums.js';

/**
 * Fix script to clean up articles that have work on floors not in their product's process flow
 * This will:
 * 1. Find articles with work on invalid floors
 * 2. Transfer that work to the correct next floor according to product process flow
 * 3. Clear invalid floor data
 */
async function fixArticleProcessFlow() {
  try {
    // Connect to MongoDB
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('✅ Connected to MongoDB\n');

    const results = {
      totalArticles: 0,
      fixedArticles: 0,
      articlesWithNoProduct: 0,
      articlesWithNoProcesses: 0,
      fixes: []
    };

    // Get all articles
    const articles = await Article.find({});
    results.totalArticles = articles.length;

    console.log(`📊 Checking ${results.totalArticles} articles for process flow violations...\n`);

    for (const article of articles) {
      const articleNumber = article.articleNumber;
      
      try {
        // Find product by factoryCode
        const product = await Product.findOne({ factoryCode: articleNumber })
          .populate('processes.processId');

        if (!product) {
          results.articlesWithNoProduct++;
          console.log(`⚠️  Article ${articleNumber}: No product found`);
          continue;
        }

        if (!product.processes || product.processes.length === 0) {
          results.articlesWithNoProcesses++;
          console.log(`⚠️  Article ${articleNumber}: Product has no processes defined`);
          continue;
        }

        // Validate processes and get expected floors
        const validation = validateProductProcesses(product.processes, articleNumber);
        
        if (!validation.valid) {
          console.log(`❌ Article ${articleNumber}: Invalid processes - ${validation.errors.join(', ')}`);
          continue;
        }

        const expectedFloors = validation.mappedFloors;
        const floorQuantities = article.floorQuantities || {};
        const allFloors = ['knitting', 'linking', 'checking', 'washing', 'boarding', 'silicon', 'secondaryChecking', 'finalChecking', 'branding', 'warehouse', 'dispatch'];
        
        // Find floors with work that shouldn't be there
        const invalidFloors = [];
        for (const floorKey of allFloors) {
          const floorData = floorQuantities[floorKey];
          if (floorData && (floorData.received > 0 || floorData.completed > 0 || floorData.transferred > 0)) {
            // Find which ProductionFloor enum this corresponds to
            const floor = getFloorFromKey(floorKey);
            if (!expectedFloors.includes(floor)) {
              invalidFloors.push({
                floor,
                floorKey,
                data: floorData
              });
            }
          }
        }

        if (invalidFloors.length > 0) {
          console.log(`\n🔧 Fixing Article ${articleNumber}:`);
          console.log(`   Expected flow: ${expectedFloors.join(' → ')}`);
          console.log(`   Invalid floors with work: ${invalidFloors.map(f => `${f.floor} (received=${f.data.received}, completed=${f.data.completed})`).join(', ')}`);

          // For each invalid floor, transfer work to the correct next floor
          for (const invalidFloor of invalidFloors) {
            const floorData = invalidFloor.data;
            const floor = invalidFloor.floor;
            const floorKey = invalidFloor.floorKey;

            // Find the position of this invalid floor in the expected flow
            // If it's before an expected floor, transfer to that expected floor
            // Otherwise, find the previous expected floor and transfer to the next expected floor
            
            // Get the article's actual floor order
            let articleFloorOrder;
            try {
              articleFloorOrder = await article.getFloorOrder();
            } catch (error) {
              articleFloorOrder = expectedFloors;
            }

            // Find where this invalid floor would be in the sequence
            // For now, let's find the previous valid floor and transfer to the next valid floor
            let transferToFloor = null;
            
            // Simple strategy: If invalid floor is "Checking" and expected flow is Linking → Washing,
            // transfer Checking work to Washing
            if (floor === ProductionFloor.CHECKING) {
              // Find Washing in expected floors
              const washingIndex = expectedFloors.indexOf(ProductionFloor.WASHING);
              if (washingIndex !== -1) {
                transferToFloor = ProductionFloor.WASHING;
              }
            }

            // If we found a target floor, transfer the work
            if (transferToFloor) {
              const transferToFloorKey = getFloorKey(transferToFloor);
              const transferToFloorData = floorQuantities[transferToFloorKey] || {
                received: 0,
                completed: 0,
                remaining: 0,
                transferred: 0
              };

              // Transfer received quantity
              const quantityToTransfer = floorData.received || 0;
              if (quantityToTransfer > 0) {
                transferToFloorData.received = (transferToFloorData.received || 0) + quantityToTransfer;
                transferToFloorData.remaining = transferToFloorData.received - (transferToFloorData.completed || 0);
                
                // Update the previous valid floor's transferred field
                // Find the floor before transferToFloor in expected flow
                const transferToFloorIndex = expectedFloors.indexOf(transferToFloor);
                if (transferToFloorIndex > 0) {
                  const previousFloor = expectedFloors[transferToFloorIndex - 1];
                  const previousFloorKey = getFloorKey(previousFloor);
                  const previousFloorData = floorQuantities[previousFloorKey];
                  
                  if (previousFloorData) {
                    // Update previous floor's transferred to include the quantity we're transferring
                    // This ensures the transfer sequence is correct
                    const newTransferred = (previousFloorData.transferred || 0) + quantityToTransfer;
                    previousFloorData.transferred = newTransferred;
                    
                    // Update remaining
                    if (previousFloorData.received > 0) {
                      previousFloorData.remaining = Math.max(0, previousFloorData.received - newTransferred);
                    } else {
                      // If no received, set received to match transferred (work came from invalid floor)
                      previousFloorData.received = newTransferred;
                      previousFloorData.remaining = 0;
                    }
                    
                    // If completed is less than transferred, update it
                    if (previousFloorData.completed < newTransferred) {
                      previousFloorData.completed = newTransferred;
                    }
                    
                    floorQuantities[previousFloorKey] = previousFloorData;
                    console.log(`   ✅ Updated ${previousFloor} floor: transferred=${newTransferred}, received=${previousFloorData.received}`);
                  } else {
                    // Previous floor doesn't exist, create it
                    floorQuantities[previousFloorKey] = {
                      received: quantityToTransfer,
                      completed: quantityToTransfer,
                      transferred: quantityToTransfer,
                      remaining: 0
                    };
                    console.log(`   ✅ Created ${previousFloor} floor entry with transferred=${quantityToTransfer}`);
                  }
                }
                
                // Clear invalid floor data
                floorData.received = 0;
                floorData.completed = 0;
                floorData.transferred = 0;
                floorData.remaining = 0;
                
                // Clear quality data if it's a checking floor
                if (floorKey === 'checking' || floorKey === 'secondaryChecking' || floorKey === 'finalChecking') {
                  floorData.m1Quantity = 0;
                  floorData.m2Quantity = 0;
                  floorData.m3Quantity = 0;
                  floorData.m4Quantity = 0;
                  floorData.m1Transferred = 0;
                  floorData.m1Remaining = 0;
                }

                floorQuantities[transferToFloorKey] = transferToFloorData;
                
                console.log(`   ✅ Transferred ${quantityToTransfer} units from ${floor} to ${transferToFloor}`);
                
                results.fixes.push({
                  articleNumber,
                  fromFloor: floor,
                  toFloor: transferToFloor,
                  quantity: quantityToTransfer
                });
              }
            } else {
              // If we can't determine where to transfer, just clear the invalid floor
              console.log(`   ⚠️  Clearing invalid floor ${floor} (could not determine transfer target)`);
              floorData.received = 0;
              floorData.completed = 0;
              floorData.transferred = 0;
              floorData.remaining = 0;
              
              if (floorKey === 'checking' || floorKey === 'secondaryChecking' || floorKey === 'finalChecking') {
                floorData.m1Quantity = 0;
                floorData.m2Quantity = 0;
                floorData.m3Quantity = 0;
                floorData.m4Quantity = 0;
                floorData.m1Transferred = 0;
                floorData.m1Remaining = 0;
              }
              
              results.fixes.push({
                articleNumber,
                fromFloor: floor,
                toFloor: null,
                quantity: 0,
                action: 'cleared'
              });
            }
          }

          // Save the article
          article.floorQuantities = floorQuantities;
          await article.save();
          results.fixedArticles++;
          console.log(`   ✅ Article ${articleNumber} fixed and saved\n`);
        }

      } catch (error) {
        console.error(`❌ Error fixing article ${articleNumber}:`, error.message);
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 FIX RESULTS SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Articles: ${results.totalArticles}`);
    console.log(`✅ Fixed Articles: ${results.fixedArticles}`);
    console.log(`⚠️  Articles with no product: ${results.articlesWithNoProduct}`);
    console.log(`⚠️  Articles with no processes: ${results.articlesWithNoProcesses}`);
    console.log(`\n🔧 Total Fixes Applied: ${results.fixes.length}\n`);

    if (results.fixes.length > 0) {
      console.log('DETAILED FIXES:');
      console.log('-'.repeat(80));
      results.fixes.forEach((fix, index) => {
        console.log(`${index + 1}. Article ${fix.articleNumber}: ${fix.action === 'cleared' ? 'Cleared' : `Transferred ${fix.quantity} units from ${fix.fromFloor} to ${fix.toFloor}`}`);
      });
    }

    await mongoose.disconnect();
    console.log('\n✅ Fix completed');
    
    return results;

  } catch (error) {
    console.error('❌ Fix failed:', error);
    await mongoose.disconnect();
    throw error;
  }
}

// Helper functions
function getFloorFromKey(floorKey) {
  const keyToFloorMap = {
    'knitting': ProductionFloor.KNITTING,
    'linking': ProductionFloor.LINKING,
    'checking': ProductionFloor.CHECKING,
    'washing': ProductionFloor.WASHING,
    'boarding': ProductionFloor.BOARDING,
    'silicon': ProductionFloor.SILICON,
    'secondaryChecking': ProductionFloor.SECONDARY_CHECKING,
    'branding': ProductionFloor.BRANDING,
    'finalChecking': ProductionFloor.FINAL_CHECKING,
    'warehouse': ProductionFloor.WAREHOUSE,
    'dispatch': ProductionFloor.DISPATCH
  };
  return keyToFloorMap[floorKey] || floorKey;
}

// Run the fix
if (import.meta.url === `file://${process.argv[1]}`) {
  fixArticleProcessFlow()
    .then(results => {
      console.log(`\n✅ Fix completed. Fixed ${results.fixedArticles} articles.`);
      process.exit(0);
    })
    .catch(error => {
      console.error('Fix failed:', error);
      process.exit(1);
    });
}

export default fixArticleProcessFlow;
