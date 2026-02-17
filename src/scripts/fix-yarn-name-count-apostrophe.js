#!/usr/bin/env node

/**
 * Fix yarnName: replace count apostrophe pattern (20's, 30's, 40's) with (20s, 30s, 40s).
 * Only changes the count part; rest of yarnName is untouched.
 * Example: "20's-Dk. Purple-DYL-25555-B-Cotton" → "20s-Dk. Purple-DYL-25555-B-Cotton"
 *
 * Usage: node src/scripts/fix-yarn-name-count-apostrophe.js [--dry-run] [--all]
 *   --dry-run  Preview changes without writing.
 *   --all      Also fix YarnCatalog, YarnCone, Supplier yarnDetails (default: YarnBox only).
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnCone, YarnCatalog, Supplier } from '../models/index.js';

const DRY_RUN = process.argv.includes('--dry-run');
const FIX_ALL = process.argv.includes('--all');

/**
 * Replaces count apostrophe in string: 20's → 20s, 30's → 30s, 2/40's → 2/40s.
 * Pattern: digits (optionally /digits) followed by 's → same + s (no apostrophe).
 */
function fixYarnNameCount(str) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/(\d+(?:\/\d+)?)'s/g, '$1s');
}

/**
 * Fix YarnBox yarnName.
 */
async function fixYarnBox() {
  const pattern = /(\d+(?:\/\d+)?)'s/;
  const boxes = await YarnBox.find({ yarnName: pattern }).lean();
  logger.info(`[YarnBox] Found ${boxes.length} documents with yarnName matching X's.`);

  let updated = 0;
  for (const box of boxes) {
    const corrected = fixYarnNameCount(box.yarnName);
    if (corrected === box.yarnName) continue;
    if (DRY_RUN) {
      logger.info(`  [dry-run] ${box.boxId}: "${box.yarnName}" → "${corrected}"`);
    } else {
      await YarnBox.updateOne({ _id: box._id }, { $set: { yarnName: corrected } });
    }
    updated += 1;
  }
  logger.info(`[YarnBox] Updated ${updated} documents.`);
  return updated;
}

/**
 * Fix YarnCone yarnName.
 */
async function fixYarnCone() {
  const pattern = /(\d+(?:\/\d+)?)'s/;
  const cones = await YarnCone.find({ yarnName: pattern }).lean();
  logger.info(`[YarnCone] Found ${cones.length} documents with yarnName matching X's.`);

  let updated = 0;
  for (const cone of cones) {
    const corrected = fixYarnNameCount(cone.yarnName);
    if (corrected === cone.yarnName) continue;
    if (DRY_RUN) {
      logger.info(`  [dry-run] cone ${cone._id}: "${cone.yarnName}" → "${corrected}"`);
    } else {
      await YarnCone.updateOne({ _id: cone._id }, { $set: { yarnName: corrected } });
    }
    updated += 1;
  }
  logger.info(`[YarnCone] Updated ${updated} documents.`);
  return updated;
}

/**
 * Fix YarnCatalog yarnName.
 */
async function fixYarnCatalog() {
  const pattern = /(\d+(?:\/\d+)?)'s/;
  const catalogs = await YarnCatalog.find({ yarnName: pattern }).lean();
  logger.info(`[YarnCatalog] Found ${catalogs.length} documents with yarnName matching X's.`);

  let updated = 0;
  for (const cat of catalogs) {
    const corrected = fixYarnNameCount(cat.yarnName);
    if (corrected === cat.yarnName) continue;
    if (DRY_RUN) {
      logger.info(`  [dry-run] catalog ${cat._id}: "${cat.yarnName}" → "${corrected}"`);
    } else {
      await YarnCatalog.updateOne({ _id: cat._id }, { $set: { yarnName: corrected } });
    }
    updated += 1;
  }
  logger.info(`[YarnCatalog] Updated ${updated} documents.`);
  return updated;
}

/**
 * Fix Supplier yarnDetails[].yarnName.
 */
async function fixSupplier() {
  const suppliers = await Supplier.find({ 'yarnDetails.0': { $exists: true } }).lean();
  logger.info(`[Supplier] Checking ${suppliers.length} suppliers with yarnDetails.`);

  let updated = 0;
  for (const sup of suppliers) {
    const details = sup.yarnDetails || [];
    let modified = false;
    const newDetails = details.map((d) => {
      const name = d.yarnName ? String(d.yarnName).trim() : '';
      const corrected = fixYarnNameCount(name);
      if (corrected !== name) {
        modified = true;
        return { ...d, yarnName: corrected };
      }
      return d;
    });
    if (modified && !DRY_RUN) {
      await Supplier.updateOne({ _id: sup._id }, { $set: { yarnDetails: newDetails } });
      updated += 1;
    } else if (modified && DRY_RUN) {
      const changed = details.filter((d, i) => fixYarnNameCount(String(d.yarnName || '').trim()) !== String(d.yarnName || '').trim());
      changed.forEach((d) => logger.info(`  [dry-run] supplier ${sup._id}: "${d.yarnName}" → "${fixYarnNameCount(String(d.yarnName || '').trim())}"`));
      updated += 1;
    }
  }
  logger.info(`[Supplier] Updated ${updated} suppliers.`);
  return updated;
}

async function run() {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    if (DRY_RUN) logger.info('DRY RUN – no writes will be performed');

    let total = 0;
    total += await fixYarnBox();
    if (FIX_ALL) {
      total += await fixYarnCone();
      total += await fixYarnCatalog();
      total += await fixSupplier();
    }

    logger.info(`Done. Total updates: ${total}${DRY_RUN ? ' (DRY RUN)' : ''}.`);
  } catch (error) {
    logger.error('Script failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB.');
  }
}

run();
