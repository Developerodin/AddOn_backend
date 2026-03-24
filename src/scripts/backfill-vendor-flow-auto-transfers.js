import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { VendorProductionFlow } from '../models/index.js';
import { vendorProductionFlowSequence } from '../models/vendorManagement/vendorProductionFlow.model.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const { MONGODB_URL } = process.env;
const mongoUrl = MONGODB_URL || 'mongodb://127.0.0.1:27017/addon';
const isDryRun = process.argv.includes('--dry-run');

const main = async () => {
  try {
    console.log(`Connecting (masked): ${mongoUrl.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`);
    await mongoose.connect(mongoUrl);
    console.log('Connected.');

    const flows = await VendorProductionFlow.find({});
    console.log(`Found ${flows.length} vendor production flow docs.`);

    let changedCount = 0;

    for (const flow of flows) {
      let changed = false;
      const fq = flow.floorQuantities || {};

      for (let i = 0; i < vendorProductionFlowSequence.length - 1; i += 1) {
        const fromKey = vendorProductionFlowSequence[i];
        const toKey = vendorProductionFlowSequence[i + 1];
        const from = fq[fromKey] || {};
        const to = fq[toKey] || {};

        const completed = Number(from.completed || 0);
        const transferred = Number(from.transferred || 0);
        const pending = Math.max(0, completed - transferred);
        if (pending <= 0) continue;

        from.transferred = transferred + pending;
        from.remaining = Math.max(0, Number(from.received || 0) - Number(from.completed || 0) - Number(from.transferred || 0));

        if (fromKey === 'secondaryChecking' || fromKey === 'finalChecking') {
          from.m1Transferred = Number(from.m1Transferred || 0) + pending;
          from.m1Remaining = Math.max(0, Number(from.m1Quantity || 0) - Number(from.m1Transferred || 0));
        }

        to.received = Number(to.received || 0) + pending;
        to.remaining = Number(to.remaining || 0) + pending;

        fq[fromKey] = from;
        fq[toKey] = to;
        flow.currentFloorKey = toKey;
        changed = true;
      }

      if (changed) {
        changedCount += 1;
        if (!isDryRun) {
          flow.floorQuantities = fq;
          await flow.save();
        }
      }
    }

    if (isDryRun) {
      console.log(`Dry run complete. Would update ${changedCount} docs.`);
    } else {
      console.log(`Backfill complete. Updated ${changedCount} docs.`);
    }
  } catch (e) {
    console.error('Backfill failed:', e);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
    console.log('Disconnected.');
  }
};

main();
