#!/usr/bin/env node

/**
 * Emergency script to fix transferred quantity corruption
 * Specifically fixes the issue: transferred (15994) > M1 (8997)
 */

import mongoose from 'mongoose';
import Article from './src/models/production/article.model.js';
import config from './src/config/config.js';

async function emergencyFixCorruption() {
  try {
    // Connect to MongoDB
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('🚨 EMERGENCY FIX: Connected to MongoDB');

    // Find the specific article with corruption
    const articleId = '68d3d6ac79e355042bb5dc48';
    const article = await Article.findById(articleId);
    
    if (!article) {
      console.log('❌ Article not found');
      return;
    }

    console.log(`\n🔍 ANALYZING ARTICLE ${article.articleNumber} (${article.id}):`);
    console.log(`Current Floor: ${article.currentFloor}`);
    
    const checkingData = article.floorQuantities.checking;
    console.log(`\n📊 CURRENT CHECKING FLOOR DATA:`);
    console.log(`  Received: ${checkingData?.received}`);
    console.log(`  Completed: ${checkingData?.completed}`);
    console.log(`  Transferred: ${checkingData?.transferred}`);
    console.log(`  Remaining: ${checkingData?.remaining}`);
    console.log(`  M1 Quantity: ${checkingData?.m1Quantity}`);
    console.log(`  M2 Quantity: ${checkingData?.m2Quantity}`);
    console.log(`  M3 Quantity: ${checkingData?.m3Quantity}`);
    console.log(`  M4 Quantity: ${checkingData?.m4Quantity}`);

    // Check for corruption
    const m1Quantity = checkingData?.m1Quantity || 0;
    const transferredQuantity = checkingData?.transferred || 0;
    
    console.log(`\n🚨 CORRUPTION CHECK:`);
    console.log(`  Transferred: ${transferredQuantity}`);
    console.log(`  M1 Quantity: ${m1Quantity}`);
    console.log(`  Corruption: ${transferredQuantity > m1Quantity ? 'YES' : 'NO'}`);
    
    if (transferredQuantity > m1Quantity) {
      console.log(`\n🔧 APPLYING EMERGENCY FIX:`);
      
      const result = article.fixTransferredQuantityCorruption();
      
      if (result.fixed) {
        console.log(`\n✅ FIXES APPLIED:`);
        result.fixes.forEach(fix => {
          console.log(`  ${fix}`);
        });
        
        console.log(`\n📊 CORRECTED DATA:`);
        console.log(`  Received: ${result.updatedData.received}`);
        console.log(`  Transferred: ${result.updatedData.transferred}`);
        console.log(`  Completed: ${result.updatedData.completed}`);
        console.log(`  Remaining: ${result.updatedData.remaining}`);
        console.log(`  M1 Quantity: ${result.updatedData.m1Quantity}`);
        
        // Save the article
        await article.save();
        console.log(`\n✅ Article saved successfully!`);
        
        // Verify the fix
        console.log(`\n🔍 VERIFICATION:`);
        const updatedArticle = await Article.findById(articleId);
        const updatedCheckingData = updatedArticle.floorQuantities.checking;
        console.log(`  Transferred: ${updatedCheckingData.transferred}`);
        console.log(`  M1 Quantity: ${updatedCheckingData.m1Quantity}`);
        console.log(`  Status: ${updatedCheckingData.transferred <= updatedCheckingData.m1Quantity ? '✅ FIXED' : '❌ STILL CORRUPTED'}`);
        
      } else {
        console.log(`❌ No fixes were applied: ${result.message}`);
      }
    } else {
      console.log(`✅ No corruption detected. Data is consistent.`);
    }

  } catch (error) {
    console.error('❌ Error during emergency fix:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the emergency fix
emergencyFixCorruption()
  .then(() => {
    console.log('\n🎉 Emergency fix completed!');
    console.log('You can now retry your quality inspection request.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Emergency fix failed:', error);
    process.exit(1);
  });
