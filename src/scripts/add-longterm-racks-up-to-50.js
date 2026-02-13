#!/usr/bin/env node
/**
 * Add long-term (LT) storage racks up to 50 per section for all floors.
 * Does not remove or change existing slots; only inserts missing ones (upsert).
 * LT sections: B7-02, B7-03, B7-04, B7-05. Each section gets shelves 1..50, floors 1..4.
 */

import mongoose from 'mongoose';
import StorageSlot, { STORAGE_ZONES, LT_SECTION_CODES } from '../models/storageManagement/storageSlot.model.js';
import config from '../config/config.js';
import logger from '../config/logger.js';

const TARGET_RACKS_PER_SECTION = 50;
const FLOORS_PER_SECTION = 4;

const run = async () => {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);

    // Count existing LT slots per section (by distinct shelf numbers)
    const existing = await StorageSlot.aggregate([
      { $match: { zoneCode: STORAGE_ZONES.LONG_TERM } },
      { $group: { _id: '$sectionCode', maxShelf: { $max: '$shelfNumber' }, slotCount: { $sum: 1 } } },
    ]);
    logger.info('Existing LT racks per section:', existing);

    const bulkOps = [];
    const ltZone = STORAGE_ZONES.LONG_TERM;

    LT_SECTION_CODES.forEach((sectionCode) => {
      for (let shelf = 1; shelf <= TARGET_RACKS_PER_SECTION; shelf += 1) {
        for (let floor = 1; floor <= FLOORS_PER_SECTION; floor += 1) {
          const shelfStr = String(shelf).padStart(4, '0');
          const floorStr = String(floor).padStart(2, '0');
          const label = `${sectionCode}-S${shelfStr}-F${floorStr}`;
          bulkOps.push({
            updateOne: {
              filter: { zoneCode: ltZone, sectionCode, shelfNumber: shelf, floorNumber: floor },
              update: {
                $setOnInsert: {
                  zoneCode: ltZone,
                  sectionCode,
                  shelfNumber: shelf,
                  floorNumber: floor,
                  label,
                  barcode: label,
                  isActive: true,
                },
              },
              upsert: true,
            },
          });
        }
      }
    });

    if (bulkOps.length === 0) {
      logger.info('No ops to run.');
      return;
    }

    const result = await StorageSlot.bulkWrite(bulkOps, { ordered: false });
    const inserted = result.upsertedCount ?? 0;
    const matched = result.matchedCount ?? 0;
    logger.info(
      `Long-term racks ensure up to ${TARGET_RACKS_PER_SECTION}: inserted=${inserted}, already present=${matched}`
    );
  } catch (error) {
    logger.error('Failed to add long-term racks:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
