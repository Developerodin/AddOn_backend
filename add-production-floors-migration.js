/**
 * Migration Script: Add Silicon Floor and Secondary Checking Floor to Production Planning
 * 
 * This script adds the new "Silicon Floor" and "Secondary Checking Floor" permissions
 * to existing users in the Production Planning section of their navigation.
 * 
 * The new floors are added in the correct order:
 * - Silicon Floor (after Boarding Floor)
 * - Secondary Checking Floor (after Silicon Floor, before Branding Floor)
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
 * Determine default permission for new floors based on user's existing Production Planning permissions
 * @param {Object} productionPlanning - User's Production Planning navigation object
 * @param {string} role - User's role
 * @returns {boolean} Default permission value
 */
const getDefaultPermission = (productionPlanning, role) => {
  // If user is admin, give access
  if (role === 'admin') {
    return true;
  }
  
  // Check if user has access to any production floor
  const floors = [
    'Production Orders',
    'Knitting Floor',
    'Linking Floor',
    'Checking Floor',
    'Washing Floor',
    'Boarding Floor',
    'Branding Floor',
    'Final Checking Floor',
    'Machine Floor',
    'Warehouse Floor'
  ];
  
  // If user has access to any floor, give access to new floors
  for (const floor of floors) {
    if (productionPlanning && productionPlanning[floor] === true) {
      return true;
    }
  }
  
  // Default to false for regular users without existing access
  return false;
};

/**
 * Add new floors to user's Production Planning navigation
 * @param {Object} user - User document
 * @returns {Object} Updated navigation object and update status
 */
const addNewFloorsToUser = (user) => {
  const navigation = user.navigation || {};
  let needsUpdate = false;
  
  // Ensure Production Planning exists
  if (!navigation['Production Planning']) {
    navigation['Production Planning'] = {};
    needsUpdate = true;
  }
  
  const productionPlanning = navigation['Production Planning'];
  const defaultPermission = getDefaultPermission(productionPlanning, user.role);
  
  // Add Silicon Floor if it doesn't exist
  if (productionPlanning['Silicon Floor'] === undefined) {
    productionPlanning['Silicon Floor'] = defaultPermission;
    needsUpdate = true;
  }
  
  // Add Secondary Checking Floor if it doesn't exist
  if (productionPlanning['Secondary Checking Floor'] === undefined) {
    productionPlanning['Secondary Checking Floor'] = defaultPermission;
    needsUpdate = true;
  }
  
  return { navigation, needsUpdate };
};

/**
 * Main migration function
 */
