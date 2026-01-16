import mongoose from 'mongoose';
import config from './src/config/config.js';
import { YarnBox, YarnCatalog, YarnTransaction, YarnInventory } from './src/models/index.js';
import * as yarnTransactionService from './src/services/yarnManagement/yarnTransaction.service.js';

/**
 * Sync existing boxes in long-term and short-term storage to yarn inventory
 * This script creates yarn_stocked transactions for boxes that haven't been synced yet
 */

const connectDB = async () => {
  try {
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

const findYarnCatalogByYarnName = async (yarnName) => {
  if (!yarnName) return null;
  
  // Try exact match first
  let catalog = await YarnCatalog.findOne({ 
    yarnName: yarnName.trim(),
    status: { $ne: 'deleted' }
  });
  
  if (catalog) return catalog;
  
  // Try case-insensitive match
  catalog = await YarnCatalog.findOne({ 
    yarnName: { $regex: new RegExp(`^${yarnName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    status: { $ne: 'deleted' }
  });
  
  return catalog;
};

const checkIfTransactionExists = async (boxId, yarnId) => {
  // Check if a yarn_stocked transaction already exists for this box
  // We'll use orderno field to store boxId for tracking
  const existing = await YarnTransaction.findOne({
    yarn: yarnId,
    transactionType: 'yarn_stocked',
    orderno: boxId,
  });
  return !!existing;
};

const syncBoxesToInventory = async () => {
  console.log('\n🔄 Starting sync of boxes to yarn inventory...\n');

  // Find all boxes in long-term storage (storedStatus: true, storageLocation starts with "LT-")
  // Only process QC-approved boxes
  const longTermBoxes = await YarnBox.find({
    storedStatus: true,
    storageLocation: { $regex: /^LT-/i },
    boxWeight: { $gt: 0 }, // Only boxes with weight
    'qcData.status': 'qc_approved', // Only QC-approved boxes
  }).lean();

  console.log(`📦 Found ${longTermBoxes.length} boxes in long-term storage`);

  const stats = {
    processed: 0,
    created: 0,
    skipped: 0,
    errors: 0,
    notFound: [],
  };

  // Process long-term boxes
  for (const box of longTermBoxes) {
    try {
      stats.processed++;

      // Find matching yarn catalog
      const yarnCatalog = await findYarnCatalogByYarnName(box.yarnName);

      if (!yarnCatalog) {
        stats.notFound.push({
          boxId: box.boxId,
          yarnName: box.yarnName,
          storageLocation: box.storageLocation,
        });
        stats.skipped++;
        console.log(`⚠️  Skipped box ${box.boxId}: Yarn catalog not found for "${box.yarnName}"`);
        continue;
      }

      // Check if transaction already exists
      const exists = await checkIfTransactionExists(box.boxId, yarnCatalog._id);
      if (exists) {
        stats.skipped++;
        console.log(`⏭️  Skipped box ${box.boxId}: Transaction already exists`);
        continue;
      }

      // Calculate net weight (boxWeight - tearweight)
      const netWeight = (box.boxWeight || 0) - (box.tearweight || 0);
      if (netWeight <= 0) {
        stats.skipped++;
        console.log(`⚠️  Skipped box ${box.boxId}: Invalid net weight (${netWeight})`);
        continue;
      }

      // Create yarn_stocked transaction
      // The service accepts camelCase fields and normalizes them
      const transactionData = {
        yarn: yarnCatalog._id.toString(),
        yarnName: yarnCatalog.yarnName,
        transactionType: 'yarn_stocked',
        transactionDate: box.receivedDate || box.createdAt || new Date(),
        totalWeight: box.boxWeight || 0,
        totalNetWeight: netWeight,
        totalTearWeight: box.tearweight || 0,
        numberOfCones: box.numberOfCones || 0,
        orderno: box.boxId, // Store boxId for tracking
      };

      await yarnTransactionService.createYarnTransaction(transactionData);
      stats.created++;
      console.log(`✅ Created transaction for box ${box.boxId} (${box.yarnName}) - ${netWeight}kg, ${box.numberOfCones || 0} cones`);
    } catch (error) {
      stats.errors++;
      console.error(`❌ Error processing box ${box.boxId}:`, error.message);
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SYNC SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total boxes processed: ${stats.processed}`);
  console.log(`✅ Transactions created: ${stats.created}`);
  console.log(`⏭️  Skipped (already exists or invalid): ${stats.skipped}`);
  console.log(`❌ Errors: ${stats.errors}`);

  if (stats.notFound.length > 0) {
    console.log(`\n⚠️  ${stats.notFound.length} boxes with no matching yarn catalog:`);
    const uniqueYarns = [...new Set(stats.notFound.map(b => b.yarnName))];
    uniqueYarns.slice(0, 10).forEach(yarnName => {
      console.log(`   - ${yarnName}`);
    });
    if (uniqueYarns.length > 10) {
      console.log(`   ... and ${uniqueYarns.length - 10} more`);
    }
  }

  console.log('\n✅ Sync completed!\n');
};

const main = async () => {
  try {
    await connectDB();
    await syncBoxesToInventory();
    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

main();
