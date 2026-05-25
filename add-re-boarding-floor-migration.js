/**
 * Migration Script: Add Re-Boarding Floor to Production Planning navigation
 *
 * Inserts "Re-Boarding Floor" after "Branding Floor" for existing users.
 */

import mongoose from 'mongoose';
import User from './src/models/user.model.js';
import config from './src/config/config.js';

const FLOOR_KEY = 'Re-Boarding Floor';

/**
 * Connect to MongoDB
 * @returns {Promise<void>}
 */
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
 * Default permission when adding Re-Boarding Floor
 * @param {Object} productionPlanning - User Production Planning nav
 * @param {string} role - User role
 * @returns {boolean}
 */
const getDefaultPermission = (productionPlanning, role) => {
  if (role === 'admin') {
    return true;
  }

  const floors = [
    'Production Orders',
    'Knitting Floor',
    'Linking Floor',
    'Checking Floor',
    'Washing Floor',
    'Boarding Floor',
    'Silicon Floor',
    'Secondary Checking Floor',
    'Branding Floor',
    'Re-Boarding Floor',
    'Final Checking Floor',
    'Dispatch Floor',
    'Machine Floor',
    'Warehouse Floor',
  ];

  for (const floor of floors) {
    if (productionPlanning && productionPlanning[floor] === true) {
      return true;
    }
  }

  return false;
};

/**
 * Add Re-Boarding Floor to user navigation if missing
 * @param {Object} user - User document
 * @returns {{ navigation: Object, needsUpdate: boolean }}
 */
const addReBoardingFloorToUser = (user) => {
  const navigation = user.navigation || {};
  let needsUpdate = false;

  if (!navigation['Production Planning']) {
    navigation['Production Planning'] = {};
    needsUpdate = true;
  }

  const productionPlanning = navigation['Production Planning'];

  if (productionPlanning[FLOOR_KEY] === undefined) {
    productionPlanning[FLOOR_KEY] = getDefaultPermission(productionPlanning, user.role);
    needsUpdate = true;
  }

  return { navigation, needsUpdate };
};

/**
 * Run migration for all users
 * @returns {Promise<void>}
 */
const migrateUsers = async () => {
  console.log('🚀 Starting Re-Boarding Floor migration...\n');

  const users = await User.find({});
  console.log(`📊 Found ${users.length} users\n`);

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const user of users) {
    try {
      const hasFloor =
        user.navigation?.['Production Planning']?.[FLOOR_KEY] !== undefined;

      if (hasFloor) {
        skippedCount++;
        continue;
      }

      const { navigation, needsUpdate } = addReBoardingFloorToUser(user);

      if (needsUpdate) {
        user.navigation = navigation;
        user.markModified('navigation');
        await user.save();
        updatedCount++;
        console.log(`✅ ${user.name} (${user.email}): added ${FLOOR_KEY}`);
      } else {
        skippedCount++;
      }
    } catch (error) {
      errorCount++;
      console.error(`❌ ${user.name}: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Updated: ${updatedCount} | Skipped: ${skippedCount} | Errors: ${errorCount}`);
};

/**
 * Verify all users have Re-Boarding Floor key
 * @returns {Promise<void>}
 */
const verifyMigration = async () => {
  const users = await User.find({});
  const missing = users.filter(
    (u) => u.navigation?.['Production Planning']?.[FLOOR_KEY] === undefined
  );

  if (missing.length === 0) {
    console.log('\n🎉 All users have Re-Boarding Floor in navigation.');
  } else {
    console.log(`\n⚠️  ${missing.length} users still missing ${FLOOR_KEY}`);
  }
};

const main = async () => {
  try {
    await connectDB();
    await migrateUsers();
    await verifyMigration();
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
    process.exit(process.exitCode || 0);
  }
};

main();
