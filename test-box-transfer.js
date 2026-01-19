import mongoose from 'mongoose';
import config from './src/config/config.js';
import { YarnBox, YarnTransaction, YarnInventory } from './src/models/index.js';
import * as yarnBoxTransferService from './src/services/yarnManagement/yarnBoxTransfer.service.js';

/**
 * Test script to verify box transfer functionality (LT→ST and LT→LT)
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

const testTransfer = async () => {
  console.log('='.repeat(80));
  console.log('🧪 TESTING BOX TRANSFER FUNCTIONALITY');
  console.log('='.repeat(80));
  console.log();

  // Find boxes in long-term storage
  const ltBoxes = await YarnBox.find({
    storageLocation: { $regex: /^LT-/i },
    storedStatus: true,
    'qcData.status': 'qc_approved',
  }).limit(2).lean();

  if (ltBoxes.length < 2) {
    console.log('⚠️  Need at least 2 boxes in long-term storage for testing');
    await mongoose.connection.close();
    return;
  }

  const box1 = ltBoxes[0];
  const box2 = ltBoxes[1];

  console.log(`📦 Found test boxes:`);
  console.log(`   Box 1: ${box1.boxId} at ${box1.storageLocation} (${box1.boxWeight} kg)`);
  console.log(`   Box 2: ${box2.boxId} at ${box2.storageLocation} (${box2.boxWeight} kg)`);
  console.log();

  // Test 1: LT→LT transfer
  console.log('🔄 TEST 1: LT→LT Transfer (Location change only, no inventory update)');
  console.log('-'.repeat(80));
  try {
    const ltInventoryBefore = await YarnInventory.findOne({ yarn: box1.yarn }).lean();
    const ltWeightBefore = ltInventoryBefore?.longTermInventory?.totalNetWeight || 0;

    const result1 = await yarnBoxTransferService.transferBoxes({
      boxIds: [box1.boxId],
      toStorageLocation: 'LT-S002-F1', // Different LT location
      transferDate: new Date(),
    });

    console.log('✅ LT→LT Transfer successful!');
    console.log(`   Transfer type: ${result1.transferType}`);
    console.log(`   Message: ${result1.message}`);
    console.log();

    // Verify box location updated
    const updatedBox1 = await YarnBox.findOne({ boxId: box1.boxId }).lean();
    console.log(`📦 Box location updated: ${box1.storageLocation} → ${updatedBox1.storageLocation}`);

    // Verify inventory NOT changed (LT→LT doesn't affect inventory)
    const ltInventoryAfter = await YarnInventory.findOne({ yarn: box1.yarn }).lean();
    const ltWeightAfter = ltInventoryAfter?.longTermInventory?.totalNetWeight || 0;
    console.log(`📊 Inventory check: ${ltWeightBefore} kg → ${ltWeightAfter} kg (should be same)`);
    if (Math.abs(ltWeightBefore - ltWeightAfter) < 0.01) {
      console.log('   ✅ Inventory unchanged (correct for LT→LT)');
    } else {
      console.log('   ⚠️  Inventory changed (unexpected for LT→LT)');
    }

    // Check transaction created
    const transaction1 = await YarnTransaction.findOne({
      boxIds: box1.boxId,
      transactionType: 'internal_transfer',
    }).sort({ createdAt: -1 }).lean();

    if (transaction1) {
      console.log('✅ Transaction logged:');
      console.log(`   Box IDs: ${transaction1.boxIds?.join(', ')}`);
      console.log(`   From: ${transaction1.fromStorageLocation}`);
      console.log(`   To: ${transaction1.toStorageLocation}`);
    }
    console.log();

  } catch (error) {
    console.error('❌ LT→LT Transfer failed:', error.message);
    console.log();
  }

  // Test 2: LT→ST transfer
  console.log('🔄 TEST 2: LT→ST Transfer (Updates inventory)');
  console.log('-'.repeat(80));
  try {
    // Find box in LT (use box2, or find another one)
    const ltBoxForST = await YarnBox.findOne({
      storageLocation: { $regex: /^LT-/i },
      storedStatus: true,
      'qcData.status': 'qc_approved',
      boxId: { $ne: box1.boxId }, // Different from box1
    }).lean();

    if (!ltBoxForST) {
      console.log('⚠️  No additional box found for LT→ST test');
    } else {
      const stInventoryBefore = await YarnInventory.findOne({ yarn: ltBoxForST.yarn }).lean();
      const stWeightBefore = stInventoryBefore?.shortTermInventory?.totalNetWeight || 0;
      const ltWeightBeforeST = stInventoryBefore?.longTermInventory?.totalNetWeight || 0;

      const result2 = await yarnBoxTransferService.transferBoxes({
        boxIds: [ltBoxForST.boxId],
        toStorageLocation: 'ST-S001-F1',
        transferDate: new Date(),
      });

      console.log('✅ LT→ST Transfer successful!');
      console.log(`   Transfer type: ${result2.transferType}`);
      console.log(`   Message: ${result2.message}`);
      console.log();

      // Verify box location updated
      const updatedBoxST = await YarnBox.findOne({ boxId: ltBoxForST.boxId }).lean();
      console.log(`📦 Box location updated: ${ltBoxForST.storageLocation} → ${updatedBoxST.storageLocation}`);

      // Verify inventory changed (LT→ST should update inventory)
      const stInventoryAfter = await YarnInventory.findOne({ yarn: ltBoxForST.yarn }).lean();
      const stWeightAfter = stInventoryAfter?.shortTermInventory?.totalNetWeight || 0;
      const ltWeightAfterST = stInventoryAfter?.longTermInventory?.totalNetWeight || 0;
      const netWeight = (ltBoxForST.boxWeight || 0) - (ltBoxForST.tearweight || 0);
      
      console.log(`📊 Inventory check:`);
      console.log(`   LT: ${ltWeightBeforeST} kg → ${ltWeightAfterST} kg (should decrease by ~${netWeight} kg)`);
      console.log(`   ST: ${stWeightBefore} kg → ${stWeightAfter} kg (should increase by ~${netWeight} kg)`);
      
      if (Math.abs((ltWeightBeforeST - ltWeightAfterST) - netWeight) < 0.1 &&
          Math.abs((stWeightAfter - stWeightBefore) - netWeight) < 0.1) {
        console.log('   ✅ Inventory updated correctly');
      } else {
        console.log('   ⚠️  Inventory update mismatch');
      }
    }
    console.log();

  } catch (error) {
    console.error('❌ LT→ST Transfer failed:', error.message);
    console.log();
  }

  // Test 3: History
  console.log('📜 TEST 3: Storage Location History');
  console.log('-'.repeat(80));
  try {
    const history = await yarnBoxTransferService.getStorageLocationHistory(box1.storageLocation);
    console.log(`   Location: ${history.storageLocation}`);
    console.log(`   Remaining boxes: ${history.currentInventory.totalBoxes}`);
    console.log(`   Remaining weight: ${history.currentInventory.totalWeight} kg`);
    console.log(`   Transfer history entries: ${history.transferHistory.length}`);
    if (history.transferHistory.length > 0) {
      console.log('   Recent transfers:');
      history.transferHistory.slice(0, 3).forEach((tx, idx) => {
        console.log(`     ${idx + 1}. ${tx.transactionDate}: ${tx.yarnName} - ${tx.weight} kg`);
        console.log(`        From: ${tx.fromLocation} → To: ${tx.toLocation}`);
        console.log(`        Boxes: ${tx.boxIds?.join(', ') || 'N/A'}`);
      });
    }
  } catch (error) {
    console.error('❌ History check failed:', error.message);
  }
};

const main = async () => {
  try {
    await connectDB();
    await testTransfer();
    await mongoose.connection.close();
    console.log('\n✅ Test completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

main();
