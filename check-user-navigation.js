/**
 * Check User Navigation Status
 * 
 * This script checks the current navigation structure of all users
 * to see which ones need migration.
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

// Check user navigation status
const checkUserNavigation = async () => {
  try {
    console.log('🔍 Checking user navigation status...\n');
    
    const users = await User.find({});
    console.log(`📊 Found ${users.length} users\n`);
    
    if (users.length === 0) {
      console.log('ℹ️  No users found.');
      return;
    }
    
    let oldStructureCount = 0;
    let newStructureCount = 0;
    let noNavigationCount = 0;
    
    console.log('User Navigation Status:');
    console.log('=' .repeat(80));
    
    for (const user of users) {
      const nav = user.navigation;
      let status = '';
      
      if (!nav) {
        status = '❌ No navigation';
        noNavigationCount++;
      } else if (nav['Production Planning'] && nav.Catalog && nav.Catalog.Machines !== undefined) {
        status = '✅ New structure';
        newStructureCount++;
      } else if (nav.Production || nav['Production Planning']) {
        status = '⚠️  Old structure (needs migration)';
        oldStructureCount++;
      } else {
        status = '❓ Unknown structure';
      }
      
      console.log(`${user.name.padEnd(30)} | ${user.role.padEnd(10)} | ${status}`);
    }
    
    console.log('=' .repeat(80));
    console.log('\n📈 Summary:');
    console.log(`✅ Users with new structure: ${newStructureCount}`);
    console.log(`⚠️  Users with old structure: ${oldStructureCount}`);
    console.log(`❌ Users with no navigation: ${noNavigationCount}`);
    console.log(`📊 Total users: ${users.length}`);
    
    if (oldStructureCount > 0 || noNavigationCount > 0) {
      console.log('\n💡 Run the migration script to update users with old or missing navigation.');
    } else {
      console.log('\n🎉 All users have the correct navigation structure!');
    }
    
  } catch (error) {
    console.error('❌ Check failed:', error);
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    await checkUserNavigation();
  } catch (error) {
    console.error('❌ Script failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the check
main();
