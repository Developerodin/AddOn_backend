import mongoose from 'mongoose';
import config from './src/config/config.js';
import { YarnCone, YarnInventory, YarnCatalog } from './src/models/index.js';

/**
 * Sync short-term storage cones to yarn inventory
 * This script calculates inventory from actual cones in short-term storage
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

const toNumber = (value) => Math.max(0, Number(value ?? 0));

const syncShortTermStorage = async () => {
  console.log('='.repeat(80));
  console.log('🔄 SYNCING SHORT-TERM STORAGE TO INVENTORY');
  console.log('='.repeat(80));
  console.log();

  // Find all cones in short-term storage (not issued)
  // Only count cones that are available (not issued)
  const shortTermCones = await YarnCone.find({
    coneStorageId: { $regex: /^ST-/i },
    issueStatus: { $ne: 'issued' }, // Only count available cones
  }).lean();

  console.log(`📦 Found ${shortTermCones.length} cones in short-term storage\n`);

  if (shortTermCones.length === 0) {
    console.log('⚠️  No cones found in short-term storage');
    await mongoose.connection.close();
    return;
  }

  // Group cones by yarn
  const conesByYarn = {};
  const missingYarns = [];

  for (const cone of shortTermCones) {
    const yarnName = cone.yarnName;
    if (!yarnName) {
      console.warn(`⚠️  Cone ${cone.barcode} has no yarnName, skipping`);
      continue;
    }

    if (!conesByYarn[yarnName]) {
      conesByYarn[yarnName] = {
        yarnName,
        cones: [],
        totalWeight: 0,
        totalNetWeight: 0,
        totalTearWeight: 0,
        coneCount: 0,
      };
    }

    const netWeight = (cone.coneWeight || 0) - (cone.tearWeight || 0);
    conesByYarn[yarnName].cones.push(cone);
    conesByYarn[yarnName].totalWeight += cone.coneWeight || 0;
    conesByYarn[yarnName].totalNetWeight += netWeight;
    conesByYarn[yarnName].totalTearWeight += cone.tearWeight || 0;
    conesByYarn[yarnName].coneCount += 1;
  }

  console.log(`📊 Grouped into ${Object.keys(conesByYarn).length} yarn types\n`);

  const stats = {
    processed: 0,
    updated: 0,
    created: 0,
    skipped: 0,
    errors: 0,
  };

  // Process each yarn
  for (const [yarnName, yarnData] of Object.entries(conesByYarn)) {
    try {
      stats.processed++;

      // Find yarn catalog
      const yarnCatalog = await findYarnCatalogByYarnName(yarnName);
      if (!yarnCatalog) {
        missingYarns.push(yarnName);
        stats.skipped++;
        console.log(`⚠️  Skipped ${yarnName}: Yarn catalog not found`);
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
        stats.created++;
      } else {
        stats.updated++;
      }

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

      // Update short-term inventory from actual cones
      const st = inventory.shortTermInventory;
      st.totalWeight = toNumber(yarnData.totalWeight);
      st.totalTearWeight = toNumber(yarnData.totalTearWeight);
      st.totalNetWeight = toNumber(yarnData.totalNetWeight);
      st.numberOfCones = toNumber(yarnData.coneCount);

      // Recalculate total inventory
      const lt = inventory.longTermInventory;
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

      console.log(`✅ ${yarnName}:`);
      console.log(`   Cones: ${yarnData.coneCount}`);
      console.log(`   Weight: ${yarnData.totalWeight} kg (net: ${yarnData.totalNetWeight} kg)`);
      console.log(`   Short-term inventory updated`);

    } catch (error) {
      stats.errors++;
      console.error(`❌ Error processing ${yarnName}:`, error.message);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 SYNC SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total cones in ST storage: ${shortTermCones.length}`);
  console.log(`Yarn types processed: ${stats.processed}`);
  console.log(`✅ Updated: ${stats.updated}`);
  console.log(`➕ Created: ${stats.created}`);
  console.log(`⏭️  Skipped: ${stats.skipped}`);
  console.log(`❌ Errors: ${stats.errors}`);

  if (missingYarns.length > 0) {
    console.log(`\n⚠️  Missing yarn catalogs (${missingYarns.length}):`);
    missingYarns.forEach(yarn => console.log(`   - ${yarn}`));
  }

  console.log();
};

const main = async () => {
  try {
    await connectDB();
    await syncShortTermStorage();
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
