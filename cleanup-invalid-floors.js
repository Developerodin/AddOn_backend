import mongoose from 'mongoose';
import Article from './src/models/production/article.model.js';
import Product from './src/models/product.model.js';
import Process from './src/models/process.model.js';
import config from './src/config/config.js';
import { getFloorKey } from './src/utils/productionHelper.js';
import { ProductionFloor } from './src/models/production/enums.js';

/**
 * Cleanup script to remove work from floors not in product's process flow
 * This will clear all data from invalid floors for all articles
 */
async function cleanupInvalidFloors() {
  try {
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('✅ Connected to MongoDB\n');

    const results = {
      totalArticles: 0,
      cleanedArticles: 0,
      totalFloorsCleaned: 0,
      details: []
    };

    const articles = await Article.find({});
    results.totalArticles = articles.length;

    console.log(`📊 Cleaning up ${results.totalArticles} articles...\n`);

    for (const article of articles) {
      const articleNumber = article.articleNumber;
      let cleaned = false;
      const cleanedFloors = [];

      try {
        // Get product and expected flow
        const product = await Product.findOne({ factoryCode: articleNumber })
          .populate('processes.processId');

        if (!product || !product.processes || product.processes.length === 0) {
          console.log(`⚠️  Article ${articleNumber}: No product or processes found, skipping`);
          continue;
        }

        // Get expected floor order
        let expectedFloors;
        try {
          expectedFloors = await article.getFloorOrder();
        } catch (error) {
          console.log(`⚠️  Article ${articleNumber}: Could not get floor order: ${error.message}`);
          continue;
        }

        const floorQuantities = article.floorQuantities || {};
        const allFloors = ['knitting', 'linking', 'checking', 'washing', 'boarding', 'silicon', 'secondaryChecking', 'finalChecking', 'branding', 'warehouse', 'dispatch'];

        // Clear work from floors not in expected flow
        for (const floorKey of allFloors) {
          const floorData = floorQuantities[floorKey];
          if (floorData && (floorData.received > 0 || floorData.completed > 0 || floorData.transferred > 0)) {
            // Find which ProductionFloor enum this corresponds to
            const floor = getFloorFromKey(floorKey);
            if (!expectedFloors.includes(floor)) {
              // Clear this floor's data
              const hadData = {
                received: floorData.received,
                completed: floorData.completed,
                transferred: floorData.transferred
              };

              // Clear all data
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
                floorData.repairStatus = 'Not Required';
                floorData.repairRemarks = '';
              }

              cleanedFloors.push({
                floor,
                floorKey,
                cleared: hadData
              });

              cleaned = true;
              results.totalFloorsCleaned++;
            }
          }
        }

        if (cleaned) {
          article.floorQuantities = floorQuantities;
          // Recalculate progress
          article.progress = article.calculatedProgress;
          await article.save();

          results.cleanedArticles++;
          results.details.push({
            articleNumber,
            expectedFloors,
            cleanedFloors
          });

          console.log(`✅ Article ${articleNumber}:`);
          console.log(`   Expected flow: ${expectedFloors.join(' → ')}`);
          cleanedFloors.forEach(cf => {
            console.log(`   🗑️  Cleared ${cf.floor}: received=${cf.cleared.received}, completed=${cf.cleared.completed}, transferred=${cf.cleared.transferred}`);
          });
          console.log('');
        }

      } catch (error) {
        console.error(`❌ Error cleaning article ${articleNumber}:`, error.message);
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 CLEANUP RESULTS SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Articles: ${results.totalArticles}`);
    console.log(`✅ Cleaned Articles: ${results.cleanedArticles}`);
    console.log(`🗑️  Total Floors Cleaned: ${results.totalFloorsCleaned}\n`);

    if (results.details.length > 0) {
      console.log('DETAILED CLEANUP:');
      console.log('-'.repeat(80));
      results.details.forEach((detail, index) => {
        console.log(`\n${index + 1}. Article: ${detail.articleNumber}`);
        console.log(`   Expected Flow: ${detail.expectedFloors.join(' → ')}`);
        detail.cleanedFloors.forEach(cf => {
          console.log(`   🗑️  Cleared ${cf.floor}: received=${cf.cleared.received}, completed=${cf.cleared.completed}, transferred=${cf.cleared.transferred}`);
        });
      });
    }

    await mongoose.disconnect();
    console.log('\n✅ Cleanup completed');
    
    return results;

  } catch (error) {
    console.error('❌ Cleanup failed:', error);
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

// Run the cleanup
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupInvalidFloors()
    .then(results => {
      console.log(`\n✅ Cleanup completed. Cleaned ${results.cleanedArticles} articles, ${results.totalFloorsCleaned} floors.`);
      process.exit(0);
    })
    .catch(error => {
      console.error('Cleanup failed:', error);
      process.exit(1);
    });
}

export default cleanupInvalidFloors;
