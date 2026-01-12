import mongoose from 'mongoose';
import Article from './src/models/production/article.model.js';
import Product from './src/models/product.model.js';
import Process from './src/models/process.model.js'; // Import Process model to register schema
import config from './src/config/config.js';
import { validateProductProcesses, mapProcessToFloor } from './src/utils/productionHelper.js';

/**
 * Test script to verify articles follow their product's process flow
 * Checks if articles are using the correct floor sequence from product processes
 */
async function testArticleProcessFlow() {
  try {
    // Connect to MongoDB using the same config as the app
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('✅ Connected to MongoDB\n');

    const results = {
      totalArticles: 0,
      validArticles: 0,
      invalidArticles: 0,
      articlesWithNoProduct: 0,
      articlesWithNoProcesses: 0,
      violations: []
    };

    // Get all articles
    const articles = await Article.find({}).limit(1000);
    results.totalArticles = articles.length;

    console.log(`📊 Testing ${results.totalArticles} articles...\n`);

    for (const article of articles) {
      const articleNumber = article.articleNumber;
      
      try {
        // Find product by factoryCode
        const product = await Product.findOne({ factoryCode: articleNumber })
          .populate('processes.processId');

        if (!product) {
          results.articlesWithNoProduct++;
          results.violations.push({
            articleNumber,
            issue: 'Product not found',
            message: `Article ${articleNumber}: No product found with factoryCode "${articleNumber}"`
          });
          continue;
        }

        if (!product.processes || product.processes.length === 0) {
          results.articlesWithNoProcesses++;
          results.violations.push({
            articleNumber,
            issue: 'No processes defined',
            message: `Article ${articleNumber}: Product has no processes defined`
          });
          continue;
        }

        // Validate processes
        const validation = validateProductProcesses(product.processes, articleNumber);
        
        if (!validation.valid) {
          results.invalidArticles++;
          results.violations.push({
            articleNumber,
            issue: 'Invalid processes',
            errors: validation.errors
          });
          continue;
        }

        // Get expected floor order from product
        const expectedFloors = validation.mappedFloors;
        
        // Get actual floor order from article (check which floors have received quantities)
        const actualFloors = [];
        const floorQuantities = article.floorQuantities || {};
        
        for (const floor of expectedFloors) {
          const floorKey = getFloorKey(floor);
          const floorData = floorQuantities[floorKey];
          if (floorData && (floorData.received > 0 || floorData.completed > 0 || floorData.transferred > 0)) {
            actualFloors.push(floor);
          }
        }

        // Check if article is following the correct flow
        // Get article's actual floor order from transfer logs or floor data
        let articleFloorOrder;
        try {
          articleFloorOrder = await article.getFloorOrder();
        } catch (error) {
          // Fallback to checking which floors have work
          articleFloorOrder = actualFloors;
        }

        // Check for violations: floors with work that shouldn't be in the process
        const violations = [];
        const allFloors = ['knitting', 'linking', 'checking', 'washing', 'boarding', 'silicon', 'secondaryChecking', 'finalChecking', 'branding', 'warehouse', 'dispatch'];
        
        for (const floorKey of allFloors) {
          const floorData = floorQuantities[floorKey];
          if (floorData && (floorData.received > 0 || floorData.completed > 0 || floorData.transferred > 0)) {
            // Find which ProductionFloor enum this corresponds to
            const floor = getFloorFromKey(floorKey);
            if (!expectedFloors.includes(floor)) {
              violations.push({
                floor,
                floorKey,
                received: floorData.received,
                completed: floorData.completed,
                transferred: floorData.transferred,
                message: `Article ${articleNumber}: Has work on "${floor}" floor, but this floor is not in product's process flow`
              });
            }
          }
        }

        // Check for missing floors: floors in process but no work done
        const missingFloors = [];
        for (const floor of expectedFloors) {
          const floorKey = getFloorKey(floor);
          const floorData = floorQuantities[floorKey];
          if (!floorData || (floorData.received === 0 && floorData.completed === 0 && floorData.transferred === 0)) {
            // This is okay if it's a future floor, but log it
            missingFloors.push(floor);
          }
        }

        // Check transfer sequence violations
        const transferSequenceViolations = checkTransferSequence(article, expectedFloors, floorQuantities);

        if (violations.length > 0 || transferSequenceViolations.length > 0) {
          results.invalidArticles++;
          results.violations.push({
            articleNumber,
            expectedFloors,
            actualFloors: articleFloorOrder,
            violations,
            transferSequenceViolations,
            missingFloors
          });
        } else {
          results.validArticles++;
          if (missingFloors.length > 0) {
            console.log(`⚠️  Article ${articleNumber}: Following correct flow, but missing work on: ${missingFloors.join(', ')}`);
          }
        }

        // Log specific case for A584
        if (articleNumber === 'A584') {
          console.log(`\n🔍 Detailed check for A584:`);
          console.log(`   Expected floors: ${expectedFloors.join(' → ')}`);
          console.log(`   Article floor order: ${articleFloorOrder.join(' → ')}`);
          console.log(`   Violations:`, violations);
          console.log(`   Transfer sequence violations:`, transferSequenceViolations);
          
          // Check if checking floor has work when it shouldn't
          const checkingData = floorQuantities.checking;
          if (checkingData && (checkingData.received > 0 || checkingData.completed > 0)) {
            console.log(`   ⚠️  A584 has work on Checking floor:`, {
              received: checkingData.received,
              completed: checkingData.completed,
              transferred: checkingData.transferred
            });
          }
        }

      } catch (error) {
        results.invalidArticles++;
        results.violations.push({
          articleNumber,
          issue: 'Error checking article',
          error: error.message
        });
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Articles: ${results.totalArticles}`);
    console.log(`✅ Valid Articles: ${results.validArticles}`);
    console.log(`❌ Invalid Articles: ${results.invalidArticles}`);
    console.log(`⚠️  Articles with no product: ${results.articlesWithNoProduct}`);
    console.log(`⚠️  Articles with no processes: ${results.articlesWithNoProcesses}`);
    console.log(`\n🚨 Violations Found: ${results.violations.length}\n`);

    if (results.violations.length > 0) {
      console.log('DETAILED VIOLATIONS:');
      console.log('-'.repeat(80));
      results.violations.forEach((violation, index) => {
        console.log(`\n${index + 1}. Article: ${violation.articleNumber}`);
        if (violation.issue) {
          console.log(`   Issue: ${violation.issue}`);
          console.log(`   Message: ${violation.message || violation.error}`);
        } else {
          console.log(`   Expected Flow: ${violation.expectedFloors?.join(' → ') || 'N/A'}`);
          console.log(`   Actual Flow: ${violation.actualFloors?.join(' → ') || 'N/A'}`);
          if (violation.violations && violation.violations.length > 0) {
            console.log(`   🚨 Invalid Floors with Work:`);
            violation.violations.forEach(v => {
              console.log(`      - ${v.floor}: received=${v.received}, completed=${v.completed}, transferred=${v.transferred}`);
            });
          }
          if (violation.transferSequenceViolations && violation.transferSequenceViolations.length > 0) {
            console.log(`   🚨 Transfer Sequence Violations:`);
            violation.transferSequenceViolations.forEach(v => {
              console.log(`      - ${v.message}`);
            });
          }
        }
      });
    }

    await mongoose.disconnect();
    console.log('\n✅ Test completed');
    
    return results;

  } catch (error) {
    console.error('❌ Test failed:', error);
    await mongoose.disconnect();
    throw error;
  }
}

// Helper functions
function getFloorKey(floor) {
  const floorMap = {
    'Knitting': 'knitting',
    'Linking': 'linking',
    'Checking': 'checking',
    'Washing': 'washing',
    'Boarding': 'boarding',
    'Silicon': 'silicon',
    'Secondary Checking': 'secondaryChecking',
    'Branding': 'branding',
    'Final Checking': 'finalChecking',
    'Warehouse': 'warehouse',
    'Dispatch': 'dispatch'
  };
  return floorMap[floor] || floor.toLowerCase();
}

function getFloorFromKey(floorKey) {
  const keyToFloorMap = {
    'knitting': 'Knitting',
    'linking': 'Linking',
    'checking': 'Checking',
    'washing': 'Washing',
    'boarding': 'Boarding',
    'silicon': 'Silicon',
    'secondaryChecking': 'Secondary Checking',
    'branding': 'Branding',
    'finalChecking': 'Final Checking',
    'warehouse': 'Warehouse',
    'dispatch': 'Dispatch'
  };
  return keyToFloorMap[floorKey] || floorKey;
}

function checkTransferSequence(article, expectedFloors, floorQuantities) {
  const violations = [];
  
  // Check if transfers happened in wrong order
  for (let i = 0; i < expectedFloors.length - 1; i++) {
    const currentFloor = expectedFloors[i];
    const nextFloor = expectedFloors[i + 1];
    const currentFloorKey = getFloorKey(currentFloor);
    const nextFloorKey = getFloorKey(nextFloor);
    
    const currentData = floorQuantities[currentFloorKey];
    const nextData = floorQuantities[nextFloorKey];
    
    // If next floor has received work but current floor hasn't transferred
    if (nextData && nextData.received > 0) {
      if (!currentData || currentData.transferred === 0) {
        violations.push({
          message: `Floor "${nextFloor}" received work, but "${currentFloor}" hasn't transferred any`
        });
      }
    }
  }
  
  return violations;
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testArticleProcessFlow()
    .then(results => {
      process.exit(results.invalidArticles > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

export default testArticleProcessFlow;
