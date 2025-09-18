/**
 * Update User Navigation - Simple Migration Script
 * 
 * This script updates existing users to have the new navigation structure.
 * Run this after updating the navigation structure in your models.
 */

import mongoose from 'mongoose';
import User from './src/models/user.model.js';
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

// Update user navigation to new structure
const updateUserNavigation = async () => {
  try {
    console.log('🚀 Updating user navigation structure...\n');
    
    // Get all users
    const users = await User.find({});
    console.log(`📊 Found ${users.length} users to update\n`);
    
    if (users.length === 0) {
      console.log('ℹ️  No users found. Nothing to update.');
      return;
    }
    
    let updatedCount = 0;
    let skippedCount = 0;
    
    for (const user of users) {
      try {
        console.log(`👤 Processing user: ${user.name} (${user.email})`);
        
        // Check if user already has new structure
        if (user.navigation && 
            user.navigation['Production Planning'] && 
            user.navigation.Catalog && 
            user.navigation.Catalog.Machines !== undefined) {
          console.log(`   ✅ Already has new structure - skipping`);
          skippedCount++;
          continue;
        }
        
        // Create new navigation structure based on user role
        let newNavigation;
        
        if (user.role === 'admin') {
          // Admin gets access to everything
          newNavigation = {
            Dashboard: true,
            Catalog: {
              Items: true,
              Categories: true,
              'Raw Material': true,
              Processes: true,
              Attributes: true,
              Machines: true
            },
            Sales: {
              'All Sales': true,
              'Master Sales': true
            },
            Stores: true,
            Analytics: true,
            'Replenishment Agent': true,
            'File Manager': true,
            Users: true,
            'Production Planning': {
              'Production Orders': true,
              'Knitting Floor': true,
              'Linking Floor': true,
              'Checking Floor': true,
              'Washing Floor': true,
              'Boarding Floor': true,
              'Final Checking Floor': true,
              'Branding Floor': true,
              'Warehouse Floor': true
            }
          };
        } else {
          // Regular user gets basic access
          newNavigation = {
            Dashboard: true,
            Catalog: {
              Items: true,
              Categories: false,
              'Raw Material': false,
              Processes: false,
              Attributes: false,
              Machines: false
            },
            Sales: {
              'All Sales': true,
              'Master Sales': false
            },
            Stores: false,
            Analytics: false,
            'Replenishment Agent': false,
            'File Manager': false,
            Users: false,
            'Production Planning': {
              'Production Orders': false,
              'Knitting Floor': false,
              'Linking Floor': false,
              'Checking Floor': false,
              'Washing Floor': false,
              'Boarding Floor': false,
              'Final Checking Floor': false,
              'Branding Floor': false,
              'Warehouse Floor': false
            }
          };
        }
        
        // Update user with new navigation
        await User.findByIdAndUpdate(
          user._id,
          { navigation: newNavigation },
          { new: true }
        );
        
        console.log(`   ✅ Updated navigation for ${user.role} user`);
        updatedCount++;
        
      } catch (error) {
        console.error(`   ❌ Error updating user ${user.name}:`, error.message);
      }
    }
    
    console.log('\n📈 Update Summary:');
    console.log(`✅ Successfully updated: ${updatedCount} users`);
    console.log(`⏭️  Skipped (already updated): ${skippedCount} users`);
    console.log(`📊 Total users processed: ${users.length}`);
    
    if (updatedCount > 0) {
      console.log('\n🎉 Navigation update completed successfully!');
    } else {
      console.log('\nℹ️  All users already have the correct navigation structure.');
    }
    
  } catch (error) {
    console.error('❌ Update failed:', error);
    throw error;
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    await updateUserNavigation();
  } catch (error) {
    console.error('❌ Script failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the update
main();
