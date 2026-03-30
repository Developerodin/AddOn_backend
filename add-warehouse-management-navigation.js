#!/usr/bin/env node

/**
 * Migration script to add Warehouse Management navigation field to existing users
 * This script will:
 * 1. Connect to MongoDB
 * 2. Find all existing users
 * 3. Add the Warehouse Management field with all subfields set to false (default)
 * 4. Update the users in the database
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import config from './src/config/config.js';
import User from './src/models/user.model.js';

// Load environment variables
dotenv.config();

// Warehouse Management navigation structure
const warehouseManagementNavigation = {
  'Orders': false,
  'Inward': false,
  'Clients': false,
  'Pick&Pack': false,
  'Layout': false,
  'Stock': false,
  'Reports': false
};

async function addWarehouseManagementToUsers() {
  try {
    console.log('🚀 Starting migration: Adding Warehouse Management navigation to existing users...');
    
    // Connect to MongoDB
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('✅ Connected to MongoDB');

    // Find all users
    const users = await User.find({});
    console.log(`📊 Found ${users.length} users to update`);

    if (users.length === 0) {
      console.log('ℹ️  No users found. Migration completed.');
      return;
    }

    let updatedCount = 0;
    let skippedCount = 0;

    // Process each user
    for (const user of users) {
      try {
        // Check if user already has Warehouse Management field
        if (user.navigation && user.navigation['Warehouse Management']) {
          console.log(`⏭️  Skipping user ${user.email} - Warehouse Management already exists`);
          skippedCount++;
          continue;
        }

        // Initialize navigation if it doesn't exist
        if (!user.navigation) {
          user.navigation = {};
        }

        // Add Warehouse Management field
        user.navigation['Warehouse Management'] = warehouseManagementNavigation;

        // Mark the navigation field as modified to ensure it gets saved
        user.markModified('navigation');

        // Save the user
        await user.save();
        console.log(`✅ Updated user: ${user.email}`);
        updatedCount++;

      } catch (error) {
        console.error(`❌ Error updating user ${user.email}:`, error.message);
      }
    }

    console.log('\n📈 Migration Summary:');
    console.log(`✅ Successfully updated: ${updatedCount} users`);
    console.log(`⏭️  Skipped (already exists): ${skippedCount} users`);
    console.log(`📊 Total processed: ${users.length} users`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run the migration
addWarehouseManagementToUsers()
  .then(() => {
    console.log('🎉 Migration completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  });

