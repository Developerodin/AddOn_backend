import mongoose from 'mongoose';
import config from './src/config/config.js';
import { YarnBox, YarnCone, YarnInventory, YarnCatalog, YarnTransaction } from './src/models/index.js';

/**
 * Fix Inventory Sync Issues
 * 
 * This script fixes discrepancies between actual storage and inventory records:
 * 1. Syncs long-term storage boxes to inventory
 * 2. Syncs short-term storage cones to inventory (excluding issued)
 * 3. Removes issued cones from inventory calculations
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

const fixInventorySync = async () => {
  console.log('='.repeat(100));
  console.log('🔧 FIXING INVENTORY SYNC ISSUES');
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
  console.log();

  // ===================================================================
  // STEP 2: Group by yarn
  // ===================================================================
  console.log('📊 STEP 2: Grouping storage data by yarn...\n');

  const ltByYarn = {};
  const stByYarn = {};

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

  console.log(`   Long-term: ${Object.keys(ltByYarn).length} yarn types`);
  console.log(`   Short-term: ${Object.keys(stByYarn).length} yarn types`);
  console.log();

  // ===================================================================
  // STEP 3: Fix inventory records
  // ===================================================================
  console.log('🔧 STEP 3: Fixing inventory records...\n');

  const stats = {
    processed: 0,
    updated: 0,
    created: 0,
    errors: 0,
  };

  // Get all unique yarns from storage
  const allYarns = new Set([
    ...Object.keys(ltByYarn),
    ...Object.keys(stByYarn),
  ]);

  for (const yarnName of allYarns) {
    try {
      stats.processed++;

      // Find yarn catalog
      const yarnCatalog = await findYarnCatalogByYarnName(yarnName);
      if (!yarnCatalog) {
        console.log(`⚠️  Skipped ${yarnName}: Yarn catalog not found`);
        stats.errors++;
        continue;
      }

      // Get or create inventory
      let inventory = await YarnInventory.findOne({ yarn: yarnCatalog._id });

      const isNew = !inventory;
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
        stats.created++;
      } else {
        stats.updated++;
      }

      // Get actual storage data
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

      // Ensure buckets exist
      if (!inventory.shortTermInventory) {
        inventory.shortTermInventory = { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 };
      }
      if (!inventory.longTermInventory) {
        inventory.longTermInventory = { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 };
      }
      if (!inventory.totalInventory) {
        inventory.totalInventory = { totalWeight: 0, totalTearWeight: 0, totalNetWeight: 0, numberOfCones: 0 };
      }

      // Update long-term inventory from actual boxes
      const lt = inventory.longTermInventory;
      lt.totalWeight = toNumber(actualLT.totalWeight);
      lt.totalTearWeight = toNumber(actualLT.totalTearWeight);
      lt.totalNetWeight = toNumber(actualLT.totalNetWeight);
      lt.numberOfCones = 0; // Always 0 for LT storage

      // Update short-term inventory from actual available cones
      const st = inventory.shortTermInventory;
      st.totalWeight = toNumber(actualST.totalWeight);
      st.totalTearWeight = toNumber(actualST.totalTearWeight);
      st.totalNetWeight = toNumber(actualST.totalNetWeight);
      st.numberOfCones = toNumber(actualST.coneCount);

      // Recalculate total inventory
      const total = inventory.totalInventory;
      total.totalWeight = toNumber(lt.totalWeight) + toNumber(st.totalWeight);
      total.totalTearWeight = toNumber(lt.totalTearWeight) + toNumber(st.totalTearWeight);
      total.totalNetWeight = toNumber(lt.totalNetWeight) + toNumber(st.totalNetWeight);
      total.numberOfCones = toNumber(lt.numberOfCones) + toNumber(st.numberOfCones);

      // Update status
      const totalNet = toNumber(total.totalNetWeight);
      const minQty = toNumber(yarnCatalog?.minQuantity);
      if (minQty > 0) {
        if (totalNet <= minQty) {
          inventory.inventoryStatus = 'low_stock';
        } else if (totalNet <= minQty * 1.2) {
          inventory.inventoryStatus = 'soon_to_be_low';
        } else {
          inventory.inventoryStatus = 'in_stock';
        }
      }

      await inventory.save();

      const action = isNew ? 'Created' : 'Updated';
      console.log(`✅ ${action} ${yarnName}:`);
      console.log(`   LT: ${actualLT.totalNetWeight.toFixed(2)} kg (${actualLT.boxCount} boxes)`);
      console.log(`   ST: ${actualST.totalNetWeight.toFixed(2)} kg (${actualST.coneCount} cones)`);

    } catch (error) {
      stats.errors++;
      console.error(`❌ Error processing ${yarnName}:`, error.message);
    }
  }

  // ===================================================================
  // STEP 4: Ensure issued cones are not in inventory
  // ===================================================================
  console.log('\n🔍 STEP 4: Verifying issued cones are excluded...\n');

  const issuedCones = await YarnCone.find({
    coneStorageId: { $regex: /^ST-/i },
    issueStatus: 'issued',
  }).lean();

  console.log(`   Found ${issuedCones.length} issued cones in ST storage`);

  // Group issued cones by yarn
  const issuedByYarn = {};
  for (const cone of issuedCones) {
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

  // Verify issued cones are not counted in inventory
  for (const [yarnName, issuedData] of Object.entries(issuedByYarn)) {
    const yarnCatalog = await findYarnCatalogByYarnName(yarnName);
    if (!yarnCatalog) continue;

    const inventory = await YarnInventory.findOne({ yarn: yarnCatalog._id });
    if (!inventory) continue;

    const st = inventory.shortTermInventory || {};
    const stNetWeight = toNumber(st.totalNetWeight);
    const issuedNetWeight = issuedData.totalNetWeight;

    // Check if issued weight is incorrectly included
    // We should recalculate ST inventory to ensure issued cones are excluded
    const availableCones = await YarnCone.find({
      coneStorageId: { $regex: /^ST-/i },
      issueStatus: { $ne: 'issued' },
      yarnName: yarnName,
    }).lean();

    let correctSTWeight = 0;
    let correctSTCones = 0;
    for (const cone of availableCones) {
      const netWeight = (cone.coneWeight || 0) - (cone.tearWeight || 0);
      correctSTWeight += netWeight;
      correctSTCones += 1;
    }

    // Update if there's a discrepancy
    if (Math.abs(stNetWeight - correctSTWeight) > 0.01 || st.numberOfCones !== correctSTCones) {
      st.totalWeight = availableCones.reduce((sum, c) => sum + (c.coneWeight || 0), 0);
      st.totalTearWeight = availableCones.reduce((sum, c) => sum + (c.tearWeight || 0), 0);
      st.totalNetWeight = correctSTWeight;
      st.numberOfCones = correctSTCones;

      // Recalculate total
      const lt = inventory.longTermInventory || {};
      const total = inventory.totalInventory || {};
      total.totalWeight = toNumber(lt.totalWeight) + toNumber(st.totalWeight);
      total.totalTearWeight = toNumber(lt.totalTearWeight) + toNumber(st.totalTearWeight);
      total.totalNetWeight = toNumber(lt.totalNetWeight) + toNumber(st.totalNetWeight);
      total.numberOfCones = toNumber(lt.numberOfCones) + toNumber(st.numberOfCones);

      await inventory.save();
      console.log(`✅ Fixed ${yarnName}: Removed ${issuedData.coneCount} issued cones from inventory`);
      console.log(`   ST now: ${correctSTWeight.toFixed(2)} kg (${correctSTCones} cones)`);
    }
  }

  // ===================================================================
  // STEP 5: Summary
  // ===================================================================
  console.log('\n' + '='.repeat(100));
  console.log('📊 FIX SUMMARY');
  console.log('='.repeat(100));
  console.log(`Total boxes in LT storage: ${ltBoxes.length}`);
  console.log(`Total available cones in ST storage: ${stConesAvailable.length}`);
  console.log(`Total issued cones: ${issuedCones.length}`);
  console.log(`Yarn types processed: ${stats.processed}`);
  console.log(`✅ Updated: ${stats.updated}`);
  console.log(`➕ Created: ${stats.created}`);
  console.log(`❌ Errors: ${stats.errors}`);
  console.log();
};

const main = async () => {
  try {
    await connectDB();
    await fixInventorySync();
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
