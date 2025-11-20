/**
 * Migration Script: Remove unique indexes from colors collection
 * 
 * This script removes the unique indexes on 'name' and 'colorCode' fields
 * from the colors collection to allow duplicate values.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Set default NODE_ENV if not set
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

// Connect to MongoDB
const connectDB = async () => {
  try {
    const mongoUrl = process.env.MONGODB_URL;
    if (!mongoUrl) {
      throw new Error('MONGODB_URL environment variable is required');
    }
    
    await mongoose.connect(mongoUrl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

/**
 * Main migration function
 */
const removeUniqueIndexes = async () => {
  try {
    console.log('🔄 Starting migration: Removing unique indexes from colors collection...\n');

    const db = mongoose.connection.db;
    const collection = db.collection('colors');

    // Get all indexes
    const indexes = await collection.indexes();
    console.log('📋 Current indexes:', indexes.map(idx => idx.name).join(', '));

    let droppedCount = 0;

    // Drop name_1 index if it exists
    try {
      await collection.dropIndex('name_1');
      console.log('✅ Dropped index: name_1');
      droppedCount++;
    } catch (error) {
      if (error.code === 27 || error.message.includes('index not found')) {
        console.log('⏭️  Index name_1 does not exist, skipping...');
      } else {
        console.error('❌ Error dropping name_1 index:', error.message);
      }
    }

    // Drop colorCode_1 index if it exists
    try {
      await collection.dropIndex('colorCode_1');
      console.log('✅ Dropped index: colorCode_1');
      droppedCount++;
    } catch (error) {
      if (error.code === 27 || error.message.includes('index not found')) {
        console.log('⏭️  Index colorCode_1 does not exist, skipping...');
      } else {
        console.error('❌ Error dropping colorCode_1 index:', error.message);
      }
    }

    // Drop compound unique index if it exists (name_1_colorCode_1)
    try {
      await collection.dropIndex('name_1_colorCode_1');
      console.log('✅ Dropped index: name_1_colorCode_1');
      droppedCount++;
    } catch (error) {
      if (error.code === 27 || error.message.includes('index not found')) {
        console.log('⏭️  Index name_1_colorCode_1 does not exist, skipping...');
      } else {
        console.error('❌ Error dropping name_1_colorCode_1 index:', error.message);
      }
    }

    // List remaining indexes
    const remainingIndexes = await collection.indexes();
    console.log('\n📋 Remaining indexes:', remainingIndexes.map(idx => idx.name).join(', '));

    console.log('\n📊 Migration Summary:');
    console.log(`  ✅ Dropped: ${droppedCount} unique index(es)`);
    console.log('\n✨ Migration completed!');
    console.log('💡 You can now create colors with duplicate names and colorCodes.');

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
    await removeUniqueIndexes();
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

