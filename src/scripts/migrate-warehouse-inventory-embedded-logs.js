/**
 * One-time migration: embedded `stocks.logs[]` → collection `warehouse_inventory_logs`.
 * Run after deploying the WarehouseInventoryLog model.
 *
 *   node src/scripts/migrate-warehouse-inventory-embedded-logs.js
 *
 * Requires the same .env as the app (MONGODB_URL, NODE_ENV, …).
 */
import mongoose from 'mongoose';
import config from '../config/config.js';
import WarehouseInventoryLog from '../models/whms/warehouseInventoryLog.model.js';

async function main() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  const coll = mongoose.connection.collection('stocks');
  const filter = { 'logs.0': { $exists: true } };
  const total = await coll.countDocuments(filter);
  // eslint-disable-next-line no-console
  console.log(`Inventory docs with embedded logs: ${total}`);

  let done = 0;
  const cursor = coll.find(filter);
  // eslint-disable-next-line no-await-in-loop
  while (await cursor.hasNext()) {
    const inv = await cursor.next();
    const logs = Array.isArray(inv.logs) ? inv.logs : [];
    const now = new Date();
    // eslint-disable-next-line no-await-in-loop
    for (const log of logs) {
      // eslint-disable-next-line no-await-in-loop
      await WarehouseInventoryLog.collection.insertOne({
        warehouseInventoryId: inv._id,
        styleCodeId: inv.styleCodeId ?? null,
        styleCode: inv.styleCode || '',
        action: String(log.action ?? ''),
        message: String(log.message ?? ''),
        quantityDelta: log.quantityDelta,
        blockedDelta: log.blockedDelta,
        totalQuantityAfter: log.totalQuantityAfter,
        blockedQuantityAfter: log.blockedQuantityAfter,
        availableQuantityAfter: log.availableQuantityAfter,
        userId: log.userId ?? null,
        meta: log.meta ?? null,
        createdAt: log.createdAt || now,
      });
    }
    // eslint-disable-next-line no-await-in-loop
    await coll.updateOne({ _id: inv._id }, { $unset: { logs: '' } });
    done += 1;
    if (done % 50 === 0) {
      // eslint-disable-next-line no-console
      console.log(`… ${done}/${total}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Done. Migrated ${done} inventory documents.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
