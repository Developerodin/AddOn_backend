#!/usr/bin/env node

/**
 * Shrink active transfer-note locks down to qty that is still not inwarded.
 * Newest notes give up the extra first, so a repeated print loses its lock
 * before an older note does. Warehouse accept after this releases oldest-first.
 *
 * Voids F000038 when that duplicate note is in the database. A fresh production
 * dump that does not contain it is left unchanged.
 *
 * Usage:
 *   node src/scripts/repair-stn-allocation-locks.js
 *   node src/scripts/repair-stn-allocation-locks.js --write
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import Article from '../models/production/article.model.js';
import DispatchStockTransferNote, {
  DispatchStnStatus,
} from '../models/production/dispatchStockTransferNote.model.js';
import VendorDispatchStockTransferNote, {
  VendorDispatchStnStatus,
} from '../models/vendorManagement/vendorDispatchStockTransferNote.model.js';
import VendorProductionFlow from '../models/vendorManagement/vendorProductionFlow.model.js';
import { brandKey } from '../utils/brandQuantity.util.js';
import { getPendingDispatchTransferredData } from '../utils/dispatchWarehousePending.util.js';
import { filterVendorWarehouseHandoffReceivedData } from '../utils/vendorDispatchWarehousePending.util.js';

const WRITE = process.argv.includes('--write');
const DUPLICATE_SERIALS = ['F000038'];

/**
 * Optional one-off: rewrite printed lines of a known bad serial so history matches
 * the locks that remain. Do not pass this for a normal production dump.
 * @returns {string|undefined}
 */
function syncLinesSerial() {
  const hit = process.argv.find((arg) => arg.startsWith('--sync-lines-serial='));
  return hit ? hit.slice('--sync-lines-serial='.length).trim() : undefined;
}

/**
 * @param {Object} alloc
 * @param {string} idField
 * @returns {Object}
 */
function plainAlloc(alloc, idField) {
  const plain = typeof alloc?.toObject === 'function' ? alloc.toObject() : { ...alloc };
  return {
    [idField]: plain[idField],
    brand: plain.brand || '',
    quantity: Number(plain.quantity) || 0,
  };
}

/**
 * @param {string} id
 * @param {string} brand
 * @returns {string}
 */
function lockKey(id, brand) {
  return `${String(id)}::${brandKey(brand)}`;
}

/**
 * Drop newest locks first until each article/flow + brand sum equals pending.
 * @param {Array<Object>} notesNewestFirst
 * @param {Map<string, number>} pendingByKey
 * @param {string} idField
 * @returns {Array<Object>} notes whose allocations changed
 */
function shrinkNewestFirst(notesNewestFirst, pendingByKey, idField) {
  const sumByKey = new Map();
  for (const note of notesNewestFirst) {
    for (const alloc of note.allocations || []) {
      const key = lockKey(alloc[idField], alloc.brand);
      sumByKey.set(key, (sumByKey.get(key) || 0) + (Number(alloc.quantity) || 0));
    }
  }

  const excess = new Map();
  for (const [key, sum] of sumByKey) {
    const pending = Math.max(0, Number(pendingByKey.get(key) || 0));
    const extra = sum - Math.min(sum, pending);
    if (extra > 1e-6) excess.set(key, extra);
  }

  const changed = [];
  for (const note of notesNewestFirst) {
    let dirty = false;
    const next = [];
    for (const alloc of note.allocations || []) {
      const key = lockKey(alloc[idField], alloc.brand);
      let extra = excess.get(key) || 0;
      const qty = Number(alloc.quantity) || 0;
      if (extra <= 1e-9) {
        next.push(plainAlloc(alloc, idField));
        continue;
      }
      const take = Math.min(qty, extra);
      extra -= take;
      excess.set(key, extra);
      dirty = true;
      const left = qty - take;
      if (left > 1e-9) next.push({ ...plainAlloc(alloc, idField), quantity: left });
    }
    if (!dirty) continue;
    note.allocations = next;
    note.markModified('allocations');
    changed.push(note);
  }
  return changed;
}

/**
 * @param {Array<Object>} notes
 * @param {string} idField
 * @returns {Map<string, number>}
 */
