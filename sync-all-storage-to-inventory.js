import mongoose from 'mongoose';
import config from './src/config/config.js';
import { YarnBox, YarnCatalog, YarnTransaction, YarnInventory } from './src/models/index.js';

/**
 * Comprehensive sync script that:
 * 1. Finds ALL boxes in ALL long-term storage locations
 * 2. Groups by storage location for reporting
 * 3. Syncs to inventory with detailed tracking
 * 4. Handles missing yarn catalogs gracefully
 */

const connectDB = async () => {
  try {
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    console.log('✅ Connected to MongoDB\n');
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

const syncAllStorageToInventory = async () => {
  console.log('='.repeat(80));
  console.log('🔄 COMPREHENSIVE STORAGE TO INVENTORY SYNC');
  console.log('='.repeat(80));
  console.log();

  // Step 1: Find ALL boxes in long-term storage (all locations)
  const allLongTermBoxes = await YarnBox.find({
    storedStatus: true,
    storageLocation: { $regex: /^LT-/i },
    boxWeight: { $gt: 0 },
  }).lean();

  console.log(`📦 Found ${allLongTermBoxes.length} boxes in long-term storage\n`);

  // Group by storage location
  const boxesByLocation = {};
  allLongTermBoxes.forEach(box => {
    const location = box.storageLocation || 'UNKNOWN';
    if (!boxesByLocation[location]) {
      boxesByLocation[location] = [];
    }
    boxesByLocation[location].push(box);
  });

  console.log('📊 Boxes by Storage Location:');
  Object.entries(boxesByLocation).forEach(([location, boxes]) => {
    console.log(`  ${location}: ${boxes.length} boxes`);
  });
  console.log();

  // Step 2: Categorize boxes
  const stats = {
    processed: 0,
    created: 0,
    skipped: 0,
    errors: 0,
    notFound: [],
    noQcApproval: [],
    alreadySynced: [],
    invalidWeight: [],
  };

  // Group by QC status
  const qcApproved = allLongTermBoxes.filter(b => b.qcData?.status === 'qc_approved');
  const qcNotApproved = allLongTermBoxes.filter(b => !b.qcData || b.qcData.status !== 'qc_approved');

  console.log(`📋 QC Status Breakdown:`);
  console.log(`  ✅ QC Approved: ${qcApproved.length} boxes`);
  console.log(`  ⚠️  Not QC Approved: ${qcNotApproved.length} boxes`);
  if (qcNotApproved.length > 0) {
    console.log(`  ⚠️  Note: Only QC-approved boxes will be synced`);
    qcNotApproved.forEach(box => {
      stats.noQcApproval.push({
        boxId: box.boxId,
        yarnName: box.yarnName,
        storageLocation: box.storageLocation,
        qcStatus: box.qcData?.status || 'no_qc_data',
      });
    });
  }
  console.log();

  // Step 3: Process QC-approved boxes
  console.log('🔄 Processing QC-approved boxes...\n');

  for (const box of qcApproved) {
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
        continue;
      }

      // Check if transaction already exists
      const exists = await checkIfTransactionExists(box.boxId, yarnCatalog._id);
      if (exists) {
        stats.alreadySynced.push({
          boxId: box.boxId,
          yarnName: box.yarnName,
          storageLocation: box.storageLocation,
        });
        stats.skipped++;
        continue;
      }

      // Calculate net weight (boxWeight - tearweight)
      const netWeight = (box.boxWeight || 0) - (box.tearweight || 0);
      if (netWeight <= 0) {
        stats.invalidWeight.push({
          boxId: box.boxId,
          yarnName: box.yarnName,
          boxWeight: box.boxWeight,
          tearweight: box.tearweight,
          netWeight,
        });
        stats.skipped++;
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

      // Recalculate total inventory
      recalcTotalInventory(inventory);

      // Update status
      updateInventoryStatus(inventory, yarnCatalog);

      // Ensure yarnName is set
      if (!inventory.yarnName) {
        inventory.yarnName = yarnCatalog.yarnName;
      }

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
      console.log(`✅ Synced: ${box.boxId} (${box.yarnName}) - ${netWeight}kg, ${box.numberOfCones || 0} cones [${box.storageLocation}]`);
    } catch (error) {
      stats.errors++;
      console.error(`❌ Error processing box ${box.boxId}:`, error.message);
    }
  }

  // Step 4: Detailed Report
  console.log('\n' + '='.repeat(80));
  console.log('📊 SYNC SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total boxes in LT storage: ${allLongTermBoxes.length}`);
  console.log(`QC-approved boxes: ${qcApproved.length}`);
  console.log(`Processed: ${stats.processed}`);
  console.log(`✅ Transactions created: ${stats.created}`);
  console.log(`⏭️  Skipped: ${stats.skipped}`);
  console.log(`❌ Errors: ${stats.errors}`);
  console.log();

  if (stats.created > 0) {
    console.log(`✅ Successfully synced ${stats.created} boxes to inventory!`);
  }

  if (stats.alreadySynced.length > 0) {
    console.log(`\n⏭️  ${stats.alreadySynced.length} boxes already synced (skipped):`);
    stats.alreadySynced.slice(0, 5).forEach(item => {
      console.log(`   - ${item.boxId} (${item.yarnName}) [${item.storageLocation}]`);
    });
    if (stats.alreadySynced.length > 5) {
      console.log(`   ... and ${stats.alreadySynced.length - 5} more`);
    }
  }

  if (stats.notFound.length > 0) {
    console.log(`\n⚠️  ${stats.notFound.length} boxes without matching yarn catalog:`);
    const uniqueYarns = [...new Set(stats.notFound.map(b => b.yarnName))];
    uniqueYarns.forEach(yarnName => {
      const count = stats.notFound.filter(b => b.yarnName === yarnName).length;
      console.log(`   - ${yarnName} (${count} boxes)`);
    });
    console.log(`\n💡 Action required: Create yarn catalogs for these yarn names or update box yarnName to match existing catalogs`);
  }

  if (stats.noQcApproval.length > 0) {
    console.log(`\n⚠️  ${stats.noQcApproval.length} boxes not QC-approved (not synced):`);
    const byStatus = {};
    stats.noQcApproval.forEach(item => {
      const status = item.qcStatus;
      if (!byStatus[status]) byStatus[status] = [];
      byStatus[status].push(item);
    });
    Object.entries(byStatus).forEach(([status, items]) => {
      console.log(`   - ${status}: ${items.length} boxes`);
    });
  }

  if (stats.invalidWeight.length > 0) {
    console.log(`\n⚠️  ${stats.invalidWeight.length} boxes with invalid weight (not synced):`);
    stats.invalidWeight.slice(0, 5).forEach(item => {
      console.log(`   - ${item.boxId}: weight=${item.boxWeight}kg, tear=${item.tearweight}kg, net=${item.netWeight}kg`);
    });
  }

  // Step 5: Verify final inventory state
  console.log('\n' + '='.repeat(80));
  console.log('✅ FINAL INVENTORY STATE');
  console.log('='.repeat(80));
  const allInventories = await YarnInventory.find({}).lean();
  console.log(`Total inventory records: ${allInventories.length}`);
  
  let totalLTWeight = 0;
  let totalSTWeight = 0;
  allInventories.forEach(inv => {
    const lt = inv.longTermInventory?.totalNetWeight || 0;
    const st = inv.shortTermInventory?.totalNetWeight || 0;
    totalLTWeight += lt;
    totalSTWeight += st;
  });
  
  console.log(`Total Long-Term Inventory: ${totalLTWeight.toFixed(2)}kg`);
  console.log(`Total Short-Term Inventory: ${totalSTWeight.toFixed(2)}kg`);
  console.log(`Total Inventory: ${(totalLTWeight + totalSTWeight).toFixed(2)}kg`);
  console.log();

  console.log('✅ Sync completed!\n');
};

const main = async () => {
  try {
    await connectDB();
    await syncAllStorageToInventory();
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
