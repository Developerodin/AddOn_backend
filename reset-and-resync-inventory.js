import mongoose from 'mongoose';
import config from './src/config/config.js';
import { YarnBox, YarnCatalog, YarnTransaction, YarnInventory } from './src/models/index.js';

/**
 * Step 1: Check current inventory state
 * Step 2: Reset inventory to zero
 * Step 3: Delete yarn_stocked transactions
 * Step 4: Resync all boxes from storage
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
  
  let catalog = await YarnCatalog.findOne({ 
    yarnName: yarnName.trim(),
    status: { $ne: 'deleted' }
  });
  
  if (catalog) return catalog;
  
  catalog = await YarnCatalog.findOne({ 
    yarnName: { $regex: new RegExp(`^${yarnName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    status: { $ne: 'deleted' }
  });
  
  return catalog;
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

const checkCurrentInventory = async () => {
  console.log('='.repeat(80));
  console.log('📊 STEP 1: CHECKING CURRENT INVENTORY STATE');
  console.log('='.repeat(80));
  console.log();

  const allInventories = await YarnInventory.find({}).lean();
  console.log(`Total inventory records: ${allInventories.length}\n`);

  if (allInventories.length > 0) {
    console.log('Current Inventory:');
    let totalLT = 0;
    let totalST = 0;
    
    allInventories.forEach((inv, idx) => {
      const lt = inv.longTermInventory || {};
      const st = inv.shortTermInventory || {};
      const ltNet = lt.totalNetWeight || 0;
      const stNet = st.totalNetWeight || 0;
      totalLT += ltNet;
      totalST += stNet;
      
      console.log(`\n${idx + 1}. ${inv.yarnName || 'N/A'}`);
      console.log(`   Long-Term: ${ltNet.toFixed(2)}kg, ${lt.numberOfCones || 0} cones`);
      console.log(`   Short-Term: ${stNet.toFixed(2)}kg, ${st.numberOfCones || 0} cones`);
      console.log(`   Status: ${inv.inventoryStatus || 'N/A'}`);
    });
    
    console.log(`\n📊 Totals:`);
    console.log(`   Long-Term: ${totalLT.toFixed(2)}kg`);
    console.log(`   Short-Term: ${totalST.toFixed(2)}kg`);
    console.log(`   Grand Total: ${(totalLT + totalST).toFixed(2)}kg`);
  } else {
    console.log('No inventory records found.');
  }

  const stockedTxns = await YarnTransaction.countDocuments({ transactionType: 'yarn_stocked' });
  console.log(`\n📝 yarn_stocked transactions: ${stockedTxns}`);
  console.log();
};

const resetInventory = async () => {
  console.log('='.repeat(80));
  console.log('🔄 STEP 2: RESETTING INVENTORY TO ZERO');
  console.log('='.repeat(80));
  console.log();

  // Reset all inventory records to zero
  const inventories = await YarnInventory.find({});
  let resetCount = 0;

  for (const inv of inventories) {
    inv.longTermInventory = {
      totalWeight: 0,
      totalTearWeight: 0,
      totalNetWeight: 0,
      numberOfCones: 0,
    };
    inv.shortTermInventory = {
      totalWeight: 0,
      totalTearWeight: 0,
      totalNetWeight: 0,
      numberOfCones: 0,
    };
    inv.totalInventory = {
      totalWeight: 0,
      totalTearWeight: 0,
      totalNetWeight: 0,
      numberOfCones: 0,
    };
    inv.blockedNetWeight = 0;
    inv.inventoryStatus = 'in_stock';
    inv.overbooked = false;
    
    await inv.save();
    resetCount++;
    console.log(`✅ Reset inventory for: ${inv.yarnName || 'N/A'}`);
  }

  console.log(`\n✅ Reset ${resetCount} inventory records to zero\n`);

  // Delete all yarn_stocked transactions
  const deleteResult = await YarnTransaction.deleteMany({ transactionType: 'yarn_stocked' });
  console.log(`🗑️  Deleted ${deleteResult.deletedCount} yarn_stocked transactions\n`);
};

const resyncFromStorage = async () => {
  console.log('='.repeat(80));
  console.log('🔄 STEP 3: RESYNCING FROM STORAGE');
  console.log('='.repeat(80));
  console.log();

  // Find all QC-approved boxes in long-term storage
  const longTermBoxes = await YarnBox.find({
    storedStatus: true,
    storageLocation: { $regex: /^LT-/i },
    boxWeight: { $gt: 0 },
    'qcData.status': 'qc_approved',
  }).lean();

  console.log(`📦 Found ${longTermBoxes.length} QC-approved boxes in long-term storage\n`);

  const stats = {
    processed: 0,
    created: 0,
    skipped: 0,
    errors: 0,
    notFound: [],
  };

  // Group by storage location
  const boxesByLocation = {};
  longTermBoxes.forEach(box => {
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

  // Process each box
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
        console.log(`⚠️  Skipped: ${box.boxId} - No catalog for "${box.yarnName}"`);
        continue;
      }

      // Calculate net weight
      const netWeight = (box.boxWeight || 0) - (box.tearweight || 0);
      if (netWeight <= 0) {
        stats.skipped++;
        console.log(`⚠️  Skipped: ${box.boxId} - Invalid net weight (${netWeight})`);
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
      // Long-term storage: Only weight (boxes), NO cones (cones are created when boxes are opened/transferred to ST)
      const delta = {
        totalWeight: box.boxWeight || 0,
        totalNetWeight: netWeight,
        totalTearWeight: box.tearweight || 0,
        numberOfCones: 0, // Boxes in LT storage don't have individual cones
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
      console.log(`✅ Synced: ${box.boxId} (${box.yarnName}) - ${netWeight.toFixed(2)}kg, ${box.numberOfCones || 0} cones [${box.storageLocation}]`);
    } catch (error) {
      stats.errors++;
      console.error(`❌ Error: ${box.boxId} -`, error.message);
    }
  }

  // Final summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 RESYNC SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total boxes processed: ${stats.processed}`);
  console.log(`✅ Transactions created: ${stats.created}`);
  console.log(`⏭️  Skipped: ${stats.skipped}`);
  console.log(`❌ Errors: ${stats.errors}`);

  if (stats.notFound.length > 0) {
    console.log(`\n⚠️  ${stats.notFound.length} boxes without matching yarn catalog:`);
    const uniqueYarns = [...new Set(stats.notFound.map(b => b.yarnName))];
    uniqueYarns.forEach(yarnName => {
      console.log(`   - ${yarnName}`);
    });
  }

  // Verify final state
  console.log('\n' + '='.repeat(80));
  console.log('✅ FINAL INVENTORY STATE');
  console.log('='.repeat(80));
  const finalInventories = await YarnInventory.find({}).lean();
  console.log(`Total inventory records: ${finalInventories.length}`);
  
  let totalLT = 0;
  let totalST = 0;
  let totalCones = 0;
  
  finalInventories.forEach((inv, idx) => {
    const lt = inv.longTermInventory || {};
    const st = inv.shortTermInventory || {};
    const ltNet = lt.totalNetWeight || 0;
    const stNet = st.totalNetWeight || 0;
    totalLT += ltNet;
    totalST += stNet;
    totalCones += (lt.numberOfCones || 0) + (st.numberOfCones || 0);
    
    console.log(`\n${idx + 1}. ${inv.yarnName || 'N/A'}`);
    console.log(`   Long-Term: ${ltNet.toFixed(2)}kg, ${lt.numberOfCones || 0} cones`);
    console.log(`   Short-Term: ${stNet.toFixed(2)}kg, ${st.numberOfCones || 0} cones`);
    console.log(`   Total: ${(ltNet + stNet).toFixed(2)}kg`);
    console.log(`   Status: ${inv.inventoryStatus || 'N/A'}`);
  });
  
  console.log(`\n📊 Grand Totals:`);
  console.log(`   Long-Term: ${totalLT.toFixed(2)}kg`);
  console.log(`   Short-Term: ${totalST.toFixed(2)}kg`);
  console.log(`   Total Weight: ${(totalLT + totalST).toFixed(2)}kg`);
  console.log(`   Total Cones: ${totalCones}`);
  console.log();

  const finalStockedTxns = await YarnTransaction.countDocuments({ transactionType: 'yarn_stocked' });
  console.log(`📝 yarn_stocked transactions: ${finalStockedTxns}`);
  console.log();
};

const main = async () => {
  try {
    await connectDB();
    
    // Step 1: Check current state
    await checkCurrentInventory();
    
    // Step 2: Reset to zero
    await resetInventory();
    
    // Step 3: Resync from storage
    await resyncFromStorage();
    
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
