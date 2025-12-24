/**
 * Fix Duplicate StyleCodes Script
 * 
 * This script removes duplicate styleCodes entries within products
 * that have the same styleCode and eanCode combination.
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
 * Remove duplicate styleCodes from a product
 * @param {Array} styleCodes - Array of styleCode objects
 * @returns {Array} - Deduplicated array
 */
const removeDuplicates = (styleCodes) => {
  if (!Array.isArray(styleCodes) || styleCodes.length === 0) {
    return styleCodes;
  }

  const seen = new Map();
  const unique = [];

  for (const item of styleCodes) {
    const styleCode = String(item.styleCode || '').trim();
    const eanCode = String(item.eanCode || '').trim();
    
    // Create a unique key from styleCode and eanCode
    const key = `${styleCode}|${eanCode}`;
    
    if (!seen.has(key)) {
      // Keep the first occurrence, ensure mrp is valid
      unique.push({
        styleCode: styleCode,
        eanCode: eanCode,
        mrp: typeof item.mrp === 'number' ? item.mrp : (parseFloat(item.mrp) || 0),
      });
      seen.set(key, true);
    }
  }

  return unique;
};

/**
 * Main function to fix duplicate styleCodes
 */
const fixDuplicateStyleCodes = async () => {
  try {
    console.log('🚀 Starting duplicate styleCodes cleanup...\n');
    
    // Use MongoDB native collection
    const db = mongoose.connection.db;
    const productsCollection = db.collection('products');
    
    // Find all products with styleCodes array
    const products = await productsCollection.find({
      styleCodes: { $exists: true, $type: 'array' }
    }).toArray();
    
    console.log(`📊 Found ${products.length} products with styleCodes to check\n`);
    
    if (products.length === 0) {
      console.log('ℹ️  No products with styleCodes found.');
      return { updated: 0, skipped: 0, errors: 0 };
    }
    
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    let totalDuplicatesRemoved = 0;
    const batchSize = 50;
    
    // Process products in batches
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} products)...`);
      
      const batchPromises = batch.map(async (product) => {
        try {
          if (!Array.isArray(product.styleCodes) || product.styleCodes.length === 0) {
            skippedCount++;
            return;
          }
          
          const originalLength = product.styleCodes.length;
          const uniqueStyleCodes = removeDuplicates(product.styleCodes);
          const duplicatesRemoved = originalLength - uniqueStyleCodes.length;
          
          // Only update if duplicates were found
          if (duplicatesRemoved > 0) {
            await productsCollection.updateOne(
              { _id: product._id },
              { $set: { styleCodes: uniqueStyleCodes } }
            );
            
            updatedCount++;
            totalDuplicatesRemoved += duplicatesRemoved;
            
            const productName = product.name || product.softwareCode || product._id;
            if (updatedCount % 10 === 0) {
              console.log(`   ✅ Fixed ${updatedCount} products (removed ${totalDuplicatesRemoved} duplicates so far)...`);
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
    console.log(`✅ Successfully updated: ${updatedCount} products`);
    console.log(`⏭️  Skipped (no duplicates): ${skippedCount} products`);
    console.log(`❌ Failed updates: ${errorCount} products`);
    console.log(`🗑️  Total duplicates removed: ${totalDuplicatesRemoved}`);
    console.log(`📊 Total products processed: ${products.length}`);
    
    if (errorCount === 0) {
      console.log('\n🎉 Duplicate styleCodes cleanup completed successfully!');
    } else {
      console.log('\n⚠️  Some products failed to update. Check the errors above.');
    }
    
    return { updated: updatedCount, skipped: skippedCount, errors: errorCount, duplicatesRemoved: totalDuplicatesRemoved };
    
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
    
    const products = await productsCollection.find({
      styleCodes: { $exists: true, $type: 'array' }
    }).toArray();
    
    let productsWithDuplicates = 0;
    let totalDuplicates = 0;
    
    for (const product of products) {
      if (!Array.isArray(product.styleCodes) || product.styleCodes.length === 0) {
        continue;
      }
      
      const seen = new Map();
      let hasDuplicates = false;
      let duplicateCount = 0;
      
      for (const item of product.styleCodes) {
        const styleCode = String(item.styleCode || '').trim();
        const eanCode = String(item.eanCode || '').trim();
        const key = `${styleCode}|${eanCode}`;
        
        if (seen.has(key)) {
          hasDuplicates = true;
          duplicateCount++;
        } else {
          seen.set(key, true);
        }
      }
      
      if (hasDuplicates) {
        productsWithDuplicates++;
        totalDuplicates += duplicateCount;
        const productName = product.name || product.softwareCode || product._id;
        console.log(`❌ ${productName}: Has ${duplicateCount} duplicate(s)`);
      }
    }
    
    console.log(`\n📊 Verification Summary:`);
    console.log(`✅ Products without duplicates: ${products.length - productsWithDuplicates}`);
    console.log(`❌ Products with duplicates: ${productsWithDuplicates}`);
    console.log(`🗑️  Total duplicates found: ${totalDuplicates}`);
    console.log(`📊 Total products checked: ${products.length}`);
    
    if (productsWithDuplicates === 0) {
      console.log('\n🎉 All products are clean - no duplicates found!');
    } else {
      console.log('\n⚠️  Some products still have duplicates. Re-run the cleanup script.');
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    
    console.log('\n⚠️  WARNING: This will remove duplicate styleCodes entries from products!');
    console.log('Duplicates are identified by matching styleCode + eanCode combinations.\n');
    
    await fixDuplicateStyleCodes();
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

