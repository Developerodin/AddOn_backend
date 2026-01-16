import mongoose from 'mongoose';
import config from './src/config/config.js';
import { YarnBox, YarnCatalog, YarnTransaction, YarnInventory } from './src/models/index.js';

/**
 * Sync existing boxes in long-term storage to yarn inventory
 * This version directly updates inventory without using MongoDB transactions
 * (works with standalone MongoDB instances)
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

const toNumber = (value) => Number(value ?? 0);

const ensureBucket = (inventory, key) => {
  if (!inventory[key]) {
    inventory[key] = {
      totalWeight: 0,
      numberOfCones: 0,
      totalTearWeight: 0,
      totalNetWeight: 0,
    };
  }
  inventory[key].totalWeight = toNumber(inventory[key].totalWeight);
  inventory[key].numberOfCones = toNumber(inventory[key].numberOfCones);
  inventory[key].totalTearWeight = toNumber(inventory[key].totalTearWeight);
  inventory[key].totalNetWeight = toNumber(inventory[key].totalNetWeight);
  return inventory[key];
};

const applyDelta = (bucket, delta) => {
  bucket.totalWeight += toNumber(delta.totalWeight);
  bucket.totalTearWeight += toNumber(delta.totalTearWeight);
  bucket.totalNetWeight += toNumber(delta.totalNetWeight);
  bucket.numberOfCones += toNumber(delta.numberOfCones);
};

const recalcTotalInventory = (inventory) => {
  const longTerm = ensureBucket(inventory, 'longTermInventory');
  const shortTerm = ensureBucket(inventory, 'shortTermInventory');
  const total = ensureBucket(inventory, 'totalInventory');

  total.totalWeight = toNumber(longTerm.totalWeight) + toNumber(shortTerm.totalWeight);
  total.totalTearWeight = toNumber(longTerm.totalTearWeight) + toNumber(shortTerm.totalTearWeight);
  total.totalNetWeight = toNumber(longTerm.totalNetWeight) + toNumber(shortTerm.totalNetWeight);
  total.numberOfCones = toNumber(longTerm.numberOfCones) + toNumber(shortTerm.numberOfCones);
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
  const existing = await YarnTransaction.findOne({
    yarn: yarnId,
    transactionType: 'yarn_stocked',
    orderno: boxId,
  });
  return !!existing;
};

const updateInventoryStatus = (inventory, yarnDoc) => {
  const totalNet = toNumber(inventory.totalInventory.totalNetWeight);
  const blockedNet = toNumber(inventory.blockedNetWeight);
  const minQty = toNumber(yarnDoc?.minQuantity);

  let newStatus = 'in_stock';
  if (minQty > 0) {
    if (totalNet <= minQty) {
      newStatus = 'low_stock';
    } else if (totalNet <= minQty * 1.2) {
      newStatus = 'soon_to_be_low';
    }
  }
  inventory.inventoryStatus = newStatus;
  inventory.overbooked = blockedNet > totalNet;
};

const syncBoxesToInventory = async () => {
  console.log('\n🔄 Starting sync of boxes to yarn inventory...\n');

  // Find all boxes in long-term storage (storedStatus: true, storageLocation starts with "LT-")
  // Only process QC-approved boxes
  const longTermBoxes = await YarnBox.find({
    storedStatus: true,
    storageLocation: { $regex: /^LT-/i },
    boxWeight: { $gt: 0 },
    'qcData.status': 'qc_approved',
  }).lean();

  console.log(`📦 Found ${longTermBoxes.length} boxes in long-term storage\n`);

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

      // Get or create inventory
      let inventory = await YarnInventory.findOne({ yarn: yarnCatalog._id });
      
      if (!inventory) {
        inventory = new YarnInventory({
          yarn: yarnCatalog._id,
          yarnName: yarnCatalog.yarnName,
          totalInventory: { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 },
          longTermInventory: { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 },
          shortTermInventory: { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 },
          blockedNetWeight: 0,
          inventoryStatus: 'in_stock',
          overbooked: false,
        });
      }

      // Update long-term inventory
      const delta = {
        totalWeight: box.boxWeight || 0,
        totalNetWeight: netWeight,
        totalTearWeight: box.tearweight || 0,
        numberOfCones: box.numberOfCones || 0,
      };

      const ltBucket = ensureBucket(inventory, 'longTermInventory');
      applyDelta(ltBucket, delta);
      
      // Also ensure yarnName is set
      if (!inventory.yarnName) {
        inventory.yarnName = yarnCatalog.yarnName;
      }

      // Recalculate total inventory
      recalcTotalInventory(inventory);

      // Update status
      updateInventoryStatus(inventory, yarnCatalog);

      // Save inventory
      await inventory.save();

      // Create transaction record
      const transaction = new YarnTransaction({
        yarn: yarnCatalog._id,
        yarnName: yarnCatalog.yarnName,
        transactionType: 'yarn_stocked',
        transactionDate: box.receivedDate || box.createdAt || new Date(),
        transactionTotalWeight: box.boxWeight || 0,
        transactionNetWeight: netWeight,
        transactionTearWeight: box.tearweight || 0,
        transactionConeCount: box.numberOfCones || 0,
        orderno: box.boxId,
      });
      await transaction.save();

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
