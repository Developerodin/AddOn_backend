/**
 * Backfills `floorQuantities.finalChecking.receivedData` from `branding.transferredData`
 * for flows that already received qty on final checking but never got line rows (pre-fix data).
 *
 * Usage:
 *   node src/scripts/backfill-final-checking-received-data-from-branding.js --dry-run
 *   node src/scripts/backfill-final-checking-received-data-from-branding.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { backfillFinalCheckingReceivedDataFromBranding } from '../services/vendorManagement/vendorProductionFlow.service.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const { MONGODB_URL } = process.env;
const mongoUrl = MONGODB_URL || 'mongodb://127.0.0.1:27017/addon';
const isDryRun = process.argv.includes('--dry-run');

const main = async () => {
  try {
    console.log(`Connecting (masked): ${mongoUrl.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`);
    await mongoose.connect(mongoUrl);
    console.log('Connected.');

    const result = await backfillFinalCheckingReceivedDataFromBranding({ dryRun: isDryRun });
    console.log(
      isDryRun ? 'Dry run — no writes.' : 'Backfill applied.',
      JSON.stringify(result, null, 2)
    );

    await mongoose.disconnect();
    console.log('Disconnected.');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
};

main();
