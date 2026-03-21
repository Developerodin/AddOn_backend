/**
 * Refreshes denormalized yarnName (and nested PO/BOM names) from YarnCatalog for every
 * document that already has yarnCatalogId. Use after catalog renames.
 *
 * Uses native collection drivers + YarnCatalog .lean() to avoid heavy post-find hooks.
 */

import mongoose from 'mongoose';
import YarnCatalog from '../../models/yarnManagement/yarnCatalog.model.js';

/**
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<{ totalUpdates: number, byCollection: Record<string, number> }>}
 */
export async function syncAllDenormalizedYarnLabelsFromCatalog(opts = {}) {
  const { dryRun = false } = opts;
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB not connected; call after mongoose.connect');
  }

  const catalogs = await YarnCatalog.find({}).select('_id yarnName').lean();
  const idToName = new Map(catalogs.map((c) => [c._id.toString(), c.yarnName || '']));

  const byCollection = {
    yarninventories: 0,
    yarntransactions: 0,
    yarncones: 0,
    yarnboxes: 0,
    yarnrequisitions: 0,
    yarnpurchaseorders: 0,
    products: 0,
  };

  const bump = (coll) => {
    byCollection[coll] = (byCollection[coll] || 0) + 1;
  };

  // yarninventories
  const inv = db.collection('yarninventories');
  for await (const doc of inv.find({ yarnCatalogId: { $exists: true, $ne: null } })) {
    const name = idToName.get(doc.yarnCatalogId.toString());
    if (name && doc.yarnName !== name) {
      bump('yarninventories');
      if (!dryRun) await inv.updateOne({ _id: doc._id }, { $set: { yarnName: name } });
    }
  }

  const tx = db.collection('yarntransactions');
  for await (const doc of tx.find({ yarnCatalogId: { $exists: true, $ne: null } })) {
    const name = idToName.get(doc.yarnCatalogId.toString());
    if (name && doc.yarnName !== name) {
      bump('yarntransactions');
      if (!dryRun) await tx.updateOne({ _id: doc._id }, { $set: { yarnName: name } });
    }
  }

  const cones = db.collection('yarncones');
  for await (const doc of cones.find({ yarnCatalogId: { $exists: true, $ne: null } })) {
    const name = idToName.get(doc.yarnCatalogId.toString());
    if (name && doc.yarnName !== name) {
      bump('yarncones');
      if (!dryRun) await cones.updateOne({ _id: doc._id }, { $set: { yarnName: name } });
    }
  }

  const boxes = db.collection('yarnboxes');
  for await (const doc of boxes.find({ yarnCatalogId: { $exists: true, $ne: null } })) {
    const name = idToName.get(doc.yarnCatalogId.toString());
    if (name && doc.yarnName !== name) {
      bump('yarnboxes');
      if (!dryRun) await boxes.updateOne({ _id: doc._id }, { $set: { yarnName: name } });
    }
  }

  const req = db.collection('yarnrequisitions');
  for await (const doc of req.find({ yarnCatalogId: { $exists: true, $ne: null } })) {
    const name = idToName.get(doc.yarnCatalogId.toString());
    if (name && doc.yarnName !== name) {
      bump('yarnrequisitions');
      if (!dryRun) await req.updateOne({ _id: doc._id }, { $set: { yarnName: name } });
    }
  }

  const pos = db.collection('yarnpurchaseorders');
  for await (const doc of pos.find({ 'poItems.yarnCatalogId': { $exists: true } })) {
    let dirty = false;
    const poItems = (doc.poItems || []).map((p) => {
      if (!p.yarnCatalogId) return p;
      const name = idToName.get(p.yarnCatalogId.toString());
      if (name && p.yarnName !== name) {
        dirty = true;
        return { ...p, yarnName: name };
      }
      return p;
    });
    if (dirty) {
      bump('yarnpurchaseorders');
      if (!dryRun) await pos.updateOne({ _id: doc._id }, { $set: { poItems } });
    }
  }

  const products = db.collection('products');
  for await (const doc of products.find({ 'bom.yarnCatalogId': { $exists: true } })) {
    let dirty = false;
    const bom = (doc.bom || []).map((b) => {
      if (!b.yarnCatalogId) return b;
      const name = idToName.get(b.yarnCatalogId.toString());
      if (name && b.yarnName !== name) {
        dirty = true;
        return { ...b, yarnName: name };
      }
      return b;
    });
    if (dirty) {
      bump('products');
      if (!dryRun) await products.updateOne({ _id: doc._id }, { $set: { bom } });
    }
  }

  const totalUpdates = Object.values(byCollection).reduce((a, b) => a + b, 0);
  return { totalUpdates, byCollection };
}
