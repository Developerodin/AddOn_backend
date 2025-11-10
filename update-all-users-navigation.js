#!/usr/bin/env node

/**
 * Migration script to update ALL users with complete navigation structure
 * This script will:
 * 1. Connect to MongoDB
 * 2. Find all existing users
 * 3. Update each user with complete navigation structure based on their role
 * 4. Includes all navigation items: Dashboard, Catalog, Sales, Stores, Analytics,
 *    Replenishment Agent, File Manager, Users, Production Planning, 
 *    Yarn Management (with Yarn Master), Warehouse Management
 * 5. Sets permissions based on user role (admin: all true, user: defaults)
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

async function updateAllUsersNavigation() {
  try {
    // Dynamic imports after environment is set up
    const configModule = await import('./src/config/config.js');
    const config = configModule.default;
    const UserModule = await import('./src/models/user.model.js');
    const User = UserModule.default;
    const navigationHelper = await import('./src/utils/navigationHelper.js');
    const { ROLE_NAVIGATION_TEMPLATES, DEFAULT_NAVIGATION } = navigationHelper;

    /**
     * Get complete navigation structure for a user based on their role
     * @param {string} role - User role ('admin' or 'user')
     * @returns {Object} Complete navigation object
     */
    const getCompleteNavigation = (role) => {
      // Use role templates if available, otherwise use default
      if (ROLE_NAVIGATION_TEMPLATES[role]) {
        return JSON.parse(JSON.stringify(ROLE_NAVIGATION_TEMPLATES[role])); // Deep clone
      }
      return JSON.parse(JSON.stringify(DEFAULT_NAVIGATION)); // Deep clone
    };

    console.log('🚀 Starting migration: Updating ALL users with complete navigation structure...\n');
    
    // Connect to MongoDB
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('✅ Connected to MongoDB\n');

    // Find all users
    const users = await User.find({});
    console.log(`📊 Found ${users.length} users to update\n`);

    if (users.length === 0) {
      console.log('ℹ️  No users found. Migration completed.');
      return;
    }

    let updatedCount = 0;
    let errorCount = 0;
    const roleStats = {
      admin: 0,
      user: 0,
      other: 0
    };

    // Process each user
    for (const user of users) {
      try {
        console.log(`👤 Processing user: ${user.name} (${user.email}) - Role: ${user.role || 'user'}`);
        
        // Get complete navigation structure based on role
        const completeNavigation = getCompleteNavigation(user.role || 'user');
        
        // Update user with complete navigation
        user.navigation = completeNavigation;
        user.markModified('navigation');
        
        // Save the user
        await user.save();
        
        // Track role statistics
        const role = user.role || 'user';
        if (role === 'admin') {
          roleStats.admin++;
        } else if (role === 'user') {
          roleStats.user++;
        } else {
          roleStats.other++;
        }
        
        console.log(`   ✅ Updated navigation for ${role} user`);
        updatedCount++;

      } catch (error) {
        console.error(`   ❌ Error updating user ${user.email}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📈 Migration Summary:');
    console.log('='.repeat(80));
    console.log(`✅ Successfully updated: ${updatedCount} users`);
    console.log(`❌ Failed updates: ${errorCount} users`);
    console.log(`📊 Total processed: ${users.length} users\n`);
    
    console.log('📊 Updates by Role:');
    console.log(`   👑 Admin users: ${roleStats.admin}`);
    console.log(`   👤 Regular users: ${roleStats.user}`);
    if (roleStats.other > 0) {
      console.log(`   ❓ Other roles: ${roleStats.other}`);
    }
    
    console.log('\n✨ Navigation structure includes:');
    console.log('   • Dashboard');
    console.log('   • Catalog (Items, Categories, Raw Material, Processes, Attributes, Machines)');
    console.log('   • Sales (All Sales, Master Sales)');
    console.log('   • Stores');
    console.log('   • Analytics');
    console.log('   • Replenishment Agent');
    console.log('   • File Manager');
    console.log('   • Users');
    console.log('   • Production Planning (all floors)');
    console.log('   • Yarn Management (Cataloguing, Purchase, Inventory, Yarn Issue)');
    console.log('   • Yarn Master (Brand, Yarn Type, Count/Size, Color)');
    console.log('   • Warehouse Management (Orders, Pick&Pack, Layout, Stock, Reports)');

    if (updatedCount > 0) {
      console.log('\n🎉 Navigation update completed successfully!');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('\n🔌 MongoDB connection closed');
  }
}

// Run the migration
updateAllUsersNavigation()
  .then(() => {
    console.log('\n✅ All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  });