const migrateUsers = async () => {
  try {
    console.log('🚀 Starting Production Floors migration...');
    console.log('📋 Adding: Silicon Floor and Secondary Checking Floor\n');
    
    // Get all users
    const users = await User.find({});
    console.log(`📊 Found ${users.length} users to check\n`);
    
    if (users.length === 0) {
      console.log('ℹ️  No users found. Migration complete.');
      return;
    }
    
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    let addedSiliconCount = 0;
    let addedSecondaryCheckingCount = 0;
    
    for (const user of users) {
      try {
        console.log(`👤 Processing user: ${user.name} (${user.email}) - Role: ${user.role || 'user'}`);
        
        // Check if both floors already exist
        const hasSilicon = user.navigation && 
            user.navigation['Production Planning'] && 
            user.navigation['Production Planning']['Silicon Floor'] !== undefined;
        
        const hasSecondaryChecking = user.navigation && 
            user.navigation['Production Planning'] && 
            user.navigation['Production Planning']['Secondary Checking Floor'] !== undefined;
        
        if (hasSilicon && hasSecondaryChecking) {
          console.log(`   ✅ Both floors already exist - skipping`);
          skippedCount++;
          continue;
        }
        
        // Add new floors to user's navigation
        const { navigation, needsUpdate } = addNewFloorsToUser(user);
        
        if (needsUpdate) {
          // Mark navigation as modified
          user.navigation = navigation;
          user.markModified('navigation');
          
          // Save the user
          await user.save();
          
          const siliconPermission = navigation['Production Planning']['Silicon Floor'] ? 'enabled' : 'disabled';
          const secondaryCheckingPermission = navigation['Production Planning']['Secondary Checking Floor'] ? 'enabled' : 'disabled';
          
          if (!hasSilicon) {
            console.log(`   ✅ Added Silicon Floor (${siliconPermission})`);
            addedSiliconCount++;
          }
          
          if (!hasSecondaryChecking) {
            console.log(`   ✅ Added Secondary Checking Floor (${secondaryCheckingPermission})`);
            addedSecondaryCheckingCount++;
          }
          
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
    
    console.log('\n' + '='.repeat(80));
    console.log('📈 Migration Summary:');
    console.log('='.repeat(80));
    console.log(`✅ Successfully updated: ${updatedCount} users`);
    console.log(`⏭️  Skipped (already has both floors): ${skippedCount} users`);
    console.log(`❌ Failed updates: ${errorCount} users`);
    console.log(`📊 Total users processed: ${users.length}\n`);
    
    console.log('📊 Floors Added:');
    console.log(`   🏭 Silicon Floor: ${addedSiliconCount} users`);
    console.log(`   🔍 Secondary Checking Floor: ${addedSecondaryCheckingCount} users`);
    
    if (errorCount === 0) {
      console.log('\n🎉 Production Floors migration completed successfully!');
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
    console.log('='.repeat(80));
    
    const users = await User.find({});
    let usersWithSilicon = 0;
    let usersWithSecondaryChecking = 0;
    let usersWithoutSilicon = 0;
    let usersWithoutSecondaryChecking = 0;
    
    for (const user of users) {
      const nav = user.navigation;
      const productionPlanning = nav && nav['Production Planning'];
      
      // Check Silicon Floor
      const hasSilicon = productionPlanning && 
        productionPlanning['Silicon Floor'] !== undefined;
      
      // Check Secondary Checking Floor
      const hasSecondaryChecking = productionPlanning && 
        productionPlanning['Secondary Checking Floor'] !== undefined;
      
      if (hasSilicon) {
        usersWithSilicon++;
        const permission = productionPlanning['Silicon Floor'] ? 'enabled' : 'disabled';
        console.log(`✅ ${user.name} (${user.role}): Silicon Floor ${permission}`);
      } else {
        usersWithoutSilicon++;
        console.log(`❌ ${user.name}: Missing Silicon Floor`);
      }
      
      if (hasSecondaryChecking) {
        usersWithSecondaryChecking++;
        const permission = productionPlanning['Secondary Checking Floor'] ? 'enabled' : 'disabled';
        console.log(`✅ ${user.name} (${user.role}): Secondary Checking Floor ${permission}`);
      } else {
        usersWithoutSecondaryChecking++;
        console.log(`❌ ${user.name}: Missing Secondary Checking Floor`);
      }
    }
    
    console.log(`\n📊 Verification Summary:`);
    console.log(`✅ Users with Silicon Floor: ${usersWithSilicon}`);
    console.log(`❌ Users without Silicon Floor: ${usersWithoutSilicon}`);
    console.log(`✅ Users with Secondary Checking Floor: ${usersWithSecondaryChecking}`);
    console.log(`❌ Users without Secondary Checking Floor: ${usersWithoutSecondaryChecking}`);
    
    if (usersWithoutSilicon === 0 && usersWithoutSecondaryChecking === 0) {
      console.log('\n🎉 All users now have both new floors in their navigation!');
    } else {
      console.log('\n⚠️  Some users are missing the new floors. Re-run the migration.');
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    
    console.log('\n⚠️  WARNING: This will add Silicon Floor and Secondary Checking Floor to ALL existing users!');
    console.log('Users with existing Production Planning access will get the new floors enabled.');
    console.log('Admins will get both floors enabled, regular users will get them based on existing permissions.\n');
    
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

