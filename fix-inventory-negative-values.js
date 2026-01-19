import mongoose from 'mongoose';
import config from './src/config/config.js';
import { YarnInventory } from './src/models/index.js';

/**
 * Fix negative values in inventory and ensure long-term storage has 0 cones
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

const toNumber = (value) => Math.max(0, Number(value ?? 0)); // Ensure non-negative

const fixInventory = async () => {
  console.log('='.repeat(80));
  console.log('🔧 FIXING INVENTORY NEGATIVE VALUES & CONES');
  console.log('='.repeat(80));
  console.log();

  const allInventories = await YarnInventory.find({});
  console.log(`Found ${allInventories.length} inventory records\n`);

  let fixedCount = 0;
  const fixes = [];

  for (const inv of allInventories) {
    let needsFix = false;
    const yarnName = inv.yarnName || 'N/A';

    // Fix long-term inventory
    const lt = inv.longTermInventory || {};
    const ltTotalWeight = toNumber(lt.totalWeight);
    const ltTearWeight = toNumber(lt.totalTearWeight);
    const ltNetWeight = toNumber(lt.totalNetWeight);
    const ltCones = 0; // Always 0 for long-term (boxes only)

    if (lt.totalWeight !== ltTotalWeight || lt.totalNetWeight !== ltNetWeight || 
        lt.totalTearWeight !== ltTearWeight || lt.numberOfCones !== ltCones) {
      needsFix = true;
      fixes.push(`${yarnName}: Fixed LT - Weight: ${lt.totalWeight}→${ltTotalWeight}, Net: ${lt.totalNetWeight}→${ltNetWeight}, Cones: ${lt.numberOfCones}→0`);
    }

    inv.longTermInventory = {
      totalWeight: ltTotalWeight,
      totalTearWeight: ltTearWeight,
      totalNetWeight: ltNetWeight,
      numberOfCones: ltCones,
    };

    // Fix short-term inventory
    const st = inv.shortTermInventory || {};
    const stTotalWeight = toNumber(st.totalWeight);
    const stTearWeight = toNumber(st.totalTearWeight);
    const stNetWeight = toNumber(st.totalNetWeight);
    const stCones = toNumber(st.numberOfCones);

    if (st.totalWeight !== stTotalWeight || st.totalNetWeight !== stNetWeight ||
        st.totalTearWeight !== stTearWeight || st.numberOfCones !== stCones) {
      needsFix = true;
      fixes.push(`${yarnName}: Fixed ST - Weight: ${st.totalWeight}→${stTotalWeight}, Net: ${st.totalNetWeight}→${stNetWeight}, Cones: ${st.numberOfCones}→${stCones}`);
    }

    inv.shortTermInventory = {
      totalWeight: stTotalWeight,
      totalTearWeight: stTearWeight,
      totalNetWeight: stNetWeight,
      numberOfCones: stCones,
    };

    // Fix total inventory
    const total = inv.totalInventory || {};
    const totalWeight = ltTotalWeight + stTotalWeight;
    const totalTearWeight = ltTearWeight + stTearWeight;
    const totalNetWeight = ltNetWeight + stNetWeight;
    const totalCones = stCones; // Only short-term has cones

    if (total.totalWeight !== totalWeight || total.totalNetWeight !== totalNetWeight ||
        total.totalTearWeight !== totalTearWeight || total.numberOfCones !== totalCones) {
      needsFix = true;
    }

    inv.totalInventory = {
      totalWeight,
      totalTearWeight,
      totalNetWeight,
      numberOfCones: totalCones,
    };

    // Fix blocked weight (ensure non-negative)
    const blocked = toNumber(inv.blockedNetWeight);
    if (inv.blockedNetWeight !== blocked) {
      needsFix = true;
      fixes.push(`${yarnName}: Fixed blocked weight: ${inv.blockedNetWeight}→${blocked}`);
    }
    inv.blockedNetWeight = blocked;

    if (needsFix) {
      await inv.save();
      fixedCount++;
      console.log(`✅ Fixed: ${yarnName}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 FIX SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total inventories: ${allInventories.length}`);
  console.log(`✅ Fixed: ${fixedCount}`);
  console.log(`⏭️  No issues: ${allInventories.length - fixedCount}`);

  if (fixes.length > 0) {
    console.log('\n🔧 Fixes applied:');
    fixes.forEach(fix => console.log(`   ${fix}`));
  }

  console.log();
};

const main = async () => {
  try {
    await connectDB();
    await fixInventory();
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
