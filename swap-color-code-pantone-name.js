/**
 * Migration Script: Swap colorCode and pantoneName in Color Master
 *
 * For every color document:
 *   - Current colorCode value → saved into pantoneName
 *   - Current pantoneName value → saved into colorCode
 *
 * Run: node swap-color-code-pantone-name.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

const connectDB = async () => {
  try {
    const mongoUrl = process.env.MONGODB_URL;
    if (!mongoUrl) {
      throw new Error('MONGODB_URL environment variable is required');
    }
    await mongoose.connect(mongoUrl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

const swapColorCodeAndPantoneName = async () => {
  const db = mongoose.connection.db;
  const collection = db.collection('colors');

  const total = await collection.countDocuments();
  console.log(`📋 Total color documents: ${total}\n`);

  const cursor = collection.find({});
  let updated = 0;
  let errors = 0;

  for await (const doc of cursor) {
    const oldColorCode = doc.colorCode != null ? String(doc.colorCode) : '';
    const oldPantoneName = doc.pantoneName != null ? String(doc.pantoneName) : '';

    try {
      const result = await collection.updateOne(
        { _id: doc._id },
        {
          $set: {
            colorCode: (oldPantoneName || '').trim().toUpperCase(),
            pantoneName: (oldColorCode || '').trim(),
            updatedAt: new Date(),
          },
        }
      );
      if (result.modifiedCount === 1) {
        updated++;
        if (updated <= 5) {
          console.log(
            `  Swapped id=${doc._id}: colorCode "${oldColorCode}" ↔ pantoneName "${oldPantoneName}"`
          );
        }
      }
    } catch (err) {
      errors++;
      console.error(`  ❌ Error updating _id=${doc._id}:`, err.message);
    }
  }

  console.log('\n📊 Summary:');
  console.log(`  ✅ Updated: ${updated}`);
  if (errors) console.log(`  ❌ Errors: ${errors}`);
  console.log('\n✨ Swap completed.');
};

const run = async () => {
  try {
    await connectDB();
    console.log('🔄 Swapping colorCode ↔ pantoneName for all colors...\n');
    await swapColorCodeAndPantoneName();
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Script failed:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

run();
