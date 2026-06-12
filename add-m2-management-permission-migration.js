/**
 * Migration Script: Add M2 Management permission to Production Planning navigation
 */

import mongoose from 'mongoose';
import User from './src/models/user.model.js';
import config from './src/config/config.js';
import { connectMongooseForScript } from './scripts/lib/mongoScriptConnect.js';

const PERMISSION_KEY = 'M2 Management';

/**
 * Connect to MongoDB using script-safe URI normalization (SRV expansion, legacy driver fixes).
 * @returns {Promise<void>}
 */
const connectDB = async () => {
  const redactedUri = await connectMongooseForScript(config);
  console.log(`✅ Connected to MongoDB (${redactedUri})`);
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
