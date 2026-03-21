/**
 * Sets YarnBox.yarnCatalogId from the linked YarnPurchaseOrder poItems when the box
 * is missing yarnCatalogId but has poNumber + yarnName (optional shadeCode disambiguation).
 * Fixes rows where catalog name-matching failed (typos, duplicates, renames).
 */

import mongoose from 'mongoose';

/**
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<{ boxesUpdated: number, boxesScanned: number }>}
 */
export async function backfillYarnBoxCatalogIdsFromPurchaseOrders(opts = {}) {
  const { dryRun = false } = opts;
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB not connected');
  }

  const boxes = db.collection('yarnboxes');
  const pos = db.collection('yarnpurchaseorders');
  let boxesUpdated = 0;
  let boxesScanned = 0;

  const cursor = boxes.find({
    $or: [{ yarnCatalogId: { $exists: false } }, { yarnCatalogId: null }],
    poNumber: { $exists: true, $nin: [null, ''] },
    yarnName: { $exists: true, $nin: [null, ''] },
  });

  for await (const box of cursor) {
    boxesScanned += 1;
    const po = await pos.findOne({ poNumber: box.poNumber });
    if (!po?.poItems?.length) continue;

    const yname = String(box.yarnName || '').trim();
    const shade = String(box.shadeCode || '').trim();

    const sameName = po.poItems.filter((p) => String(p.yarnName || '').trim() === yname);
    if (sameName.length === 0) continue;

    let item = null;
    if (sameName.length === 1) {
      item = sameName[0];
    } else if (shade) {
      item = sameName.find((p) => String(p.shadeCode || '').trim() === shade) || null;
    }
    if (!item) continue;

    const rawId = item.yarnCatalogId;
    if (!rawId) continue;
    const cid = mongoose.Types.ObjectId.isValid(rawId) ? new mongoose.Types.ObjectId(rawId) : rawId;

    boxesUpdated += 1;
    if (!dryRun) {
      await boxes.updateOne({ _id: box._id }, { $set: { yarnCatalogId: cid } });
    }
  }

  return { boxesUpdated, boxesScanned };
}
