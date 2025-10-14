#!/usr/bin/env node

/**
 * Test script to verify the Yarn Management migration
 * This script will:
 * 1. Connect to MongoDB
 * 2. Check if users have the Yarn Management field
 * 3. Display the navigation structure
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import config from './src/config/config.js';
import User from './src/models/user.model.js';

// Load environment variables
dotenv.config();

async function testYarnManagementMigration() {
  try {
    console.log('🧪 Testing Yarn Management migration...');
    
    // Connect to MongoDB
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('✅ Connected to MongoDB');

    // Find all users
    const users = await User.find({}).limit(5); // Limit to first 5 users for testing
    console.log(`📊 Found ${users.length} users to check`);

    if (users.length === 0) {
      console.log('ℹ️  No users found.');
      return;
    }

    // Check each user's navigation structure
    users.forEach((user, index) => {
      console.log(`\n👤 User ${index + 1}: ${user.email}`);
      console.log('📋 Navigation structure:');
      
      if (user.navigation && user.navigation['Yarn Management']) {
        console.log('✅ Yarn Management field exists:');
        console.log(JSON.stringify(user.navigation['Yarn Management'], null, 2));
      } else {
        console.log('❌ Yarn Management field missing');
      }
    });

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('\n🔌 MongoDB connection closed');
  }
}

// Run the test
testYarnManagementMigration()
  .then(() => {
    console.log('\n🎉 Test completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Test failed:', error);
    process.exit(1);
  });
