/**
 * Migration Script: Add M3 Management permission to Production Planning navigation
 */

import mongoose from 'mongoose';
import User from './src/models/user.model.js';
import config from './src/config/config.js';

const PERMISSION_KEY = 'M3 Management';

const connectDB = async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  console.log('✅ Connected to MongoDB');
};

const getDefaultPermission = (productionPlanning, role) => {
  if (role === 'admin') return true;
  if (productionPlanning?.['Checking Floor'] === true) return true;
  if (productionPlanning?.['Final Checking Floor'] === true) return true;
  if (productionPlanning?.['M4 Management'] === true) return true;
  return false;
};

const run = async () => {
  await connectDB();
  let updated = 0;
  const users = await User.find({});

  for (const user of users) {
    const navigation = user.navigation || {};
    if (!navigation['Production Planning']) navigation['Production Planning'] = {};
    const pp = navigation['Production Planning'];

    if (pp[PERMISSION_KEY] === undefined) {
      pp[PERMISSION_KEY] = getDefaultPermission(pp, user.role);
      user.navigation = navigation;
      user.markModified('navigation');
      await user.save();
      updated += 1;
      console.log(`Updated ${user.email || user._id}: ${PERMISSION_KEY}=${pp[PERMISSION_KEY]}`);
    }
  }

  console.log(`\n✅ Done. Updated ${updated} of ${users.length} users.`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
