/**
 * Migration Script: Add the new warehouse fulfilment-flow navigation entries
 * (Scanning, Billing, Returns) under 'Warehouse Management' for existing users.
 *
 * Defaults: false for everyone except admins (true), matching the pattern of
 * add-warehouse-management-navigation.js. Idempotent: skips keys already present.
 */

import mongoose from 'mongoose';
import config from './src/config/config.js';
import User from './src/models/user.model.js';
import { connectMongooseForScript } from './scripts/lib/mongoScriptConnect.js';

const NEW_KEYS = ['Scanning', 'Billing', 'Dispatch', 'Returns'];

const run = async () => {
  const redactedUri = await connectMongooseForScript(config);
  console.log(`✅ Connected to MongoDB (${redactedUri})`);

  const users = await User.find({});
  console.log(`📊 Found ${users.length} users`);

  let updated = 0;
  for (const user of users) {
    const navigation = user.navigation || {};
    if (!navigation['Warehouse Management']) navigation['Warehouse Management'] = {};
    const wm = navigation['Warehouse Management'];

    let touched = false;
    for (const key of NEW_KEYS) {
      if (wm[key] === undefined) {
        wm[key] = user.role === 'admin' || user.role === 'super_admin';
        touched = true;
      }
    }

    if (touched) {
      user.navigation = navigation;
      user.markModified('navigation');
      await user.save();
      updated += 1;
      console.log(`✅ Updated ${user.email || user._id}`);
    }
  }

  console.log(`\n✅ Done. Updated ${updated} of ${users.length} users.`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
