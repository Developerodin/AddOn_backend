/**
 * Migration Script: Convert countSize ObjectIds to embedded objects in YarnType details
 * 
 * This script converts existing countSize ObjectId references to embedded objects
 * containing _id, name, and status. This ensures data resilience if CountSize 
 * documents are deleted in the future.
 */

import mongoose from 'mongoose';
import YarnType from './src/models/yarnManagement/yarnType.model.js';
import CountSize from './src/models/yarnManagement/countSize.model.js';
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
 * Main migration function
 */
const migrateYarnTypes = async () => {
  try {
    console.log('🔄 Starting migration: Converting countSize ObjectIds to embedded objects...\n');

    const yarnTypes = await YarnType.find({});
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const yarnType of yarnTypes) {
      let needsUpdate = false;
      const updatedDetails = [];

      for (const detail of yarnType.details || []) {
        const updatedDetail = detail.toObject();

        // Check if countSize needs conversion (contains ObjectIds instead of embedded objects)
        if (detail.countSize && detail.countSize.length > 0) {
          const firstItem = detail.countSize[0];
          const isObjectId = mongoose.Types.ObjectId.isValid(firstItem) || 
                            (typeof firstItem === 'string' && mongoose.Types.ObjectId.isValid(firstItem)) ||
                            (firstItem && !firstItem.name);
          
          if (isObjectId) {
            try {
              // Convert ObjectIds to embedded objects
              const countSizeIds = detail.countSize.map(id => 
                mongoose.Types.ObjectId.isValid(id) ? id : new mongoose.Types.ObjectId(id)
              );
              
              // Fetch CountSize documents
              const countSizes = await CountSize.find({ _id: { $in: countSizeIds } });
              
              // Create a map of fetched CountSizes
              const fetchedMap = new Map();
              countSizes.forEach(cs => {
                fetchedMap.set(cs._id.toString(), {
                  _id: cs._id,
                  name: cs.name,
                  status: cs.status,
                });
              });
              
              // Convert to embedded objects: use fetched data if available, otherwise mark as deleted
              updatedDetail.countSize = countSizeIds.map((id) => {
                const idStr = id.toString();
                return fetchedMap.get(idStr) || {
                  _id: id,
                  name: 'Unknown',
                  status: 'deleted',
                };
              });
              
              // Remove old countSizeNames field if it exists
              if (updatedDetail.countSizeNames) {
                delete updatedDetail.countSizeNames;
              }
              
              needsUpdate = true;
              console.log(`  ✓ Converted countSize for yarnType "${yarnType.name}" - subtype: "${detail.subtype}"`);
            } catch (error) {
              console.error(`  ❌ Error processing detail for yarnType "${yarnType.name}":`, error.message);
              errorCount++;
              // Keep existing detail as-is on error
              updatedDetails.push(updatedDetail);
              continue;
            }
          } else {
            // Already embedded objects, but remove countSizeNames if it exists
            if (updatedDetail.countSizeNames) {
              delete updatedDetail.countSizeNames;
              needsUpdate = true;
            }
          }
        } else {
          // No countSize, ensure empty array and remove countSizeNames if exists
          updatedDetail.countSize = [];
          if (updatedDetail.countSizeNames) {
            delete updatedDetail.countSizeNames;
            needsUpdate = true;
          }
        }

        updatedDetails.push(updatedDetail);
      }

      if (needsUpdate) {
        try {
          yarnType.details = updatedDetails;
          await yarnType.save();
          updatedCount++;
          console.log(`✅ Updated yarnType: "${yarnType.name}"`);
        } catch (error) {
          console.error(`❌ Error saving yarnType "${yarnType.name}":`, error.message);
          errorCount++;
        }
      } else {
        skippedCount++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`  ✅ Updated: ${updatedCount} yarnTypes`);
    console.log(`  ⏭️  Skipped: ${skippedCount} yarnTypes (already up to date)`);
    console.log(`  ❌ Errors: ${errorCount} yarnTypes`);
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
    await migrateYarnTypes();
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

