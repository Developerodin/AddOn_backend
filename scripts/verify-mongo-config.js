#!/usr/bin/env node
/**
 * Prints the Mongo URI/options the API will use (same as src/index.js).
 * Run on EC2 after editing .env, before/after pm2 restart.
 *
 *   node scripts/verify-mongo-config.js
 */
import 'dotenv/config';
import config from '../src/config/config.js';
import { redactMongoUri } from '../src/config/mongoUri.js';

console.log('cwd:', process.cwd());
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('MONGODB_URL (raw env):', redactMongoUri(process.env.MONGODB_URL || ''));
console.log('MONGODB_RETRY_WRITES:', process.env.MONGODB_RETRY_WRITES ?? '(unset → false)');
console.log('config.mongoose.url:', redactMongoUri(config.mongoose.url));
console.log('config.mongoose.options:', config.mongoose.options);

const bad =
  /retryWrites=true/i.test(config.mongoose.url) || config.mongoose.options.retryWrites === true;
if (bad) {
  console.error('\n❌ retryWrites still ENABLED — API will 500 on standalone MongoDB');
  process.exit(1);
}
console.log('\n✅ retryWrites disabled — URI/options look correct for standalone MongoDB');
