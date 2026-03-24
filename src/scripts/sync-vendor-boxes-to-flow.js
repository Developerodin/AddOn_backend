import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { VendorBox, VendorProductionFlow } from '../models/index.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const { MONGODB_URL } = process.env;
const mongoUrl = MONGODB_URL || 'mongodb://127.0.0.1:27017/addon';

/**
 * Migration script to sync existing VendorBox units into VendorProductionFlow.
 * This is useful if boxes were created before the automatic sync logic was added.
 */
const main = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUrl);
    console.log('Connected.');

    // Find all boxes that have units assigned
    const boxes = await VendorBox.find({ numberOfUnits: { $gt: 0 } }).lean();
    console.log(`Found ${boxes.length} boxes with units.`);

    if (boxes.length === 0) {
      console.log('No boxes with units found. Nothing to sync.');
      return;
    }

    // Aggregate units by Vendor + VPO + Product
    const flowMap = new Map();

    for (const box of boxes) {
      if (!box.vendor || !box.vendorPurchaseOrderId || !box.productId) {
        console.warn(`Skipping box ${box.boxId}: missing vendor, VPO, or product ID.`);
        continue;
      }

      const key = `${box.vendor}_${box.vendorPurchaseOrderId}_${box.productId}`;
      if (!flowMap.has(key)) {
        flowMap.set(key, {
          vendor: box.vendor,
          vendorPurchaseOrder: box.vendorPurchaseOrderId,
          product: box.productId,
          totalUnits: 0,
          referenceCode: box.lotNumber || box.vpoNumber,
          vpoNumber: box.vpoNumber
        });
      }
      
      const data = flowMap.get(key);
      data.totalUnits += (box.numberOfUnits || 0);
    }

    console.log(`Processing ${flowMap.size} production flow entries...`);

    for (const [key, data] of flowMap.entries()) {
      const filter = {
        vendor: data.vendor,
        vendorPurchaseOrder: data.vendorPurchaseOrder,
        product: data.product,
      };

      const update = {
        $set: {
          plannedQuantity: data.totalUnits,
          'floorQuantities.secondaryChecking.received': data.totalUnits,
          'floorQuantities.secondaryChecking.remaining': data.totalUnits,
          'floorQuantities.secondaryChecking.completed': 0, // Reset completed if syncing from scratch
          'floorQuantities.secondaryChecking.transferred': 0,
          currentFloorKey: 'secondaryChecking',
          referenceCode: data.referenceCode,
        },
      };

      await VendorProductionFlow.findOneAndUpdate(filter, update, {
        upsert: true,
        new: true,
      });
      
      console.log(`Synced: VPO ${data.vpoNumber} | Product ${data.product} | Total Units: ${data.totalUnits}`);
    }

    console.log('\nSync completed successfully.');
  } catch (e) {
    console.error('Error during sync:', e);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
};

main();
