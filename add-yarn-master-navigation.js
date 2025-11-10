#!/usr/bin/env node

/**
 * Migration script to add Yarn Master navigation field to existing users
 * This script will:
 * 1. Connect to MongoDB
 * 2. Find all existing users
 * 3. Add the Yarn Master field with subfields (Brand, Yarn Type, Count/Size, Color) to users who have Yarn Management
 * 4. Set permissions based on user role (admin: true, user: false)
 * 5. Update the users in the database
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

async function addYarnMasterToUsers() {
  try {
    // Dynamic imports after environment is set up
    const configModule = await import('./src/config/config.js');
    const config = configModule.default;
    const UserModule = await import('./src/models/user.model.js');
    const User = UserModule.default;

    // Yarn Master navigation structure
    const getYarnMasterNavigation = (userRole) => {
      const isAdmin = userRole === 'admin';
      return {
        'Brand': isAdmin,
        'Yarn Type': isAdmin,
        'Count/Size': isAdmin,
        'Color': isAdmin
      };
    };

    console.log('🚀 Starting migration: Adding Yarn Master navigation to existing users...');
    
    // Connect to MongoDB
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('✅ Connected to MongoDB');

    // Find all users
    const users = await User.find({});
    console.log(`📊 Found ${users.length} users to check`);

    if (users.length === 0) {
      console.log('ℹ️  No users found. Migration completed.');
      return;
    }

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Process each user
    for (const user of users) {
      try {
        // Check if user has Yarn Management navigation
        if (!user.navigation || !user.navigation['Yarn Management']) {
          console.log(`⏭️  Skipping user ${user.email} - Yarn Management not found`);
          skippedCount++;
          continue;
        }

        // Check if Yarn Master already exists
        if (user.navigation['Yarn Management']['Yarn Master']) {
          console.log(`⏭️  Skipping user ${user.email} - Yarn Master already exists`);
          skippedCount++;
          continue;
        }

        // Initialize Yarn Management if needed
        if (!user.navigation['Yarn Management']) {
          user.navigation['Yarn Management'] = {};
        }

        // Add Yarn Master field with permissions based on role
        user.navigation['Yarn Management']['Yarn Master'] = getYarnMasterNavigation(user.role);

        // Mark the navigation field as modified to ensure it gets saved
        user.markModified('navigation');

        // Save the user
        await user.save();
        const permissionStatus = user.role === 'admin' ? 'enabled' : 'disabled';
        console.log(`✅ Updated user: ${user.email} (${user.role}) - Yarn Master ${permissionStatus}`);
        updatedCount++;

      } catch (error) {
        console.error(`❌ Error updating user ${user.email}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n📈 Migration Summary:');
    console.log(`✅ Successfully updated: ${updatedCount} users`);
    console.log(`⏭️  Skipped (already exists or no Yarn Management): ${skippedCount} users`);
    console.log(`❌ Failed updates: ${errorCount} users`);
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
addYarnMasterToUsers()
  .then(() => {
    console.log('🎉 Migration completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  });

