#!/usr/bin/env node

/**
 * Fix yarnName in YarnBox and YarnCone for a PO when yarn was renamed in catalog.
 * Boxes/cones store yarnName at creation; if the yarn name changed in PO/catalog,
 * they still show the old name. This script syncs from PO's poItems (via lot mapping).
 *
 * Usage: node src/scripts/fix-yarn-name-in-boxes-cones-for-po.js [--po=PO-2026-055] [--dry-run]
 *   --po=PO_NUMBER  Only process boxes/cones for this PO (required).
 *   --dry-run       Preview changes only (no writes).
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnCone, YarnPurchaseOrder } from '../models/index.js';

const DRY_RUN = process.argv.includes('--dry-run');
const PO_ARG = process.argv.find((a) => a.startsWith('--po='));
const PO_NUMBER = PO_ARG ? PO_ARG.split('=')[1]?.trim() : null;

if (!PO_NUMBER) {
  logger.error('Usage: node fix-yarn-name-in-boxes-cones-for-po.js --po=PO-2026-055 [--dry-run]');
  process.exit(1);
}

/**
 * Get correct yarnName for (poNumber, lotNumber) from PO's receivedLotDetails and poItems.
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
    logger.info(`Processing PO: ${PO_NUMBER}`);

    const po = await YarnPurchaseOrder.findOne({ poNumber: PO_NUMBER })
      .populate({ path: 'poItems.yarn', select: 'yarnName' })
      .select('poNumber poItems receivedLotDetails')
      .lean();

    if (!po) {
      logger.error(`PO not found: ${PO_NUMBER}`);
      process.exit(1);
    }

    const boxes = await YarnBox.find({ poNumber: PO_NUMBER })
      .select('_id boxId poNumber lotNumber yarnName')
      .lean();

    const boxIdToYarnName = new Map();
    let boxesUpdated = 0;

    for (const box of boxes) {
      const lotNumber = (box.lotNumber || '').trim();
      const correctYarnName = getYarnNameForLot(po, lotNumber);
      if (!correctYarnName) {
        logger.warn(`  Box ${box.boxId}: no lot match for lotNumber "${lotNumber}"`);
        continue;
      }

      boxIdToYarnName.set(box.boxId, correctYarnName);

      const current = (box.yarnName || '').trim();
      if (current === correctYarnName) continue;

      if (DRY_RUN) {
        logger.info(`  [dry-run] Box ${box.boxId}: "${current}" → "${correctYarnName}"`);
      } else {
        await YarnBox.updateOne(
          { _id: box._id },
          { $set: { yarnName: correctYarnName } }
        );
        logger.info(`  Box ${box.boxId}: "${current}" → "${correctYarnName}"`);
      }
      boxesUpdated += 1;
    }

    const cones = await YarnCone.find({ poNumber: PO_NUMBER })
      .select('_id barcode boxId yarnName')
      .lean();

    let conesUpdated = 0;
    for (const cone of cones) {
      const correctYarnName = boxIdToYarnName.get(cone.boxId);
      if (!correctYarnName) continue;

      const current = (cone.yarnName || '').trim();
      if (current === correctYarnName) continue;

      const coneId = cone.barcode || cone._id;
      if (DRY_RUN) {
        logger.info(`  [dry-run] Cone ${coneId}: "${current}" → "${correctYarnName}"`);
      } else {
        await YarnCone.updateOne(
          { _id: cone._id },
          { $set: { yarnName: correctYarnName } }
        );
        logger.info(`  Cone ${coneId}: "${current}" → "${correctYarnName}"`);
      }
      conesUpdated += 1;
    }

    logger.info('---');
    logger.info(`Boxes updated: ${boxesUpdated}, Cones updated: ${conesUpdated}`);
    if (DRY_RUN && (boxesUpdated || conesUpdated)) {
      logger.info('Run without --dry-run to apply changes.');
    }
  } catch (error) {
    logger.error('Script failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB.');
  }
}

run();
