/**
 * Migration Script: Add M4 Management permission to Production Planning navigation
 */

import mongoose from 'mongoose';
import User from './src/models/user.model.js';
import config from './src/config/config.js';

const PERMISSION_KEY = 'M4 Management';

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
 * Default permission when adding M4 Management
 * @param {Object} productionPlanning
 * @param {string} role
 * @returns {boolean}
 */
const getDefaultPermission = (productionPlanning, role) => {
  if (role === 'admin') return true;
  if (productionPlanning?.['Knitting Floor'] === true) return true;
  if (productionPlanning?.['Dispatch Floor'] === true) return true;
  if (productionPlanning?.['Final Checking Floor'] === true) return true;
  return false;
};

/**
 * Add M4 Management permission if missing
 * @param {Object} user
 * @returns {{ navigation: Object, needsUpdate: boolean }}
 */
const addM4ManagementPermission = (user) => {
  const navigation = user.navigation || {};
  let needsUpdate = false;

  if (!navigation['Production Planning']) {
    navigation['Production Planning'] = {};
    needsUpdate = true;
  }

  const productionPlanning = navigation['Production Planning'];
  if (productionPlanning[PERMISSION_KEY] === undefined) {
    productionPlanning[PERMISSION_KEY] = getDefaultPermission(productionPlanning, user.role);
    needsUpdate = true;
  }

  return { navigation, needsUpdate };
};

const run = async () => {
  await connectDB();

  const users = await User.find({});
  let updated = 0;

  for (const user of users) {
    const { navigation, needsUpdate } = addM4ManagementPermission(user);
    if (needsUpdate) {
      user.navigation = navigation;
      user.markModified('navigation');
      await user.save();
      updated += 1;
      console.log(`Updated user ${user.email || user._id}: ${PERMISSION_KEY}=${navigation['Production Planning'][PERMISSION_KEY]}`);
    }
  }

  console.log(`\n✅ Done. Updated ${updated} of ${users.length} users.`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
