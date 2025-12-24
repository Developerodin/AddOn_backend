/**
 * Migration Script: Transform Product styleCode/eanCode to styleCodes Array
 * 
 * This script transforms all existing products from the old format:
 *   - styleCode: String
 *   - eanCode: String
 * 
 * To the new format:
 *   - styleCodes: Array of objects with { styleCode, eanCode, mrp }
 * 
 * If mrp is missing, it defaults to 0.
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
 * Transform product data to new format
 * @param {Object} product - Product document
 * @returns {Object|null} - Update object or null if no update needed
 */
const transformProduct = (product) => {
  const update = {};
  let needsUpdate = false;
  const unsetFields = {};

  // Check if product has old format (styleCode/eanCode as individual fields)
  const hasOldFormat = product.styleCode !== undefined || product.eanCode !== undefined;
  
  // Check if product already has new format (styleCodes array)
  const hasNewFormat = Array.isArray(product.styleCodes) && product.styleCodes.length > 0;

  if (hasOldFormat) {
    // Transform from old format to new format
    const styleCodeValue = product.styleCode ? String(product.styleCode).trim() : '';
    const eanCodeValue = product.eanCode ? String(product.eanCode).trim() : '';
    
    // If product also has new format, merge them (old format takes precedence for first entry)
    if (hasNewFormat) {
      // Merge: use old format values for first entry, keep existing entries
      const existingStyleCodes = product.styleCodes.map(item => ({
        styleCode: item.styleCode ? String(item.styleCode).trim() : '',
        eanCode: item.eanCode ? String(item.eanCode).trim() : '',
        mrp: typeof item.mrp === 'number' ? item.mrp : (parseFloat(item.mrp) || 0),
      }));
      
      // Prepend old format as first entry if it has values
      if (styleCodeValue || eanCodeValue) {
        update.styleCodes = [{
          styleCode: styleCodeValue || '',
          eanCode: eanCodeValue || '',
          mrp: 0,
        }, ...existingStyleCodes];
      } else {
        update.styleCodes = existingStyleCodes;
      }
    } else {
      // Only old format exists - create new array
      if (styleCodeValue || eanCodeValue) {
        update.styleCodes = [{
          styleCode: styleCodeValue || '',
          eanCode: eanCodeValue || '',
          mrp: 0, // Default mrp to 0
        }];
      } else {
        // Both are empty, create default entry
        update.styleCodes = [{
          styleCode: '',
          eanCode: '',
          mrp: 0,
        }];
      }
    }
    
    needsUpdate = true;
    // Mark old fields for removal
    unsetFields.styleCode = '';
    unsetFields.eanCode = '';
    
  } else if (hasNewFormat) {
    // Product already has styleCodes array, but check if any items are missing mrp or need trimming
    const updatedStyleCodes = product.styleCodes.map(item => {
      const currentMrp = typeof item.mrp === 'number' ? item.mrp : (parseFloat(item.mrp) || 0);
      const styleCodeItem = {
        styleCode: item.styleCode ? String(item.styleCode).trim() : '',
        eanCode: item.eanCode ? String(item.eanCode).trim() : '',
        mrp: currentMrp,
      };
      
      // Check if mrp was missing, invalid, or values need trimming
      const originalStyleCode = String(item.styleCode || '');
      const originalEanCode = String(item.eanCode || '');
      if (item.mrp === undefined || item.mrp === null || isNaN(item.mrp) || 
          originalStyleCode !== styleCodeItem.styleCode || 
          originalEanCode !== styleCodeItem.eanCode) {
        needsUpdate = true;
      }
      
      return styleCodeItem;
    });
    
    if (needsUpdate) {
      update.styleCodes = updatedStyleCodes;
    }
  } else {
    // Product has neither old nor new format - create default entry
    update.styleCodes = [{
      styleCode: '',
      eanCode: '',
      mrp: 0,
    }];
    needsUpdate = true;
  }

  if (needsUpdate) {
    if (Object.keys(unsetFields).length > 0) {
      update.$unset = unsetFields;
    }
    return update;
  }
  
  return null;
};

/**
 * Main migration function
 */
