import mongoose from 'mongoose';
import config from './src/config/config.js';
import { YarnBox, YarnCatalog, YarnInventory } from './src/models/index.js';
import * as yarnInventoryService from './src/services/yarnManagement/yarnInventory.service.js';

/**
 * Check what the inventory API returns vs what's actually in storage
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

const checkInventoryAPI = async () => {
  console.log('='.repeat(80));
  console.log('🔍 CHECKING INVENTORY API RESPONSE');
  console.log('='.repeat(80));
  console.log();

  // Get all inventory records
  const allInventories = await YarnInventory.find({}).lean();
  console.log(`📦 Total inventory records: ${allInventories.length}\n`);

  // Get all boxes in long-term storage
  const longTermBoxes = await YarnBox.find({
    storedStatus: true,
    storageLocation: { $regex: /^LT-/i },
    boxWeight: { $gt: 0 },
    'qcData.status': 'qc_approved',
  }).lean();

  console.log(`📦 Total boxes in LT storage: ${longTermBoxes.length}\n`);

  // Simulate API call
  const apiResult = await yarnInventoryService.queryYarnInventories({}, { limit: 1000, page: 1 });

  console.log('='.repeat(80));
  console.log('📊 INVENTORY API RESPONSE');
  console.log('='.repeat(80));
  console.log(`Total results from API: ${apiResult.results.length}`);
  console.log(`Total pages: ${apiResult.totalPages}`);
  console.log(`Total results: ${apiResult.totalResults}`);
  console.log();

  if (apiResult.results.length > 0) {
    console.log('📋 Yarns in Inventory API:');
    apiResult.results.forEach((inv, idx) => {
      console.log(`\n${idx + 1}. ${inv.yarnName || 'N/A'}`);
      console.log(`   Yarn ID: ${inv.yarnId}`);
      console.log(`   Long-Term Storage:`);
      console.log(`     - Total Weight: ${inv.longTermStorage?.totalWeight || 0}kg`);
      console.log(`     - Net Weight: ${inv.longTermStorage?.netWeight || 0}kg`);
      console.log(`     - Cones: ${inv.longTermStorage?.numberOfCones || 0}`);
      console.log(`   Short-Term Storage:`);
      console.log(`     - Total Weight: ${inv.shortTermStorage?.totalWeight || 0}kg`);
      console.log(`     - Net Weight: ${inv.shortTermStorage?.netWeight || 0}kg`);
      console.log(`     - Cones: ${inv.shortTermStorage?.numberOfCones || 0}`);
      console.log(`   Status: ${inv.inventoryStatus || 'N/A'}`);
      console.log(`   Overbooked: ${inv.overbooked ? 'Yes' : 'No'}`);
    });
  } else {
    console.log('⚠️  No inventory records found in API response!');
  }

  console.log('\n' + '='.repeat(80));
  console.log('📦 BOXES IN STORAGE (Grouped by Yarn)');
  console.log('='.repeat(80));

  // Group boxes by yarnName
  const boxesByYarn = {};
  for (const box of longTermBoxes) {
    if (!boxesByYarn[box.yarnName]) {
      boxesByYarn[box.yarnName] = [];
    }
    boxesByYarn[box.yarnName].push(box);
  }

  for (const [yarnName, boxes] of Object.entries(boxesByYarn)) {
    const totalWeight = boxes.reduce((sum, b) => sum + (b.boxWeight || 0), 0);
    const totalNetWeight = boxes.reduce((sum, b) => {
      const net = (b.boxWeight || 0) - (b.tearweight || 0);
      return sum + net;
    }, 0);
    const totalCones = boxes.reduce((sum, b) => sum + (b.numberOfCones || 0), 0);

    console.log(`\n${yarnName}:`);
    console.log(`  Boxes: ${boxes.length}`);
    console.log(`  Total Weight: ${totalWeight.toFixed(2)}kg`);
    console.log(`  Net Weight: ${totalNetWeight.toFixed(2)}kg`);
    console.log(`  Cones: ${totalCones}`);

    // Find matching inventory
    const matchingInv = apiResult.results.find(inv => inv.yarnName === yarnName);
    if (matchingInv) {
      const apiWeight = matchingInv.longTermStorage?.totalWeight || 0;
      const apiNetWeight = matchingInv.longTermStorage?.netWeight || 0;
      const apiCones = matchingInv.longTermStorage?.numberOfCones || 0;

      if (Math.abs(totalWeight - apiWeight) < 0.01 && 
          Math.abs(totalNetWeight - apiNetWeight) < 0.01 &&
          Math.abs(totalCones - apiCones) < 0.1) {
        console.log(`  ✅ Matches inventory API`);
      } else {
        console.log(`  ⚠️  MISMATCH with inventory API:`);
        console.log(`     Storage: ${totalWeight.toFixed(2)}kg / ${totalNetWeight.toFixed(2)}kg net / ${totalCones} cones`);
        console.log(`     API: ${apiWeight.toFixed(2)}kg / ${apiNetWeight.toFixed(2)}kg net / ${apiCones} cones`);
      }
    } else {
      console.log(`  ❌ NOT FOUND in inventory API`);
    }
  }

  // Check for yarns in inventory but not in storage
  console.log('\n' + '='.repeat(80));
  console.log('🔍 YARNS IN INVENTORY BUT NOT IN STORAGE');
  console.log('='.repeat(80));

  const yarnNamesInStorage = new Set(longTermBoxes.map(b => b.yarnName));
  const orphanedInventories = apiResult.results.filter(inv => {
    return !yarnNamesInStorage.has(inv.yarnName) && 
           (inv.longTermStorage?.totalWeight > 0 || inv.shortTermStorage?.totalWeight > 0);
  });

  if (orphanedInventories.length > 0) {
    console.log(`Found ${orphanedInventories.length} yarns in inventory but not in storage:`);
    orphanedInventories.forEach(inv => {
      console.log(`  - ${inv.yarnName}`);
      console.log(`    LTS: ${inv.longTermStorage?.totalWeight || 0}kg`);
      console.log(`    STS: ${inv.shortTermStorage?.totalWeight || 0}kg`);
    });
  } else {
    console.log('✅ No orphaned inventories found');
  }

  console.log();
};

const main = async () => {
  try {
    await connectDB();
    await checkInventoryAPI();
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
