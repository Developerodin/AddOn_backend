/**
 * Removes legacy vendor production flow fields from DB after the schema was simplified to:
 * secondaryChecking → washing → boarding → branding → finalChecking
 *
 * Drops:
 * - floorQuantities.screeningChecking
 * - routeAfterSecondaryChecking (top-level)
 *
 * Fixes:
 * - currentFloorKey: screeningChecking → secondaryChecking
 *
 * Usage:
 *   node src/scripts/migrate-vendor-production-flow-legacy-fields.js
 *   node src/scripts/migrate-vendor-production-flow-legacy-fields.js --dry-run
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import VendorProductionFlow from '../models/vendorManagement/vendorProductionFlow.model.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const { MONGODB_URL } = process.env;
const mongoUrl = MONGODB_URL || 'mongodb://127.0.0.1:27017/addon';
const isDryRun = process.argv.includes('--dry-run');

const main = async () => {
  try {
    console.log(`Connecting (masked): ${mongoUrl.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`);
    await mongoose.connect(mongoUrl);
    console.log('Connected.');

    const withScreening = await VendorProductionFlow.countDocuments({
      'floorQuantities.screeningChecking': { $exists: true },
    });
    const withRoute = await VendorProductionFlow.countDocuments({
      routeAfterSecondaryChecking: { $exists: true },
    });
    const badCurrent = await VendorProductionFlow.countDocuments({
      currentFloorKey: 'screeningChecking',
    });

    console.log(`Docs with floorQuantities.screeningChecking: ${withScreening}`);
    console.log(`Docs with routeAfterSecondaryChecking: ${withRoute}`);
    console.log(`Docs with currentFloorKey=screeningChecking: ${badCurrent}`);

    if (isDryRun) {
      console.log('Dry run — no writes.');
      await mongoose.disconnect();
      return;
    }

    if (withScreening > 0) {
      const r1 = await VendorProductionFlow.updateMany(
        { 'floorQuantities.screeningChecking': { $exists: true } },
        { $unset: { 'floorQuantities.screeningChecking': '' } }
      );
      console.log('Unset screeningChecking:', r1.modifiedCount ?? r1.nModified ?? 0, 'modified');
    }

    if (withRoute > 0) {
      const r2 = await VendorProductionFlow.updateMany(
        { routeAfterSecondaryChecking: { $exists: true } },
        { $unset: { routeAfterSecondaryChecking: '' } }
      );
      console.log('Unset routeAfterSecondaryChecking:', r2.modifiedCount ?? r2.nModified ?? 0, 'modified');
    }

    if (badCurrent > 0) {
      const r3 = await VendorProductionFlow.updateMany(
        { currentFloorKey: 'screeningChecking' },
        { $set: { currentFloorKey: 'secondaryChecking' } }
      );
      console.log('Fixed currentFloorKey screening→secondary:', r3.modifiedCount ?? r3.nModified ?? 0, 'modified');
    }

    console.log('Done.');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
};

main();
