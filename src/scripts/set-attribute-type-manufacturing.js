/**
 * Set attributeType = 'Manufacturing' on all ProductAttribute documents.
 *
 * Usage:
 *   node src/scripts/set-attribute-type-manufacturing.js
 *   DRY RUN: DRY_RUN=true node src/scripts/set-attribute-type-manufacturing.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import ProductAttribute from '../models/productAttribute.model.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const mongoUrl = process.env.MONGODB_URL || 'mongodb://127.0.0.1:27017/addon';
const isDryRun = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');

const main = async () => {
  try {
    console.log(`Connecting to MongoDB: ${mongoUrl.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`);
    await mongoose.connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('✅ Connected');

    const query = {};
    const toUpdate = await ProductAttribute.countDocuments(query);
    console.log(`Product attributes matched: ${toUpdate}`);

    if (toUpdate === 0) {
      console.log('No attributes found. Exiting.');
      return;
    }

    if (isDryRun) {
      console.log('DRY RUN enabled – no changes written.');
      return;
    }

    const result = await ProductAttribute.updateMany(query, { $set: { attributeType: 'Manufacturing' } });
    const matched = result.matchedCount ?? result.n ?? 0;
    const modified = result.modifiedCount ?? result.nModified ?? 0;
    console.log(`Updated attributeType for ${modified} document(s). Matched: ${matched}.`);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    console.log('Disconnected.');
  }
};

main();
