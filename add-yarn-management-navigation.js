#!/usr/bin/env node

/**
 * Migration script to add Yarn Management navigation field to existing users
 * This script will:
 * 1. Connect to MongoDB
 * 2. Find all existing users
 * 3. Add the Yarn Management field with all subfields set to true
 * 4. Update the users in the database
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import config from './src/config/config.js';
import User from './src/models/user.model.js';

// Load environment variables
dotenv.config();

// Yarn Management navigation structure
const yarnManagementNavigation = {
  'Cataloguing': true,
  'Purchase': true,
  'Inventory': true,
  'Yarn Issue': true
};

async function addYarnManagementToUsers() {
  try {
    console.log('🚀 Starting migration: Adding Yarn Management navigation to existing users...');
    
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
        // Check if user already has Yarn Management field
        if (user.navigation && user.navigation['Yarn Management']) {
          console.log(`⏭️  Skipping user ${user.email} - Yarn Management already exists`);
          skippedCount++;
          continue;
        }

        // Initialize navigation if it doesn't exist
        if (!user.navigation) {
          user.navigation = {};
        }

        // Add Yarn Management field
        user.navigation['Yarn Management'] = yarnManagementNavigation;

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
addYarnManagementToUsers()
  .then(() => {
    console.log('🎉 Migration completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  });
