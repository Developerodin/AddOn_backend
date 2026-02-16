#!/usr/bin/env node

/**
 * Migration: Backfill pantoneName on PO items from YarnCatalog's colorFamily -> Color.
 * Run after adding pantoneName to poItemSchema so existing purchase orders get the field.
 *
 * Usage: node src/scripts/update-po-item-pantone.js [--dry-run]
 */

import mongoose from 'mongoose';
import YarnPurchaseOrder from '../models/yarnReq/yarnPurchaseOrder.model.js';
import YarnCatalog from '../models/yarnManagement/yarnCatalog.model.js';
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
    logger.info(`Loaded ${colorPantoneMap.size} colors.`);

    const catalogs = await YarnCatalog.find({}).lean().select('_id colorFamily').exec();
    const catalogToPantone = new Map();
    for (const cat of catalogs) {
      const colorId = cat.colorFamily?._id?.toString() ?? (mongoose.Types.ObjectId.isValid(cat.colorFamily) ? String(cat.colorFamily) : null);
      if (colorId) {
        const pantone = colorPantoneMap.get(colorId) ?? null;
        catalogToPantone.set(cat._id.toString(), pantone);
      }
    }
    logger.info(`Built pantone map for ${catalogToPantone.size} catalogs.`);

    const pos = await YarnPurchaseOrder.find({ 'poItems.0': { $exists: true } }).lean().exec();
    logger.info(`Loaded ${pos.length} purchase orders.`);

    let posUpdated = 0;
    let itemsUpdated = 0;

    for (let i = 0; i < pos.length; i++) {
      const po = pos[i];
      if ((i + 1) % 50 === 0 || i === 0) {
        logger.info(`Processing PO ${i + 1}/${pos.length}: ${po.poNumber}`);
      }

      const items = po.poItems || [];
      if (!items.length) continue;

      let modified = false;
      const updatedItems = items.map((item) => {
        const yarnId = item.yarn?._id?.toString() ?? (item.yarn && mongoose.Types.ObjectId.isValid(item.yarn) ? String(item.yarn) : null);
        if (!yarnId) return item;

        const pantone = catalogToPantone.get(yarnId);
        const currentPantone = item.pantoneName ?? null;
        if (pantone === undefined) return item;
        if (String(pantone || '') === String(currentPantone || '')) return item;

        modified = true;
        itemsUpdated += 1;
        return {
          ...item,
          pantoneName: pantone || undefined,
        };
      });

      if (modified && !DRY_RUN) {
        await YarnPurchaseOrder.updateOne({ _id: po._id }, { $set: { poItems: updatedItems } });
        posUpdated += 1;
      } else if (modified && DRY_RUN) {
        posUpdated += 1;
      }
    }

    logger.info(
      `Done. POs updated: ${posUpdated}, PO items updated: ${itemsUpdated}${DRY_RUN ? ' (DRY RUN)' : ''}`
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
