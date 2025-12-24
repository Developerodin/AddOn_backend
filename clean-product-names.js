/**
 * Clean Product Names Script
 * 
 * This script removes the first 2 characters from product names
 * (e.g., "AS Mens white" -> "Mens white", "VM Mens white" -> "Mens white")
 */

import mongoose from 'mongoose';
import Product from './src/models/product.model.js';
import config from './src/config/config.js';

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

/**
 * Remove first 2 characters from product name
 * @param {string} name - Product name
 * @returns {string} - Cleaned name
 */
const cleanProductName = (name) => {
  if (!name || typeof name !== 'string') {
    return name || '';
  }
  
  const trimmed = name.trim();
  // Remove first 2 characters if name is longer than 2 characters
  if (trimmed.length > 2) {
    return trimmed.substring(2).trim();
  }
  
  return trimmed;
};

/**
 * Clean all product names
 */
const cleanProductNames = async () => {
  try {
    console.log('🚀 Starting product name cleanup...\n');
    
    const db = mongoose.connection.db;
    const productsCollection = db.collection('products');
    
    // Find all products
    const products = await productsCollection.find({}).toArray();
    
    console.log(`📊 Found ${products.length} products to process\n`);
    
    if (products.length === 0) {
      console.log('ℹ️  No products found.');
      return { updated: 0, skipped: 0, errors: 0 };
    }
    
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const batchSize = 50;
    
    // Process products in batches
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} products)...`);
      
      const batchPromises = batch.map(async (product) => {
        try {
          const originalName = product.name || '';
          const cleanedName = cleanProductName(originalName);
          
          // Only update if name changed
          if (cleanedName !== originalName) {
            await productsCollection.updateOne(
              { _id: product._id },
              { $set: { name: cleanedName } }
            );
            
            updatedCount++;
            
            if (updatedCount % 10 === 0) {
              console.log(`   ✅ Updated ${updatedCount} product names...`);
            }
          } else {
            skippedCount++;
          }
          
        } catch (error) {
          errorCount++;
          const productName = product.name || product.softwareCode || product._id;
          console.error(`   ❌ Error processing product ${productName}:`, error.message);
        }
      });
      
      await Promise.all(batchPromises);
      
      const batchTime = Date.now() - batchStartTime;
      console.log(`   ⏱️  Batch completed in ${batchTime}ms`);
    }
    
    console.log('\n📈 Cleanup Summary:');
    console.log(`✅ Successfully updated: ${updatedCount} product names`);
    console.log(`⏭️  Skipped (no change needed): ${skippedCount} products`);
    console.log(`❌ Failed updates: ${errorCount} products`);
    console.log(`📊 Total products processed: ${products.length}`);
    
    if (errorCount === 0) {
      console.log('\n🎉 Product name cleanup completed successfully!');
    } else {
      console.log('\n⚠️  Some products failed to update. Check the errors above.');
    }
    
    return { updated: updatedCount, skipped: skippedCount, errors: errorCount };
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    throw error;
  }
};

/**
 * Verify cleanup results
 */
const verifyCleanup = async () => {
  try {
    console.log('\n🔍 Verifying cleanup results...\n');
    
    const db = mongoose.connection.db;
    const productsCollection = db.collection('products');
    
    const products = await productsCollection.find({}).toArray();
    
    // Check for names starting with 2-letter prefixes
    const productsWithPrefixes = products.filter(p => {
      const name = String(p.name || '').trim();
      return name.length > 2 && /^[A-Z]{2}\s/.test(name);
    });
    
    console.log(`📊 Verification Summary:`);
    console.log(`✅ Products with cleaned names: ${products.length - productsWithPrefixes.length}`);
    console.log(`⚠️  Products with 2-letter prefixes: ${productsWithPrefixes.length}`);
    console.log(`📊 Total products: ${products.length}`);
    
    if (productsWithPrefixes.length > 0) {
      console.log(`\n⚠️  Sample products with prefixes still present:`);
      productsWithPrefixes.slice(0, 10).forEach(p => {
        console.log(`   - "${p.name}"`);
      });
      if (productsWithPrefixes.length > 10) {
        console.log(`   ... and ${productsWithPrefixes.length - 10} more`);
      }
    } else {
      console.log('\n🎉 All product names have been cleaned!');
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    
    console.log('\n⚠️  WARNING: This will remove the first 2 characters from all product names!');
    console.log('Example: "AS Mens white" -> "Mens white"\n');
    
    await cleanProductNames();
    await verifyCleanup();
    
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the script
main();

