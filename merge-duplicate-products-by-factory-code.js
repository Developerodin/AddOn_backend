/**
 * Merge Duplicate Products by Factory Code Script
 * 
 * This script:
 * 1. Finds products with duplicate factory codes
 * 2. Merges them into a single product
 * 3. Combines all styleCodes from duplicates
 * 4. Removes first 2 characters from product names (e.g., "AS Mens white" -> "Mens white")
 * 5. Removes duplicate styleCodes entries
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
 * Merge styleCodes arrays and remove duplicates
 * @param {Array} styleCodesArrays - Array of styleCodes arrays
 * @returns {Array} - Merged and deduplicated styleCodes
 */
const mergeStyleCodes = (styleCodesArrays) => {
  const seen = new Map();
  const merged = [];

  for (const styleCodes of styleCodesArrays) {
    if (!Array.isArray(styleCodes)) {
      continue;
    }

    for (const item of styleCodes) {
      const styleCode = String(item.styleCode || '').trim();
      const eanCode = String(item.eanCode || '').trim();
      const key = `${styleCode}|${eanCode}`;

      if (!seen.has(key) && (styleCode || eanCode)) {
        merged.push({
          styleCode: styleCode,
          eanCode: eanCode,
          mrp: typeof item.mrp === 'number' ? item.mrp : (parseFloat(item.mrp) || 0),
        });
        seen.set(key, true);
      }
    }
  }

  // If no styleCodes found, create a default entry
  if (merged.length === 0) {
    merged.push({
      styleCode: '',
      eanCode: '',
      mrp: 0,
    });
  }

  return merged;
};

/**
 * Merge products with same factory code
 */
const mergeDuplicateProducts = async () => {
  try {
    console.log('🚀 Starting product merge by factory code...\n');
    
    const db = mongoose.connection.db;
    const productsCollection = db.collection('products');
    
    // Find all products grouped by factory code
    const products = await productsCollection.find({
      factoryCode: { $exists: true, $ne: null, $ne: '' }
    }).toArray();
    
    console.log(`📊 Found ${products.length} products with factory codes\n`);
    
    if (products.length === 0) {
      console.log('ℹ️  No products with factory codes found.');
      return { merged: 0, deleted: 0, errors: 0 };
    }
    
    // Group products by factory code (case-insensitive)
    const factoryCodeGroups = new Map();
    
    for (const product of products) {
      const factoryCode = String(product.factoryCode || '').trim().toLowerCase();
      
      if (!factoryCode) {
        continue;
      }
      
      if (!factoryCodeGroups.has(factoryCode)) {
        factoryCodeGroups.set(factoryCode, []);
      }
      
      factoryCodeGroups.get(factoryCode).push(product);
    }
    
    // Find groups with duplicates
    const duplicateGroups = Array.from(factoryCodeGroups.entries())
      .filter(([_, products]) => products.length > 1);
    
    console.log(`📦 Found ${duplicateGroups.length} factory codes with duplicate products\n`);
    
    if (duplicateGroups.length === 0) {
      console.log('ℹ️  No duplicate factory codes found.');
      return { merged: 0, deleted: 0, errors: 0 };
    }
    
    let mergedCount = 0;
    let deletedCount = 0;
    let errorCount = 0;
    let totalStyleCodesMerged = 0;
    
    // Process each duplicate group
    for (let i = 0; i < duplicateGroups.length; i++) {
      const [factoryCode, duplicateProducts] = duplicateGroups[i];
      
      try {
        console.log(`\n📦 Processing factory code: ${factoryCode} (${duplicateProducts.length} products)`);
        
        // Sort products by creation date (keep the oldest one as base)
        duplicateProducts.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
          const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
          return dateA - dateB;
        });
        
        const baseProduct = duplicateProducts[0];
        const productsToMerge = duplicateProducts.slice(1);
        
        // Collect all styleCodes from all products
        const allStyleCodes = [
          baseProduct.styleCodes || [],
          ...productsToMerge.map(p => p.styleCodes || [])
        ];
        
        // Merge styleCodes
        const mergedStyleCodes = mergeStyleCodes(allStyleCodes);
        const originalStyleCodesCount = allStyleCodes.reduce((sum, arr) => sum + (arr.length || 0), 0);
        const finalStyleCodesCount = mergedStyleCodes.length;
        totalStyleCodesMerged += (originalStyleCodesCount - finalStyleCodesCount);
        
        // Clean product name (remove first 2 characters)
        const cleanedName = cleanProductName(baseProduct.name);
        
        // Prepare update for base product
        const updateData = {
          styleCodes: mergedStyleCodes,
          name: cleanedName,
        };
        
        // Update base product
        await productsCollection.updateOne(
          { _id: baseProduct._id },
          { $set: updateData }
        );
        
        // Collect IDs of products to delete
        const idsToDelete = productsToMerge.map(p => p._id);
        
        // Delete duplicate products
        const deleteResult = await productsCollection.deleteMany({
          _id: { $in: idsToDelete }
        });
        
        mergedCount++;
        deletedCount += deleteResult.deletedCount;
        
        console.log(`   ✅ Merged ${duplicateProducts.length} products into 1`);
        console.log(`   📝 Name: "${baseProduct.name}" -> "${cleanedName}"`);
        console.log(`   🏷️  StyleCodes: ${originalStyleCodesCount} -> ${finalStyleCodesCount} (merged ${originalStyleCodesCount - finalStyleCodesCount} duplicates)`);
        console.log(`   🗑️  Deleted ${deleteResult.deletedCount} duplicate product(s)`);
        
        if ((i + 1) % 10 === 0) {
          console.log(`\n   📊 Progress: ${i + 1}/${duplicateGroups.length} groups processed...`);
        }
        
      } catch (error) {
        errorCount++;
        console.error(`   ❌ Error processing factory code ${factoryCode}:`, error.message);
      }
    }
    
    console.log('\n📈 Merge Summary:');
    console.log(`✅ Successfully merged: ${mergedCount} product groups`);
    console.log(`🗑️  Deleted duplicate products: ${deletedCount}`);
    console.log(`❌ Failed merges: ${errorCount}`);
    console.log(`🏷️  Total styleCodes merged/removed: ${totalStyleCodesMerged}`);
    console.log(`📊 Total duplicate groups processed: ${duplicateGroups.length}`);
    
    if (errorCount === 0) {
      console.log('\n🎉 Product merge completed successfully!');
    } else {
      console.log('\n⚠️  Some products failed to merge. Check the errors above.');
    }
    
    return { merged: mergedCount, deleted: deletedCount, errors: errorCount };
    
  } catch (error) {
    console.error('❌ Merge failed:', error);
    throw error;
  }
};

