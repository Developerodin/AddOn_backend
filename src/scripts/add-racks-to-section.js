#!/usr/bin/env node
/**
 * Add addon racks to a specific storage section (long-term or short-term).
 * Edit the config constants below, then run: node src/scripts/add-racks-to-section.js
 *
 * - STORAGE_TYPE: 'longterm' (LT) or 'shortterm' (ST)
 * - SECTION_CODE: e.g. B7-02, B7-03, B7-04, B7-05 for LT; B7-01 for ST
 * - NUMBER_OF_RACKS_TO_ADD: how many racks (shelves) to add on that section (e.g. 12, 13)
 */

import mongoose from 'mongoose';
import StorageSlot, {
  STORAGE_ZONES,
  LT_SECTION_CODES,
  ST_SECTION_CODE,
} from '../models/storageManagement/storageSlot.model.js';
import config from '../config/config.js';
import logger from '../config/logger.js';

// ============ CONFIG (edit before running) ============
const STORAGE_TYPE = 'longterm'; // 'longterm' | 'shortterm'
const SECTION_CODE = 'B7-02'; // LT: B7-02, B7-03, B7-04, B7-05  |  ST: B7-01
const NUMBER_OF_RACKS_TO_ADD = 15; // e.g. 12, 13, 20
// =====================================================

const FLOORS_PER_SECTION = 4;

function getZoneAndValidateSection() {
  const type = STORAGE_TYPE.toLowerCase();
  if (type === 'longterm' || type === 'lt') {
    if (!LT_SECTION_CODES.includes(SECTION_CODE)) {
      throw new Error(
        `Invalid LT section. Use one of: ${LT_SECTION_CODES.join(', ')}`
      );
    }
    return { zoneCode: STORAGE_ZONES.LONG_TERM, sectionCode: SECTION_CODE };
  }
  if (type === 'shortterm' || type === 'st') {
    if (SECTION_CODE !== ST_SECTION_CODE) {
      throw new Error(`Invalid ST section. Use: ${ST_SECTION_CODE}`);
    }
    return { zoneCode: STORAGE_ZONES.SHORT_TERM, sectionCode: SECTION_CODE };
  }
  throw new Error("STORAGE_TYPE must be 'longterm' or 'shortterm'");
}

const run = async () => {
  try {
    const { zoneCode, sectionCode } = getZoneAndValidateSection();

    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);

    const existing = await StorageSlot.findOne(
      { zoneCode, sectionCode },
      {},
      { sort: { shelfNumber: -1 } }
    );
    const startShelf = existing ? existing.shelfNumber + 1 : 1;
    const endShelf = startShelf + NUMBER_OF_RACKS_TO_ADD - 1;

    logger.info(
      `Adding ${NUMBER_OF_RACKS_TO_ADD} racks to ${sectionCode} (${zoneCode}): shelves ${startShelf}..${endShelf}`
    );

    const bulkOps = [];
    for (let shelf = startShelf; shelf <= endShelf; shelf += 1) {
      for (let floor = 1; floor <= FLOORS_PER_SECTION; floor += 1) {
        const shelfStr = String(shelf).padStart(4, '0');
        const floorStr = String(floor).padStart(2, '0');
        const label = `${sectionCode}-S${shelfStr}-F${floorStr}`;
        bulkOps.push({
          updateOne: {
            filter: { zoneCode, sectionCode, shelfNumber: shelf, floorNumber: floor },
            update: {
              $setOnInsert: {
                zoneCode,
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

    if (bulkOps.length === 0) {
      logger.info('No ops to run.');
      return;
    }

    const result = await StorageSlot.bulkWrite(bulkOps, { ordered: false });
    const inserted = result.upsertedCount ?? 0;
    const matched = result.matchedCount ?? 0;
    logger.info(
      `Section ${sectionCode}: inserted=${inserted} slots, already present=${matched}`
    );
  } catch (error) {
    logger.error('Failed to add racks:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
