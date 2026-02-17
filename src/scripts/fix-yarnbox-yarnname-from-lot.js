#!/usr/bin/env node

/**
 * Fix YarnBox yarnName from PO + lot data.
 * Boxes are often created with placeholder "Yarn-{poNumber}"; the correct name
 * comes from the PO's receivedLotDetails[lot] -> poItems[].poItem -> poItems[item].yarnName.
 *
 * Usage: node src/scripts/fix-yarnbox-yarnname-from-lot.js [--dry-run] [--limit=N]
 *   --dry-run  Preview changes only (no writes).
 *   --limit=N  Process at most N boxes (default: no limit).
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnPurchaseOrder } from '../models/index.js';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : 0;

/**
 * Get correct yarnName for (poNumber, lotNumber) from PO's receivedLotDetails and poItems.
 * @param {Object} po - PO doc with receivedLotDetails and poItems (poItems may have yarn populated)
 * @returns {string|null} - yarnName or null if not found
 */
function getYarnNameForLot(po, lotNumber) {
  const lot = (po.receivedLotDetails || []).find(
    (l) => (l.lotNumber || '').trim() === (lotNumber || '').trim()
  );
  if (!lot || !(lot.poItems && lot.poItems.length)) {
    return null;
  }
  const firstPoItemRef = lot.poItems[0].poItem;
  const poItemId = firstPoItemRef?.toString?.() || firstPoItemRef;
  const item = (po.poItems || []).find(
    (i) => i._id && i._id.toString() === poItemId
  );
  if (!item) return null;
  return (item.yarn?.yarnName || item.yarnName || '').trim() || null;
}

async function run() {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    if (DRY_RUN) logger.info('DRY RUN – no writes will be performed');
    if (LIMIT) logger.info(`Limit: ${LIMIT} boxes`);

    const boxQuery = {};
    let boxQueryBuilder = YarnBox.find(boxQuery)
      .select('_id boxId poNumber lotNumber yarnName')
      .lean();
    if (LIMIT > 0) boxQueryBuilder = boxQueryBuilder.limit(LIMIT);
    const boxes = await boxQueryBuilder;
    const total = boxes.length;
    logger.info(`Found ${total} box(es) to check.`);

    const poCache = new Map();
    const getPo = async (poNumber) => {
      if (poCache.has(poNumber)) return poCache.get(poNumber);
      const po = await YarnPurchaseOrder.findOne({ poNumber })
        .populate({ path: 'poItems.yarn', select: 'yarnName' })
        .select('poNumber poItems receivedLotDetails')
        .lean();
      poCache.set(poNumber, po);
      return po;
    };

    let updated = 0;
    let skippedNoPo = 0;
    let skippedNoLot = 0;
    let skippedSame = 0;
    const errors = [];

    for (const box of boxes) {
      const poNumber = (box.poNumber || '').trim();
      const lotNumber = (box.lotNumber || '').trim();
      if (!poNumber) {
        skippedNoPo += 1;
        continue;
      }

      const po = await getPo(poNumber);
      if (!po) {
        skippedNoPo += 1;
        continue;
      }

      const correctYarnName = getYarnNameForLot(po, lotNumber);
      if (!correctYarnName) {
        skippedNoLot += 1;
        continue;
      }

      const current = (box.yarnName || '').trim();
      if (current === correctYarnName) {
        skippedSame += 1;
        continue;
      }

      if (DRY_RUN) {
        logger.info(`  [dry-run] ${box.boxId}: "${current}" → "${correctYarnName}"`);
      } else {
        try {
          await YarnBox.updateOne(
            { _id: box._id },
            { $set: { yarnName: correctYarnName } }
          );
          logger.info(`  ${box.boxId}: "${current}" → "${correctYarnName}"`);
        } catch (err) {
          errors.push({ boxId: box.boxId, error: err.message });
        }
      }
      updated += 1;
    }

    logger.info('---');
    logger.info(`Updated: ${updated}`);
    logger.info(`Skipped (no PO): ${skippedNoPo}, no lot/match: ${skippedNoLot}, already correct: ${skippedSame}`);
    if (errors.length) logger.error('Errors:', errors);

    if (DRY_RUN && updated) logger.info('Run without --dry-run to apply changes.');
  } catch (error) {
    logger.error('Script failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB.');
  }
}

run();