/**
 * Verify merge results
 */
const verifyMerge = async () => {
  try {
    console.log('\n🔍 Verifying merge results...\n');
    
    const db = mongoose.connection.db;
    const productsCollection = db.collection('products');
    
    // Find all products with factory codes
    const products = await productsCollection.find({
      factoryCode: { $exists: true, $ne: null, $ne: '' }
    }).toArray();
    
    // Group by factory code
    const factoryCodeGroups = new Map();
    
    for (const product of products) {
      const factoryCode = String(product.factoryCode || '').trim().toLowerCase();
      
      if (!factoryCode) {
        continue;
      }
      
      if (!factoryCodeGroups.has(factoryCode)) {
        factoryCodeGroups.set(factoryCode, []);
      }
      
      factoryCodeGroups.get(factoryCode).push(product);
    }
    
    // Find remaining duplicates
    const remainingDuplicates = Array.from(factoryCodeGroups.entries())
      .filter(([_, products]) => products.length > 1);
    
    console.log(`📊 Verification Summary:`);
    console.log(`✅ Products with unique factory codes: ${factoryCodeGroups.size - remainingDuplicates.length}`);
    console.log(`❌ Factory codes with duplicates: ${remainingDuplicates.length}`);
    console.log(`📊 Total products: ${products.length}`);
    
    if (remainingDuplicates.length > 0) {
      console.log(`\n⚠️  Remaining duplicates:`);
      for (const [factoryCode, duplicateProducts] of remainingDuplicates.slice(0, 10)) {
        console.log(`   - ${factoryCode}: ${duplicateProducts.length} products`);
      }
      if (remainingDuplicates.length > 10) {
        console.log(`   ... and ${remainingDuplicates.length - 10} more`);
      }
    } else {
      console.log('\n🎉 All products have unique factory codes!');
    }
    
    // Check for names starting with 2-letter prefixes
    const productsWithPrefixes = products.filter(p => {
      const name = String(p.name || '').trim();
      return name.length > 2 && /^[A-Z]{2}\s/.test(name);
    });
    
    if (productsWithPrefixes.length > 0) {
      console.log(`\n⚠️  Found ${productsWithPrefixes.length} products with 2-letter prefixes still present`);
    } else {
      console.log('\n✅ All product names have been cleaned!');
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    
    console.log('\n⚠️  WARNING: This will merge products with duplicate factory codes!');
    console.log('Products with the same factory code will be merged into one product.');
    console.log('All styleCodes will be combined, and product names will be cleaned.');
    console.log('Duplicate products will be DELETED.\n');
    
    await mergeDuplicateProducts();
    await verifyMerge();
    
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