function sumAllocations(notes, idField) {
  const map = new Map();
  for (const note of notes) {
    for (const alloc of note.allocations || []) {
      const key = lockKey(alloc[idField], alloc.brand);
      map.set(key, (map.get(key) || 0) + (Number(alloc.quantity) || 0));
    }
  }
  return map;
}

/**
 * @param {Map<string, number>} pendingByKey
 * @param {Map<string, number>} allocByKey
 * @returns {number}
 */
function sumEligible(pendingByKey, allocByKey) {
  let total = 0;
  const keys = new Set([...pendingByKey.keys(), ...allocByKey.keys()]);
  for (const key of keys) {
    const pending = Math.max(0, Number(pendingByKey.get(key) || 0));
    const alloc = Math.max(0, Number(allocByKey.get(key) || 0));
    total += Math.max(0, pending - alloc);
  }
  return total;
}

/**
 * @returns {Promise<{ pendingByKey: Map<string, number>, labels: Map<string, string> }>}
 */
async function factoryPending(articleIds) {
  const pendingByKey = new Map();
  const labels = new Map();
  const articles = await Article.find({ _id: { $in: articleIds } })
    .select('articleNumber floorQuantities.dispatch.transferredData floorQuantities.warehouse.receivedData')
    .lean();
  for (const article of articles) {
    const rows = getPendingDispatchTransferredData(
      article.floorQuantities?.dispatch?.transferredData,
      article.floorQuantities?.warehouse?.receivedData
    );
    for (const row of rows) {
      const key = lockKey(article._id, row.brand);
      pendingByKey.set(key, (pendingByKey.get(key) || 0) + (Number(row.transferred) || 0));
      labels.set(key, `${article.articleNumber || ''} ${row.brand || ''}`.trim());
    }
  }
  return { pendingByKey, labels };
}

/**
 * @returns {Promise<{ pendingByKey: Map<string, number>, labels: Map<string, string> }>}
 */
async function vendorPending(flowIds) {
  const pendingByKey = new Map();
  const labels = new Map();
  const flows = await VendorProductionFlow.find({ _id: { $in: flowIds } })
    .select('referenceCode floorQuantities.dispatch.transferredData floorQuantities.dispatch.receivedData')
    .lean();
  for (const flow of flows) {
    const handoff = filterVendorWarehouseHandoffReceivedData(flow.floorQuantities?.dispatch?.receivedData);
    const rows = getPendingDispatchTransferredData(flow.floorQuantities?.dispatch?.transferredData, handoff);
    for (const row of rows) {
      const key = lockKey(flow._id, row.brand);
      pendingByKey.set(key, (pendingByKey.get(key) || 0) + (Number(row.transferred) || 0));
      labels.set(key, `${flow.referenceCode || flow._id} ${row.brand || ''}`.trim());
    }
  }
  return { pendingByKey, labels };
}

/**
 * Void known duplicate serials so their locks leave the active set.
 * @param {typeof DispatchStockTransferNote} Model
 * @param {string} activeStatus
 * @returns {Promise<string[]>}
 */
async function voidDuplicateSerials(Model, activeStatus) {
  const voided = [];
  for (const serial of DUPLICATE_SERIALS) {
    const note = await Model.findOne({ stnSerial: serial, status: activeStatus });
    if (!note) continue;
    voided.push(serial);
    if (!WRITE) continue;
    note.status = 'void';
    await note.save();
  }
  return voided;
}

/**
 * @param {string} label
 * @param {typeof DispatchStockTransferNote} Model
 * @param {string} idField
 * @param {string} activeStatus
 * @param {(ids: unknown[]) => Promise<{ pendingByKey: Map<string, number>, labels: Map<string, string> }>} loadPending
 */
