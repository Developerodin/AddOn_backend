/**
 * Migration Script: Add Machine Floor to Production Planning
 * 
 * This script adds the new "Machine Floor" permission to existing users
 * in the Production Planning section of their navigation.
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

/**
 * Add Machine Floor to user's Production Planning navigation
 * @param {Object} user - User document
 * @returns {Object} Updated navigation object
 */
const addMachineFloorToUser = (user) => {
  const navigation = user.navigation || {};
  
  // Ensure Production Planning exists
  if (!navigation['Production Planning']) {
    navigation['Production Planning'] = {};
  }
  
  // Add Machine Floor if it doesn't exist
  if (navigation['Production Planning']['Machine Floor'] === undefined) {
    // Set default permission based on role
    navigation['Production Planning']['Machine Floor'] = user.role === 'admin';
    return true; // Indicates update needed
  }
  
  return false; // No update needed
};

/**
 * Main migration function
 */
const migrateUsers = async () => {
  try {
    console.log('🚀 Starting Machine Floor migration...');
    
    // Get all users
    const users = await User.find({});
    console.log(`📊 Found ${users.length} users to check`);
    
    if (users.length === 0) {
      console.log('ℹ️  No users found. Migration complete.');
      return;
    }
    
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const user of users) {
      try {
        console.log(`\n👤 Processing user: ${user.name} (${user.email})`);
        
        // Check if Machine Floor already exists
        if (user.navigation && 
            user.navigation['Production Planning'] && 
            user.navigation['Production Planning']['Machine Floor'] !== undefined) {
          console.log(`   ✅ Machine Floor already exists - skipping`);
          skippedCount++;
          continue;
        }
        
        // Add Machine Floor to user's navigation
        const needsUpdate = addMachineFloorToUser(user);
        
        if (needsUpdate) {
          // Update user in database
          await User.findByIdAndUpdate(
            user._id,
            { navigation: user.navigation },
            { new: true }
          );
          
          const permission = user.navigation['Production Planning']['Machine Floor'] ? 'enabled' : 'disabled';
          console.log(`   ✅ Added Machine Floor (${permission}) for ${user.role} user`);
          updatedCount++;
        } else {
          console.log(`   ⏭️  No update needed`);
          skippedCount++;
        }
        
      } catch (error) {
        console.error(`   ❌ Error processing user ${user.name}:`, error.message);
        errorCount++;
      }
    }
    
    console.log('\n📈 Migration Summary:');
    console.log(`✅ Successfully updated: ${updatedCount} users`);
    console.log(`⏭️  Skipped (already has Machine Floor): ${skippedCount} users`);
    console.log(`❌ Failed updates: ${errorCount} users`);
    console.log(`📊 Total users processed: ${users.length}`);
    
    if (errorCount === 0) {
      console.log('\n🎉 Machine Floor migration completed successfully!');
    } else {
      console.log('\n⚠️  Some users failed to update. Check the errors above.');
    }
    
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
    console.log('\n🔍 Verifying migration results...');
    
    const users = await User.find({});
    let usersWithMachineFloor = 0;
    let usersWithoutMachineFloor = 0;
    
    for (const user of users) {
      const nav = user.navigation;
      
      // Check if Machine Floor exists
      const hasMachineFloor = nav && 
        nav['Production Planning'] && 
        nav['Production Planning']['Machine Floor'] !== undefined;
      
      if (hasMachineFloor) {
        usersWithMachineFloor++;
        const permission = nav['Production Planning']['Machine Floor'] ? 'enabled' : 'disabled';
        console.log(`✅ ${user.name} (${user.role}): Machine Floor ${permission}`);
      } else {
        console.log(`❌ ${user.name}: Missing Machine Floor`);
        usersWithoutMachineFloor++;
      }
    }
    
    console.log(`\n📊 Verification Summary:`);
    console.log(`✅ Users with Machine Floor: ${usersWithMachineFloor}`);
    console.log(`❌ Users without Machine Floor: ${usersWithoutMachineFloor}`);
    
    if (usersWithoutMachineFloor === 0) {
      console.log('\n🎉 All users now have Machine Floor in their navigation!');
    } else {
      console.log('\n⚠️  Some users are missing Machine Floor. Re-run the migration.');
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    
    console.log('\n⚠️  WARNING: This will add Machine Floor to ALL existing users!');
    console.log('Admins will get Machine Floor enabled, regular users will have it disabled.');
    
    await migrateUsers();
    await verifyMigration();
    
  } catch (error) {
    console.error('❌ Migration script failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the migration
main();