const migrateProducts = async () => {
  try {
    console.log('🚀 Starting Product styleCodes migration...\n');
    
    // Use MongoDB native collection to query for products with old format
    const db = mongoose.connection.db;
    const productsCollection = db.collection('products');
    
    // Find products that have styleCode or eanCode fields (old format)
    const productsWithOldFormat = await productsCollection.find({
      $or: [
        { styleCode: { $exists: true } },
        { eanCode: { $exists: true } }
      ]
    }).toArray();
    
    console.log(`📊 Found ${productsWithOldFormat.length} products with old format to migrate\n`);
    
    if (productsWithOldFormat.length === 0) {
      console.log('ℹ️  No products with old format found. Checking for products needing mrp updates...');
      
      // Check for products with styleCodes but missing mrp
      const productsWithStyleCodes = await productsCollection.find({
        styleCodes: { $exists: true, $type: 'array' }
      }).toArray();
      
      let mrpUpdated = 0;
      for (const product of productsWithStyleCodes) {
        const needsMrpUpdate = product.styleCodes.some(item => 
          item.mrp === undefined || item.mrp === null || isNaN(item.mrp)
        );
        
        if (needsMrpUpdate) {
          const updatedStyleCodes = product.styleCodes.map(item => ({
            styleCode: String(item.styleCode || '').trim(),
            eanCode: String(item.eanCode || '').trim(),
            mrp: typeof item.mrp === 'number' ? item.mrp : 0,
          }));
          
          await productsCollection.updateOne(
            { _id: product._id },
            { $set: { styleCodes: updatedStyleCodes } }
          );
          mrpUpdated++;
        }
      }
      
      if (mrpUpdated > 0) {
        console.log(`✅ Updated ${mrpUpdated} products with missing mrp values`);
      }
      
      return { updated: mrpUpdated, skipped: productsWithStyleCodes.length - mrpUpdated, errors: 0 };
    }
    
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const batchSize = 50;
    
    // Process products in batches
    for (let i = 0; i < productsWithOldFormat.length; i += batchSize) {
      const batch = productsWithOldFormat.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} products)...`);
      
      const batchPromises = batch.map(async (product) => {
        try {
          const update = transformProduct(product);
          
          if (!update) {
            skippedCount++;
            return;
          }
          
          // Prepare update operation using native MongoDB
          const updateOperation = {};
          
          if (update.$unset) {
            // Use updateOne with $set and $unset
            updateOperation.$set = { styleCodes: update.styleCodes };
            updateOperation.$unset = update.$unset;
          } else {
            // Only $set operation
            updateOperation.$set = { styleCodes: update.styleCodes };
          }
          
          await productsCollection.updateOne(
            { _id: product._id },
            updateOperation
          );
          
          updatedCount++;
          const productName = product.name || product.softwareCode || product._id;
          if (updatedCount % 10 === 0) {
            console.log(`   ✅ Updated ${updatedCount} products...`);
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
    
    console.log('\n📈 Migration Summary:');
    console.log(`✅ Successfully updated: ${updatedCount} products`);
    console.log(`⏭️  Skipped (already in new format): ${skippedCount} products`);
    console.log(`❌ Failed updates: ${errorCount} products`);
    console.log(`📊 Total products processed: ${productsWithOldFormat.length}`);
    
    if (errorCount === 0) {
      console.log('\n🎉 Product styleCodes migration completed successfully!');
    } else {
      console.log('\n⚠️  Some products failed to update. Check the errors above.');
    }
    
    return { updated: updatedCount, skipped: skippedCount, errors: errorCount };
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
};

/**
 * Verify migration results
 */
const verifyMigration = async () => {
  try {
    console.log('\n🔍 Verifying migration results...\n');
    
    // Use MongoDB native collection for verification
    const db = mongoose.connection.db;
    const productsCollection = db.collection('products');
    
    const totalProducts = await productsCollection.countDocuments({});
    const productsWithOldFormat = await productsCollection.countDocuments({
      $or: [
        { styleCode: { $exists: true } },
        { eanCode: { $exists: true } }
      ]
    });
    
    const productsWithNewFormat = await productsCollection.countDocuments({
      styleCodes: { $exists: true, $type: 'array', $ne: [] }
    });
    
    // Check for missing mrp in styleCodes
    const productsWithStyleCodes = await productsCollection.find({
      styleCodes: { $exists: true, $type: 'array' }
    }).toArray();
    
    let productsWithMissingMrp = 0;
    let productsWithEmptyStyleCodes = 0;
    
    for (const product of productsWithStyleCodes) {
      if (!Array.isArray(product.styleCodes) || product.styleCodes.length === 0) {
        productsWithEmptyStyleCodes++;
        continue;
      }
      
      const hasMissingMrp = product.styleCodes.some(item => 
        item.mrp === undefined || item.mrp === null || isNaN(item.mrp)
      );
      
      if (hasMissingMrp) {
        productsWithMissingMrp++;
      }
    }
    
    console.log(`\n📊 Verification Summary:`);
    console.log(`✅ Products with new format: ${productsWithNewFormat}`);
    console.log(`❌ Products with old format: ${productsWithOldFormat}`);
    console.log(`⚠️  Products with missing mrp: ${productsWithMissingMrp}`);
    console.log(`⚠️  Products with empty styleCodes: ${productsWithEmptyStyleCodes}`);
    console.log(`📊 Total products: ${totalProducts}`);
    
    if (productsWithOldFormat === 0 && productsWithMissingMrp === 0) {
      console.log('\n🎉 All products are in the new format with valid mrp values!');
    } else {
      console.log('\n⚠️  Some products need attention. Re-run the migration if needed.');
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    
    console.log('\n⚠️  WARNING: This will transform ALL existing products!');
    console.log('Old format (styleCode/eanCode) will be converted to new format (styleCodes array).');
    console.log('Missing mrp values will be set to 0.\n');
    
    await migrateProducts();
    await verifyMigration();
    
  } catch (error) {
    console.error('❌ Migration script failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the migration
main();