async function repairSide(label, Model, idField, activeStatus, loadPending) {
  const voided = label === 'factory' ? await voidDuplicateSerials(Model, activeStatus) : [];
  const loaded = await Model.find({ status: activeStatus }).sort({ stnDate: -1, createdAt: -1 });
  const notes = loaded.filter((note) => !DUPLICATE_SERIALS.includes(note.stnSerial));
  const ids = [
    ...new Set(
      notes.flatMap((note) => (note.allocations || []).map((alloc) => String(alloc[idField]))).filter(Boolean)
    ),
  ];
  const { pendingByKey, labels } = await loadPending(ids);
  const before = sumAllocations(notes, idField);
  const eligibleBefore = sumEligible(pendingByKey, before);
  const changed = shrinkNewestFirst(notes, pendingByKey, idField);
  const afterNotes = await Promise.resolve(notes);
  const after = sumAllocations(afterNotes, idField);
  const eligibleAfter = sumEligible(pendingByKey, after);
  const removed = [...before.entries()].reduce((sum, [key, qty]) => {
    return sum + Math.max(0, qty - (after.get(key) || 0));
  }, 0);

  console.log(`\n${label}`);
  console.log('voided serials:', voided.length ? voided.join(', ') : 'none');
  console.log('notes touched:', changed.length);
  console.log('lock qty removed:', Math.round(removed * 1000) / 1000);
  console.log('still printable before:', Math.round(eligibleBefore * 1000) / 1000);
  console.log('still printable after:', Math.round(eligibleAfter * 1000) / 1000);

  const interesting = [...pendingByKey.entries()]
    .map(([key, pending]) => ({
      label: labels.get(key) || key,
      pending,
      before: before.get(key) || 0,
      after: after.get(key) || 0,
      printable: Math.max(0, pending - (after.get(key) || 0)),
    }))
    .filter((row) => row.printable > 0.001)
    .sort((a, b) => b.printable - a.printable)
    .slice(0, 15);
  if (interesting.length) {
    console.log('largest qty that would still print:');
    for (const row of interesting) {
      console.log(
        `  ${row.label}: pending ${row.pending}, lock ${row.before} -> ${row.after}, prints ${row.printable}`
      );
    }
  }

  if (WRITE) {
    for (const note of changed) {
      await note.save();
    }
  }

  const syncSerial = syncLinesSerial();
  if (label === 'factory' && syncSerial) {
    const note = await Model.findOne({ stnSerial: syncSerial, status: activeStatus });
    if (note) {
      const lockByKey = new Map();
      for (const alloc of note.allocations || []) {
        lockByKey.set(lockKey(alloc[idField], alloc.brand), Number(alloc.quantity) || 0);
      }
      const kept = [];
      for (const line of note.lines || []) {
        const key = lockKey(line.articleId, line.brand);
        const locked = lockByKey.get(key) || 0;
        if (locked <= 1e-9) continue;
        const qty = Math.min(Number(line.qtyInPairs) || 0, locked);
        if (qty <= 1e-9) continue;
        kept.push({ ...(line.toObject ? line.toObject() : line), qtyInPairs: qty });
        lockByKey.set(key, locked - qty);
      }
      const totalQty = kept.reduce((sum, line) => sum + (Number(line.qtyInPairs) || 0), 0);
      const boxes = new Set(kept.flatMap((line) => line.containerBarcodes || []));
      console.log(`${syncSerial} lines ${note.lines.length} -> ${kept.length}, total ${note.totalQty} -> ${totalQty}`);
      if (WRITE) {
        note.lines = kept;
        note.totalQty = totalQty;
        note.totalBoxes = boxes.size;
        note.markModified('lines');
        await note.save();
      }
    }
  }
}

/**
 * Repair factory and vendor transfer-note locks.
 * @returns {Promise<void>}
 */
async function main() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  console.log(WRITE ? 'WRITE' : 'DRY-RUN');
  await repairSide('factory', DispatchStockTransferNote, 'articleId', DispatchStnStatus.ACTIVE, factoryPending);
  await repairSide(
    'vendor',
    VendorDispatchStockTransferNote,
    'vendorProductionFlowId',
    VendorDispatchStnStatus.ACTIVE,
    vendorPending
  );
  if (!WRITE) console.log('\nDry run only. Re-run with --write to apply.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err?.message || err);
  try {
    await mongoose.disconnect();
  } catch (disconnectErr) {
    console.error(disconnectErr?.message || disconnectErr);
  }
  process.exit(1);
});
