/**
 * Migration Script: Update yarnName to include pantonName
 * 
 * This script regenerates yarnName for all existing yarn catalogs to include
 * pantonName in the format: countSize-colorFamily-pantonName-yarnType/subtype
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables FIRST
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Set NODE_ENV if not already set (must be before importing config)
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

import YarnCatalog from './src/models/yarnManagement/yarnCatalog.model.js';
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
 * Generate yarnName based on the new format
 */
const generateYarnName = (doc) => {
  const parts = [];
  
  // Get countSize name
  if (doc.countSize && doc.countSize.name) {
    parts.push(doc.countSize.name);
  }
  
  // Get colorFamily name (optional)
  if (doc.colorFamily && doc.colorFamily.name) {
    parts.push(doc.colorFamily.name);
  }
  
  // Get pantonName (optional)
  if (doc.pantonName && doc.pantonName.trim()) {
    parts.push(doc.pantonName.trim());
  }
  
  // Get yarnType name
  if (doc.yarnType && doc.yarnType.name) {
    let typePart = doc.yarnType.name;
    
    // Handle yarnSubtype
    if (doc.yarnSubtype && doc.yarnSubtype.subtype) {
      typePart += `/${doc.yarnSubtype.subtype}`;
    }
    
    parts.push(typePart);
  }
  
  // Generate yarnName: countSize-colorFamily-pantonName-yarnType/subtype
  if (parts.length > 0) {
    return parts.join('-');
  }
  
  return null;
};

/**
 * Main migration function
 */
const migrateYarnCatalogs = async () => {
  try {
    console.log('🔄 Starting migration: Updating yarnName to include pantonName...\n');

    const yarnCatalogs = await YarnCatalog.find({}).lean();
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    console.log(`📊 Found ${yarnCatalogs.length} yarn catalogs to process\n`);

    for (const catalog of yarnCatalogs) {
      try {
        // Generate new yarnName
        const newYarnName = generateYarnName(catalog);
        
        if (!newYarnName) {
          console.log(`  ⚠️  Skipping catalog ${catalog._id} - cannot generate yarnName (missing required fields)`);
          skippedCount++;
          continue;
        }

        // Check if yarnName needs update
        if (catalog.yarnName === newYarnName) {
          skippedCount++;
          continue;
        }

        // Update the yarnName
        await YarnCatalog.updateOne(
          { _id: catalog._id },
          { $set: { yarnName: newYarnName } }
        );

        console.log(`  ✅ Updated: "${catalog.yarnName}" → "${newYarnName}"`);
        updatedCount++;

      } catch (error) {
        console.error(`  ❌ Error processing catalog ${catalog._id}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`  ✅ Updated: ${updatedCount} yarn catalogs`);
    console.log(`  ⏭️  Skipped: ${skippedCount} yarn catalogs (already up to date or missing fields)`);
    console.log(`  ❌ Errors: ${errorCount} yarn catalogs`);
    console.log('\n✨ Migration completed!');

  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  }
};

/**
 * Run migration
 */
const runMigration = async () => {
  try {
    await connectDB();
    await migrateYarnCatalogs();
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigration();
}

export default runMigration;

