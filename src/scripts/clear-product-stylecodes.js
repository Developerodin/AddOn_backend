/**
 * Clear legacy embedded styleCodes from all Product documents.
 *
 * Usage:
 *   node src/scripts/clear-product-stylecodes.js
 *   DRY RUN: DRY_RUN=true node src/scripts/clear-product-stylecodes.js
 *
 * Reads Mongo URL from MONGODB_URL in .env or defaults to local.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import Product from '../models/product.model.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const { MONGODB_URL } = process.env;
const mongoUrl = MONGODB_URL || 'mongodb://127.0.0.1:27017/addon';
const isDryRun = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');

const main = async () => {
  try {
    console.log(`Connecting to MongoDB: ${mongoUrl.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`);
    await mongoose.connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('✅ Connected');

    const query = { styleCodes: { $exists: true, $not: { $size: 0 } } };
    const count = await Product.countDocuments(query);
    console.log(`Found ${count} products with non-empty styleCodes`);

    if (count === 0) {
      console.log('Nothing to clear. Exiting.');
      return;
    }

    if (isDryRun) {
      console.log('DRY RUN enabled – no changes written.');
      return;
    }

    const result = await Product.updateMany(query, { $set: { styleCodes: [] } });
    const modified = result.modifiedCount ?? result.nModified ?? 0;
    const matched = result.matchedCount ?? result.n ?? 0;
    console.log(`Matched ${matched} product(s); cleared styleCodes for ${modified} product(s).`);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    console.log('Disconnected.');
  }
};

main();
