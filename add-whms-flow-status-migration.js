/**
 * Migration Script: Backfill `flowStatus` on warehouse orders from the coarse `status`.
 *
 * Mapping (see flowStatusForCoarseStatus in warehouseOrder.model.js):
 *   draft/pending → order-created, in-progress → picking, packed → packing-done,
 *   dispatched → dispatched, cancelled → cancelled
 *
 * Idempotent: only touches documents where flowStatus is missing.
 */

import mongoose from 'mongoose';
import config from './src/config/config.js';
import WarehouseOrder, { flowStatusForCoarseStatus } from './src/models/whms/warehouseOrder.model.js';
import { connectMongooseForScript } from './scripts/lib/mongoScriptConnect.js';

const run = async () => {
  const redactedUri = await connectMongooseForScript(config);
  console.log(`✅ Connected to MongoDB (${redactedUri})`);

  const missing = await WarehouseOrder.find({ flowStatus: { $in: [null, undefined] } }).select('status');
  console.log(`📊 Found ${missing.length} warehouse orders without flowStatus`);

  let updated = 0;
  const byStatus = {};
  for (const order of missing) {
    const flowStatus = flowStatusForCoarseStatus(order.status);
    await WarehouseOrder.updateOne({ _id: order._id }, { $set: { flowStatus } });
    byStatus[`${order.status || '(none)'} → ${flowStatus}`] = (byStatus[`${order.status || '(none)'} → ${flowStatus}`] || 0) + 1;
    updated += 1;
  }

  console.log('\nBackfill summary:');
  for (const [mapping, count] of Object.entries(byStatus)) {
    console.log(`  ${mapping}: ${count}`);
  }
  console.log(`\n✅ Done. Updated ${updated} orders.`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
