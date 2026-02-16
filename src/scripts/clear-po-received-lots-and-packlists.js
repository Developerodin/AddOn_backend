#!/usr/bin/env node

/**
 * Clears receivedLotDetails and packListDetails from YarnPurchaseOrder and deletes
 * associated YarnCone and YarnBox records for each PO.
 *
 * Order: delete cones (by poNumber) → delete boxes (by poNumber) → set PO arrays to [].
 *
 * Usage:
 *   node src/scripts/clear-po-received-lots-and-packlists.js
 *   node src/scripts/clear-po-received-lots-and-packlists.js --dry-run
 *   node src/scripts/clear-po-received-lots-and-packlists.js --po-number=PO-123
 */

import mongoose from 'mongoose';
import { YarnPurchaseOrder, YarnCone, YarnBox } from '../models/index.js';
import config from '../config/config.js';
import logger from '../config/logger.js';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const poNumberArg = args.find((a) => a.startsWith('--po-number='));
const poNumberFilter = poNumberArg ? poNumberArg.split('=')[1]?.trim() : null;

async function run() {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);

    if (isDryRun) logger.info('DRY RUN – no deletes or updates will be performed');

    const query = {};
    if (poNumberFilter) {
      query.poNumber = poNumberFilter;
    } else {
      query.$or = [
        { 'receivedLotDetails.0': { $exists: true } },
        { 'packListDetails.0': { $exists: true } },
      ];
    }

    const pos = await YarnPurchaseOrder.find(query).lean();
    logger.info(`Found ${pos.length} PO(s) to process.`);

    for (const po of pos) {
      const { poNumber, _id } = po;
      const coneCount = await YarnCone.countDocuments({ poNumber });
      const boxCount = await YarnBox.countDocuments({ poNumber });

      logger.info(`PO ${poNumber} (${_id}): cones=${coneCount}, boxes=${boxCount}, lots=${(po.receivedLotDetails || []).length}, packLists=${(po.packListDetails || []).length}`);

      if (!isDryRun) {
        const deletedCones = await YarnCone.deleteMany({ poNumber });
        logger.info(`  Deleted ${deletedCones.deletedCount} cones.`);

        const deletedBoxes = await YarnBox.deleteMany({ poNumber });
        logger.info(`  Deleted ${deletedBoxes.deletedCount} boxes.`);

        await YarnPurchaseOrder.updateOne(
          { _id: po._id },
          { $set: { receivedLotDetails: [], packListDetails: [] } }
        );
        logger.info(`  Cleared receivedLotDetails and packListDetails.`);
      }
    }

    logger.info('Done.');
  } catch (error) {
    logger.error('Script failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
