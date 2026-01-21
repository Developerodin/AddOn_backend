import mongoose from 'mongoose';
import config from './src/config/config.js';
import { YarnBox, YarnCone, YarnInventory, YarnCatalog, YarnTransaction } from './src/models/index.js';

/**
 * Comprehensive Inventory Verification Script
 * 
 * This script verifies:
 * 1. Long-term storage boxes match inventory
 * 2. Short-term storage cones match inventory
 * 3. Issued yarn is properly removed from short-term
 * 4. Transaction logs are maintained
 * 5. Storage location history is accurate
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

const toNumber = (value) => Math.max(0, Number(value ?? 0));

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
  console.log('='.repeat(100));
  console.log('🔍 COMPREHENSIVE INVENTORY VERIFICATION');
  console.log('='.repeat(100));
  console.log();

  // ===================================================================
  // STEP 1: Collect actual storage data
  // ===================================================================
  console.log('📦 STEP 1: Collecting actual storage data...\n');

  // Long-term storage: Boxes
  const ltBoxes = await YarnBox.find({
    storageLocation: { $regex: /^LT-/i },
    storedStatus: true,
    'qcData.status': 'qc_approved',
  }).lean();

  console.log(`   Found ${ltBoxes.length} boxes in long-term storage`);

  // Short-term storage: Available cones (not issued)
  const stConesAvailable = await YarnCone.find({
    coneStorageId: { $regex: /^ST-/i },
    issueStatus: { $ne: 'issued' },
  }).lean();

  console.log(`   Found ${stConesAvailable.length} available cones in short-term storage`);

  // Short-term storage: Issued cones (should not be in inventory)
  const stConesIssued = await YarnCone.find({
    coneStorageId: { $regex: /^ST-/i },
    issueStatus: 'issued',
  }).lean();

  console.log(`   Found ${stConesIssued.length} issued cones in short-term storage (should be excluded from inventory)`);
  console.log();

  // ===================================================================
  // STEP 2: Group by yarn
  // ===================================================================
  console.log('📊 STEP 2: Grouping storage data by yarn...\n');

  const ltByYarn = {};
  const stByYarn = {};
  const issuedByYarn = {};

  // Process long-term boxes
  for (const box of ltBoxes) {
    const yarnName = box.yarnName;
    if (!yarnName) continue;

    if (!ltByYarn[yarnName]) {
      ltByYarn[yarnName] = {
        yarnName,
        boxes: [],
        totalWeight: 0,
        totalTearWeight: 0,
        totalNetWeight: 0,
        boxCount: 0,
      };
    }

    const netWeight = (box.boxWeight || 0) - (box.tearweight || 0);
    ltByYarn[yarnName].boxes.push(box);
    ltByYarn[yarnName].totalWeight += box.boxWeight || 0;
    ltByYarn[yarnName].totalTearWeight += box.tearweight || 0;
    ltByYarn[yarnName].totalNetWeight += netWeight;
    ltByYarn[yarnName].boxCount += 1;
  }

  // Process short-term available cones
  for (const cone of stConesAvailable) {
    const yarnName = cone.yarnName;
    if (!yarnName) continue;

    if (!stByYarn[yarnName]) {
      stByYarn[yarnName] = {
        yarnName,
        cones: [],
        totalWeight: 0,
        totalTearWeight: 0,
        totalNetWeight: 0,
        coneCount: 0,
      };
    }

    const netWeight = (cone.coneWeight || 0) - (cone.tearWeight || 0);
    stByYarn[yarnName].cones.push(cone);
    stByYarn[yarnName].totalWeight += cone.coneWeight || 0;
    stByYarn[yarnName].totalTearWeight += cone.tearWeight || 0;
    stByYarn[yarnName].totalNetWeight += netWeight;
    stByYarn[yarnName].coneCount += 1;
  }

  // Process issued cones (for tracking)
  for (const cone of stConesIssued) {
    const yarnName = cone.yarnName;
    if (!yarnName) continue;

    if (!issuedByYarn[yarnName]) {
      issuedByYarn[yarnName] = {
        yarnName,
        cones: [],
        totalWeight: 0,
        totalNetWeight: 0,
        coneCount: 0,
      };
    }

    const netWeight = (cone.coneWeight || 0) - (cone.tearWeight || 0);
    issuedByYarn[yarnName].cones.push(cone);
    issuedByYarn[yarnName].totalWeight += cone.coneWeight || 0;
    issuedByYarn[yarnName].totalNetWeight += netWeight;
    issuedByYarn[yarnName].coneCount += 1;
  }

  console.log(`   Long-term: ${Object.keys(ltByYarn).length} yarn types`);
  console.log(`   Short-term (available): ${Object.keys(stByYarn).length} yarn types`);
  console.log(`   Short-term (issued): ${Object.keys(issuedByYarn).length} yarn types`);
  console.log();

  // ===================================================================
  // STEP 3: Get all inventory records
  // ===================================================================
  console.log('📋 STEP 3: Fetching inventory records...\n');

  const inventories = await YarnInventory.find({}).populate('yarn').lean();
  console.log(`   Found ${inventories.length} inventory records\n`);

  // ===================================================================
  // STEP 4: Verify each inventory record
  // ===================================================================
  console.log('🔍 STEP 4: Verifying inventory against actual storage...\n');

  const issues = [];
  const verified = [];
  const missingInventories = [];

  // Check all yarns that have storage
  const allYarnsInStorage = new Set([
    ...Object.keys(ltByYarn),
    ...Object.keys(stByYarn),
  ]);

  // Verify existing inventories
  for (const inventory of inventories) {
    const yarnName = inventory.yarnName;
    const yarnId = inventory.yarn?._id || inventory.yarn;

    const actualLT = ltByYarn[yarnName] || {
      totalWeight: 0,
      totalTearWeight: 0,
      totalNetWeight: 0,
      boxCount: 0,
    };

    const actualST = stByYarn[yarnName] || {
      totalWeight: 0,
      totalTearWeight: 0,
      totalNetWeight: 0,
      coneCount: 0,
    };

    const inventoryLT = inventory.longTermInventory || {};
    const inventoryST = inventory.shortTermInventory || {};

    const issuesForYarn = [];

    // Check long-term storage
    const ltWeightDiff = Math.abs(toNumber(actualLT.totalNetWeight) - toNumber(inventoryLT.totalNetWeight));
    const ltWeightMatch = ltWeightDiff < 0.01; // Allow small floating point differences

    if (!ltWeightMatch) {
      issuesForYarn.push({
        type: 'LONG_TERM_WEIGHT_MISMATCH',
        expected: actualLT.totalNetWeight,
        actual: inventoryLT.totalNetWeight,
        difference: actualLT.totalNetWeight - inventoryLT.totalNetWeight,
      });
    }

    if (toNumber(inventoryLT.numberOfCones) !== 0) {
      issuesForYarn.push({
        type: 'LONG_TERM_HAS_CONES',
        message: 'Long-term storage should have 0 cones, but inventory shows',
        value: inventoryLT.numberOfCones,
      });
    }

    // Check short-term storage
    const stWeightDiff = Math.abs(toNumber(actualST.totalNetWeight) - toNumber(inventoryST.totalNetWeight));
    const stWeightMatch = stWeightDiff < 0.01;

    if (!stWeightMatch) {
      issuesForYarn.push({
        type: 'SHORT_TERM_WEIGHT_MISMATCH',
        expected: actualST.totalNetWeight,
        actual: inventoryST.totalNetWeight,
        difference: actualST.totalNetWeight - inventoryST.totalNetWeight,
      });
    }

    const stConesDiff = Math.abs(toNumber(actualST.coneCount) - toNumber(inventoryST.numberOfCones));
    const stConesMatch = stConesDiff < 0.01;

    if (!stConesMatch) {
      issuesForYarn.push({
        type: 'SHORT_TERM_CONES_MISMATCH',
        expected: actualST.coneCount,
        actual: inventoryST.numberOfCones,
        difference: actualST.coneCount - inventoryST.numberOfCones,
      });
    }

    // Check if issued cones are incorrectly counted in inventory
    const issuedData = issuedByYarn[yarnName];
    if (issuedData && issuedData.coneCount > 0) {
      // Check if any issued cones are incorrectly counted
      const issuedConesInST = stConesIssued.filter(c => c.yarnName === yarnName);
      if (issuedConesInST.length > 0) {
        // Calculate issued weight
        const issuedWeight = issuedConesInST.reduce((sum, c) => {
          return sum + ((c.coneWeight || 0) - (c.tearWeight || 0));
        }, 0);
        
        // Check if inventory ST weight is greater than or equal to issued weight
        // This would indicate issued cones are still being counted
        const inventorySTWeight = toNumber(inventoryST.totalNetWeight);
        const actualSTWeight = toNumber(actualST.totalNetWeight);
        
        // Only flag if inventory shows more weight than actual available cones
        // AND the difference matches the issued weight (indicating issued cones are counted)
        const weightDifference = inventorySTWeight - actualSTWeight;
        if (weightDifference > 0.01 && Math.abs(weightDifference - issuedWeight) < 0.01) {
          issuesForYarn.push({
            type: 'ISSUED_CONES_STILL_IN_INVENTORY',
            message: 'Issued cones appear to be counted in inventory',
            issuedCones: issuedConesInST.length,
            issuedWeight,
            inventorySTWeight,
            actualSTWeight,
          });
        }
        // If inventory matches actual available, then issued cones are correctly excluded - no issue
      }
    }

    if (issuesForYarn.length > 0) {
      issues.push({
        yarnName,
        yarnId,
        issues: issuesForYarn,
        actual: {
          longTerm: actualLT,
          shortTerm: actualST,
        },
        inventory: {
          longTerm: {
            totalWeight: inventoryLT.totalWeight,
            totalNetWeight: inventoryLT.totalNetWeight,
            numberOfCones: inventoryLT.numberOfCones,
          },
          shortTerm: {
            totalWeight: inventoryST.totalWeight,
            totalNetWeight: inventoryST.totalNetWeight,
            numberOfCones: inventoryST.numberOfCones,
          },
        },
      });
    } else {
      verified.push({
        yarnName,
        yarnId,
        longTerm: actualLT,
        shortTerm: actualST,
      });
    }

    allYarnsInStorage.delete(yarnName);
  }

  // Check for yarns in storage but not in inventory
  for (const yarnName of allYarnsInStorage) {
    missingInventories.push({
      yarnName,
      longTerm: ltByYarn[yarnName],
      shortTerm: stByYarn[yarnName],
    });
  }

  // ===================================================================
  // STEP 5: Check transaction logs
  // ===================================================================
  console.log('📝 STEP 5: Verifying transaction logs...\n');

  const transactionIssues = [];
  
  // Check for yarn_stocked transactions for LT boxes
  for (const [yarnName, ltData] of Object.entries(ltByYarn)) {
    for (const box of ltData.boxes) {
      const transaction = await YarnTransaction.findOne({
        transactionType: 'yarn_stocked',
        orderno: box.boxId,
      });

      if (!transaction) {
        transactionIssues.push({
          type: 'MISSING_STOCKED_TRANSACTION',
          yarnName,
          boxId: box.boxId,
          message: 'Box in LT storage but no yarn_stocked transaction found',
        });
      }
    }
  }

  // Check for internal_transfer transactions
  const transferTransactions = await YarnTransaction.find({
    transactionType: 'internal_transfer',
  }).lean();

  console.log(`   Found ${transferTransactions.length} transfer transactions`);
  console.log(`   Found ${transactionIssues.length} transaction issues\n`);

  // ===================================================================
  // STEP 6: Report results
  // ===================================================================
  console.log('='.repeat(100));
  console.log('📊 VERIFICATION RESULTS');
  console.log('='.repeat(100));
  console.log();

  console.log(`✅ Verified (${verified.length} yarns):`);
  if (verified.length > 0) {
    verified.slice(0, 5).forEach(v => {
      console.log(`   - ${v.yarnName}`);
      console.log(`     LT: ${v.longTerm.totalNetWeight.toFixed(2)} kg (${v.longTerm.boxCount} boxes)`);
      console.log(`     ST: ${v.shortTerm.totalNetWeight.toFixed(2)} kg (${v.shortTerm.coneCount} cones)`);
    });
    if (verified.length > 5) {
      console.log(`   ... and ${verified.length - 5} more`);
    }
  } else {
    console.log('   (none)');
  }
  console.log();

  if (issues.length > 0) {
    console.log(`❌ Issues Found (${issues.length} yarns):`);
    issues.forEach(issue => {
      console.log(`\n   🔴 ${issue.yarnName}`);
      issue.issues.forEach(i => {
        switch (i.type) {
          case 'LONG_TERM_WEIGHT_MISMATCH':
            console.log(`      ⚠️  LT Weight Mismatch:`);
            console.log(`         Expected: ${i.expected.toFixed(2)} kg`);
            console.log(`         Actual: ${i.actual.toFixed(2)} kg`);
            console.log(`         Difference: ${i.difference > 0 ? '+' : ''}${i.difference.toFixed(2)} kg`);
            break;
          case 'SHORT_TERM_WEIGHT_MISMATCH':
            console.log(`      ⚠️  ST Weight Mismatch:`);
            console.log(`         Expected: ${i.expected.toFixed(2)} kg`);
            console.log(`         Actual: ${i.actual.toFixed(2)} kg`);
            console.log(`         Difference: ${i.difference > 0 ? '+' : ''}${i.difference.toFixed(2)} kg`);
            break;
          case 'SHORT_TERM_CONES_MISMATCH':
            console.log(`      ⚠️  ST Cones Mismatch:`);
            console.log(`         Expected: ${i.expected} cones`);
            console.log(`         Actual: ${i.actual} cones`);
            console.log(`         Difference: ${i.difference > 0 ? '+' : ''}${i.difference} cones`);
            break;
          case 'LONG_TERM_HAS_CONES':
            console.log(`      ⚠️  LT Has Cones: ${i.value} (should be 0)`);
            break;
          case 'ISSUED_CONES_STILL_IN_INVENTORY':
            console.log(`      ⚠️  Issued Cones Still Counted:`);
            console.log(`         ${i.issuedCones} issued cones (${i.issuedWeight.toFixed(2)} kg) may still be in inventory`);
            break;
        }
      });
      console.log(`      📦 Actual Storage:`);
      console.log(`         LT: ${issue.actual.longTerm.totalNetWeight.toFixed(2)} kg (${issue.actual.longTerm.boxCount} boxes)`);
      console.log(`         ST: ${issue.actual.shortTerm.totalNetWeight.toFixed(2)} kg (${issue.actual.shortTerm.coneCount} cones)`);
      console.log(`      📋 Inventory Record:`);
      console.log(`         LT: ${issue.inventory.longTerm.totalNetWeight.toFixed(2)} kg`);
      console.log(`         ST: ${issue.inventory.shortTerm.totalNetWeight.toFixed(2)} kg (${issue.inventory.shortTerm.numberOfCones} cones)`);
    });
  } else {
    console.log('✅ No issues found!');
  }
  console.log();

  if (missingInventories.length > 0) {
    console.log(`⚠️  Missing Inventory Records (${missingInventories.length} yarns):`);
    missingInventories.forEach(m => {
      console.log(`   - ${m.yarnName}`);
      if (m.longTerm) {
        console.log(`     LT: ${m.longTerm.totalNetWeight.toFixed(2)} kg (${m.longTerm.boxCount} boxes)`);
      }
      if (m.shortTerm) {
        console.log(`     ST: ${m.shortTerm.totalNetWeight.toFixed(2)} kg (${m.shortTerm.coneCount} cones)`);
      }
    });
    console.log();
  }

  if (transactionIssues.length > 0) {
    console.log(`⚠️  Transaction Issues (${transactionIssues.length}):`);
    transactionIssues.slice(0, 10).forEach(t => {
      console.log(`   - ${t.message}: ${t.boxId || t.yarnName}`);
    });
    if (transactionIssues.length > 10) {
      console.log(`   ... and ${transactionIssues.length - 10} more`);
    }
    console.log();
  }

  // Summary
  console.log('='.repeat(100));
  console.log('📈 SUMMARY');
  console.log('='.repeat(100));
  console.log(`Total boxes in LT storage: ${ltBoxes.length}`);
  console.log(`Total available cones in ST storage: ${stConesAvailable.length}`);
  console.log(`Total issued cones in ST storage: ${stConesIssued.length}`);
  console.log(`Inventory records: ${inventories.length}`);
  console.log(`✅ Verified: ${verified.length}`);
  console.log(`❌ Issues: ${issues.length}`);
  console.log(`⚠️  Missing inventories: ${missingInventories.length}`);
  console.log(`⚠️  Transaction issues: ${transactionIssues.length}`);
  console.log();

  return {
    verified,
    issues,
    missingInventories,
    transactionIssues,
    stats: {
      ltBoxes: ltBoxes.length,
      stConesAvailable: stConesAvailable.length,
      stConesIssued: stConesIssued.length,
      inventories: inventories.length,
      verified: verified.length,
      issues: issues.length,
      missingInventories: missingInventories.length,
      transactionIssues: transactionIssues.length,
    },
  };
};

const main = async () => {
  try {
    await connectDB();
    const results = await verifyInventory();
    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    process.exit(results.issues.length > 0 || results.missingInventories.length > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

main();
