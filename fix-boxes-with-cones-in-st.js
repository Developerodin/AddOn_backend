import mongoose from 'mongoose';
import config from './src/config/config.js';
import { YarnBox, YarnCone } from './src/models/index.js';

/**
 * Fix boxes that have cones in ST storage but are still showing in LT storage
 * This script removes boxes from LT when their cones are in ST
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

const fixBoxes = async () => {
  console.log('='.repeat(100));
  console.log('🔧 FIXING BOXES WITH CONES IN ST STORAGE');
  console.log('='.repeat(100));
  console.log();

  // Find all boxes in LT storage
  const boxesInLT = await YarnBox.find({
    storageLocation: { $regex: /^LT-/i },
    storedStatus: true,
  }).lean();

  console.log(`📦 Found ${boxesInLT.length} boxes in long-term storage\n`);

  const stats = {
    processed: 0,
    removed: 0,
    kept: 0,
    errors: 0,
  };

  for (const box of boxesInLT) {
    try {
      stats.processed++;

      // Check if cones exist in ST for this box
      const conesInST = await YarnCone.countDocuments({
        boxId: box.boxId,
        coneStorageId: { $regex: /^ST-/i },
      });

      if (conesInST > 0) {
        // Box has cones in ST - remove from LT storage
        await YarnBox.findByIdAndUpdate(box._id, {
          storageLocation: null,
          storedStatus: false,
          $set: {
            'coneData.conesIssued': true,
            'coneData.numberOfCones': conesInST,
            'coneData.coneIssueDate': new Date(),
          },
        });

        stats.removed++;
        console.log(`✅ Removed box ${box.boxId} from LT storage (${conesInST} cones in ST)`);
      } else {
        stats.kept++;
        // Box has no cones in ST - keep in LT (box still has yarn)
      }
    } catch (error) {
      stats.errors++;
      console.error(`❌ Error processing box ${box.boxId}:`, error.message);
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('📊 SUMMARY');
  console.log('='.repeat(100));
  console.log(`Total boxes processed: ${stats.processed}`);
  console.log(`✅ Removed from LT: ${stats.removed}`);
  console.log(`📦 Kept in LT: ${stats.kept}`);
  console.log(`❌ Errors: ${stats.errors}`);
  console.log();
};

const main = async () => {
  try {
    await connectDB();
    await fixBoxes();
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
