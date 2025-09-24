#!/usr/bin/env node

/**
 * Simple emergency script to fix transferred quantity corruption
 * Uses direct MongoDB connection like the existing backend
 */

import mongoose from 'mongoose';
import Article from './src/models/production/article.model.js';

// Use the same MongoDB URL as your existing backend
const MONGODB_URL = 'mongodb://localhost:27017/addon-production';

async function emergencyFixCorruption() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
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

    // Check for corruption
    const m1Quantity = checkingData?.m1Quantity || 0;
    const transferredQuantity = checkingData?.transferred || 0;
    
    console.log(`\n🚨 CORRUPTION CHECK:`);
    console.log(`  Transferred: ${transferredQuantity}`);
    console.log(`  M1 Quantity: ${m1Quantity}`);
    console.log(`  Corruption: ${transferredQuantity > m1Quantity ? 'YES' : 'NO'}`);
    
    if (transferredQuantity > m1Quantity) {
      console.log(`\n🔧 APPLYING EMERGENCY FIX:`);
      
      // Manual fix since we can't use the model method without full config
      const oldTransferred = transferredQuantity;
      checkingData.transferred = m1Quantity;
      checkingData.remaining = checkingData.received - m1Quantity;
      
      console.log(`  ✅ Reduced transferred from ${oldTransferred} to ${m1Quantity}`);
      console.log(`  ✅ Updated remaining to ${checkingData.remaining}`);
      
      // Ensure completed >= transferred
      if (checkingData.completed < checkingData.transferred) {
        checkingData.completed = checkingData.transferred;
        console.log(`  ✅ Updated completed to ${checkingData.completed}`);
      }
      
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
