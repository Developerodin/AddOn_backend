#!/usr/bin/env node

/**
 * Script to fix data inconsistencies in checking floor transfers
 * Specifically fixes cases where transferred quantity > M1 quantity
 */

import mongoose from 'mongoose';
import Article from './src/models/production/article.model.js';
import config from './src/config/config.js';

async function fixCheckingFloorDataInconsistencies() {
  try {
    // Connect to MongoDB
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('Connected to MongoDB');

    // Find articles with floor data inconsistencies
    const articles = await Article.find({
      $or: [
        { 'floorQuantities.checking': { $exists: true } },
        { 'floorQuantities.washing': { $exists: true } },
        { 'floorQuantities.knitting.transferred': { $gt: 0 } }
      ]
    });

    console.log(`Found ${articles.length} articles with floor data`);

    let fixedCount = 0;
    let totalFixes = 0;

    for (const article of articles) {
      console.log(`\n--- Processing Article ${article.articleNumber} (${article.id}) ---`);
      console.log(`Current Floor: ${article.currentFloor}`);
      console.log(`Knitting: received=${article.floorQuantities.knitting?.received}, completed=${article.floorQuantities.knitting?.completed}, transferred=${article.floorQuantities.knitting?.transferred}`);
      console.log(`Checking: received=${article.floorQuantities.checking?.received}, completed=${article.floorQuantities.checking?.completed}, transferred=${article.floorQuantities.checking?.transferred}, m1=${article.floorQuantities.checking?.m1Quantity}`);
      console.log(`Washing: received=${article.floorQuantities.washing?.received}, completed=${article.floorQuantities.washing?.completed}, transferred=${article.floorQuantities.washing?.transferred}`);
      
      // First check for critical corruption
      const corruptionResult = article.fixTransferredQuantityCorruption();
      if (corruptionResult.fixed) {
        console.log(`\n🚨 CRITICAL CORRUPTION FIXED:`);
        corruptionResult.fixes.forEach(fix => {
          console.log(`  ${fix}`);
        });
        totalFixes += corruptionResult.fixes.length;
      }
      
      const result = article.fixAllFloorDataConsistency();
      
      if (result.fixed) {
        console.log(`\n🔧 FIXING ISSUES:`);
        result.fixes.forEach(fix => {
          console.log(`  ✓ ${fix}`);
          totalFixes++;
        });
        
        console.log(`\n📊 UPDATED DATA:`);
        console.log(`  Current Floor: ${result.updatedData.currentFloor}`);
        if (result.updatedData.checking) {
          console.log(`  Checking: received=${result.updatedData.checking.received}, completed=${result.updatedData.checking.completed}, transferred=${result.updatedData.checking.transferred}, remaining=${result.updatedData.checking.remaining}`);
        }
        if (result.updatedData.washing) {
          console.log(`  Washing: received=${result.updatedData.washing.received}, completed=${result.updatedData.washing.completed}, transferred=${result.updatedData.washing.transferred}, remaining=${result.updatedData.washing.remaining}`);
        }
        
        // Save the article
        await article.save();
        fixedCount++;
        
        console.log(`  ✅ Article saved successfully`);
      } else {
        console.log(`  ✅ No issues found for this article`);
      }
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Articles processed: ${articles.length}`);
    console.log(`Articles fixed: ${fixedCount}`);
    console.log(`Total fixes applied: ${totalFixes}`);

    if (fixedCount === 0) {
      console.log('No data inconsistencies found!');
    }

  } catch (error) {
    console.error('Error fixing data inconsistencies:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the fix if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fixCheckingFloorDataInconsistencies()
    .then(() => {
      console.log('Data consistency fix completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export default fixCheckingFloorDataInconsistencies;
