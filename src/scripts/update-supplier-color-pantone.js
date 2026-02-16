#!/usr/bin/env node

/**
 * Migration: Backfill pantoneName on embedded color in supplier yarnDetails
 * from the Color collection. Run after adding pantoneName to supplier's
 * embeddedColorSchema so existing supplier documents get the field.
 *
 * Usage: node src/scripts/update-supplier-color-pantone.js [--dry-run]
 */

import mongoose from 'mongoose';
import Supplier from '../models/yarnManagement/supplier.model.js';
import Color from '../models/yarnManagement/color.model.js';
import config from '../config/config.js';
import logger from '../config/logger.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    if (DRY_RUN) logger.info('DRY RUN – no writes will be performed');

    const colors = await Color.find({}).lean().select('_id pantoneName').exec();
    const colorPantoneMap = new Map();
    for (const c of colors) {
      colorPantoneMap.set(c._id.toString(), c.pantoneName ?? null);
    }
    logger.info(`Loaded ${colorPantoneMap.size} colors for pantone lookup.`);

    const suppliers = await Supplier.find({ 'yarnDetails.0': { $exists: true } }).lean().exec();
    logger.info(`Loaded ${suppliers.length} suppliers with yarnDetails.`);

    let suppliersUpdated = 0;
    let detailsUpdated = 0;

    for (let i = 0; i < suppliers.length; i++) {
      const supplier = suppliers[i];
      if ((i + 1) % 20 === 0 || i === 0) {
        logger.info(`Processing supplier ${i + 1}/${suppliers.length}: ${supplier.brandName}`);
      }

      const yarnDetails = supplier.yarnDetails || [];
      if (!yarnDetails.length) continue;

      let modified = false;
      const updatedDetails = yarnDetails.map((detail) => {
        const color = detail.color;
        if (!color || !color._id) return detail;

        const colorId = (color._id && color._id.toString && color._id.toString()) || String(color._id);
        const pantoneFromColor = colorPantoneMap.get(colorId);
        const currentPantone = color.pantoneName ?? null;
        if (pantoneFromColor === undefined) return detail; // color not in Color collection, skip
        if (String(pantoneFromColor || '') === String(currentPantone || '')) return detail;

        modified = true;
        detailsUpdated += 1;
        return {
          ...detail,
          color: {
            ...color,
            pantoneName: pantoneFromColor || undefined,
          },
        };
      });

      if (modified && !DRY_RUN) {
        await Supplier.updateOne({ _id: supplier._id }, { $set: { yarnDetails: updatedDetails } });
        suppliersUpdated += 1;
      } else if (modified && DRY_RUN) {
        suppliersUpdated += 1;
      }
    }

    logger.info(
      `Done. Suppliers updated: ${suppliersUpdated}, Yarn-detail colors updated: ${detailsUpdated}${DRY_RUN ? ' (DRY RUN)' : ''}`
    );
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB.');
  }
}

run();
