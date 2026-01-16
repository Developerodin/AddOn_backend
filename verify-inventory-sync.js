import mongoose from 'mongoose';
import config from './src/config/config.js';
import { YarnBox, YarnCatalog, YarnTransaction, YarnInventory } from './src/models/index.js';

/**
 * Verify that all boxes in long-term storage are reflected in yarn inventory
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

const verifyInventory = async () => {
  console.log('='.repeat(80));
  console.log('🔍 VERIFYING YARN INVENTORY SYNC');
  console.log('='.repeat(80));
  console.log();

  // Get all boxes in long-term storage
  const longTermBoxes = await YarnBox.find({
    storedStatus: true,
    storageLocation: { $regex: /^LT-/i },
    boxWeight: { $gt: 0 },
  }).lean();

  console.log(`📦 Total boxes in long-term storage: ${longTermBoxes.length}\n`);

  // Group boxes by yarnName
  const boxesByYarn = {};
  const boxesWithoutCatalog = [];
  const boxesWithCatalog = [];

  for (const box of longTermBoxes) {
    const yarnName = box.yarnName;
    if (!boxesByYarn[yarnName]) {
      boxesByYarn[yarnName] = [];
    }
    boxesByYarn[yarnName].push(box);

    // Check if catalog exists
    const catalog = await findYarnCatalogByYarnName(yarnName);
    if (catalog) {
      boxesWithCatalog.push({ box, catalog });
    } else {
      boxesWithoutCatalog.push(box);
    }
  }

  console.log(`📊 Summary:`);
  console.log(`   - Unique yarn names: ${Object.keys(boxesByYarn).length}`);
  console.log(`   - Boxes with matching catalog: ${boxesWithCatalog.length}`);
  console.log(`   - Boxes without matching catalog: ${boxesWithoutCatalog.length}`);
  console.log();

  // Check inventory for each yarn
  const inventoryIssues = [];
  const inventoryCorrect = [];
  const missingInInventory = [];

  for (const { box, catalog } of boxesWithCatalog) {
    const inventory = await YarnInventory.findOne({ yarn: catalog._id }).lean();
    
    if (!inventory) {
      missingInInventory.push({
        yarnName: box.yarnName,
        yarnId: catalog._id,
        boxCount: boxesByYarn[box.yarnName].length,
        totalWeight: boxesByYarn[box.yarnName].reduce((sum, b) => sum + (b.boxWeight || 0), 0),
        totalCones: boxesByYarn[box.yarnName].reduce((sum, b) => sum + (b.numberOfCones || 0), 0),
      });
      continue;
    }

    // Calculate expected values from boxes
    const boxesForYarn = boxesByYarn[box.yarnName];
    const expectedWeight = boxesForYarn.reduce((sum, b) => {
      const netWeight = (b.boxWeight || 0) - (b.tearweight || 0);
      return sum + netWeight;
    }, 0);
    const expectedCones = boxesForYarn.reduce((sum, b) => sum + (b.numberOfCones || 0), 0);
    const expectedTotalWeight = boxesForYarn.reduce((sum, b) => sum + (b.boxWeight || 0), 0);

    // Get actual inventory values
    const actualWeight = (inventory.longTermInventory?.totalNetWeight || 0);
    const actualCones = (inventory.longTermInventory?.numberOfCones || 0);
    const actualTotalWeight = (inventory.longTermInventory?.totalWeight || 0);

    // Check if they match (allow small rounding differences)
    const weightDiff = Math.abs(expectedWeight - actualWeight);
    const conesDiff = Math.abs(expectedCones - actualCones);
    const totalWeightDiff = Math.abs(expectedTotalWeight - actualTotalWeight);

    const tolerance = 0.01; // 0.01kg tolerance

    if (weightDiff > tolerance || conesDiff > 0.1 || totalWeightDiff > tolerance) {
      inventoryIssues.push({
        yarnName: box.yarnName,
        yarnId: catalog._id,
        expected: {
          netWeight: expectedWeight,
          totalWeight: expectedTotalWeight,
          cones: expectedCones,
        },
        actual: {
          netWeight: actualWeight,
          totalWeight: actualTotalWeight,
          cones: actualCones,
        },
        differences: {
          weight: weightDiff,
          cones: conesDiff,
          totalWeight: totalWeightDiff,
        },
        boxCount: boxesForYarn.length,
      });
    } else {
      inventoryCorrect.push({
        yarnName: box.yarnName,
        netWeight: actualWeight,
        cones: actualCones,
        boxCount: boxesForYarn.length,
      });
    }
  }

  // Check transactions
  console.log('📝 Checking transactions...\n');
  const transactionStats = {
    total: 0,
    byType: {},
    missing: [],
  };

  for (const { box, catalog } of boxesWithCatalog) {
    const transaction = await YarnTransaction.findOne({
      yarn: catalog._id,
      transactionType: 'yarn_stocked',
      orderno: box.boxId,
    });

    if (!transaction) {
      transactionStats.missing.push({
        boxId: box.boxId,
        yarnName: box.yarnName,
      });
    } else {
      transactionStats.total++;
      const type = transaction.transactionType;
      transactionStats.byType[type] = (transactionStats.byType[type] || 0) + 1;
    }
  }

  // Print detailed report
  console.log('='.repeat(80));
  console.log('📋 DETAILED REPORT');
  console.log('='.repeat(80));
  console.log();

  if (inventoryCorrect.length > 0) {
    console.log(`✅ ${inventoryCorrect.length} yarns with CORRECT inventory:`);
    inventoryCorrect.slice(0, 10).forEach(item => {
      console.log(`   ✓ ${item.yarnName}: ${item.netWeight.toFixed(2)}kg, ${item.cones} cones (${item.boxCount} boxes)`);
    });
    if (inventoryCorrect.length > 10) {
      console.log(`   ... and ${inventoryCorrect.length - 10} more`);
    }
    console.log();
  }

  if (missingInInventory.length > 0) {
    console.log(`❌ ${missingInInventory.length} yarns MISSING from inventory:`);
    missingInInventory.forEach(item => {
      console.log(`   ✗ ${item.yarnName}`);
      console.log(`     Expected: ${item.totalWeight.toFixed(2)}kg, ${item.totalCones} cones (${item.boxCount} boxes)`);
      console.log(`     Status: No inventory record exists`);
    });
    console.log();
  }

  if (inventoryIssues.length > 0) {
    console.log(`⚠️  ${inventoryIssues.length} yarns with MISMATCHED inventory:`);
    inventoryIssues.forEach(item => {
      console.log(`   ⚠ ${item.yarnName}`);
      console.log(`     Expected Net Weight: ${item.expected.netWeight.toFixed(2)}kg`);
      console.log(`     Actual Net Weight: ${item.actual.netWeight.toFixed(2)}kg`);
      console.log(`     Difference: ${item.differences.weight.toFixed(2)}kg`);
      console.log(`     Expected Cones: ${item.expected.cones}`);
      console.log(`     Actual Cones: ${item.actual.cones}`);
      console.log(`     Box Count: ${item.boxCount}`);
      console.log();
    });
  }

  if (boxesWithoutCatalog.length > 0) {
    console.log(`⚠️  ${boxesWithoutCatalog.length} boxes without matching yarn catalog:`);
    const uniqueYarns = [...new Set(boxesWithoutCatalog.map(b => b.yarnName))];
    uniqueYarns.forEach(yarnName => {
      const count = boxesWithoutCatalog.filter(b => b.yarnName === yarnName).length;
      console.log(`   - ${yarnName} (${count} boxes)`);
    });
    console.log();
  }

  if (transactionStats.missing.length > 0) {
    console.log(`❌ ${transactionStats.missing.length} boxes MISSING transactions:`);
    transactionStats.missing.slice(0, 10).forEach(item => {
      console.log(`   - Box ${item.boxId} (${item.yarnName})`);
    });
    if (transactionStats.missing.length > 10) {
      console.log(`   ... and ${transactionStats.missing.length - 10} more`);
    }
    console.log();
  }

  // Final summary
  console.log('='.repeat(80));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total boxes in LT storage: ${longTermBoxes.length}`);
  console.log(`✅ Correctly synced: ${inventoryCorrect.length} yarns`);
  console.log(`❌ Missing from inventory: ${missingInInventory.length} yarns`);
  console.log(`⚠️  Mismatched inventory: ${inventoryIssues.length} yarns`);
  console.log(`⚠️  No catalog match: ${boxesWithoutCatalog.length} boxes`);
  console.log(`📝 Transactions: ${transactionStats.total} found, ${transactionStats.missing.length} missing`);
  console.log();

  if (missingInInventory.length > 0 || inventoryIssues.length > 0 || transactionStats.missing.length > 0) {
    console.log('💡 RECOMMENDATION: Run sync-boxes-to-yarn-inventory-direct.js to fix issues');
  } else {
    console.log('✅ All boxes are properly synced to inventory!');
  }
  console.log();
};

const main = async () => {
  try {
    await connectDB();
    await verifyInventory();
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
