/**
 * One-off: set Help & Support navigation to false for all users (opt-in module).
 * Re-enable per user from Users → Navigation Permissions.
 *
 * Usage: node scripts/reset-help-support-navigation.js
 */
import config from '../src/config/config.js';
import { connectMongooseForScript } from './lib/mongoScriptConnect.js';
import mongoose from 'mongoose';

async function main() {
  const redacted = await connectMongooseForScript(config);
  console.log('Connected:', redacted);

  const result = await mongoose.connection.db.collection('users').updateMany(
    {},
    { $set: { 'navigation.Help & Support': false } }
  );

  console.log(
    `Updated ${result.modifiedCount ?? result.nModified ?? 0} user(s); Help & Support is now off unless re-enabled per user.`
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
