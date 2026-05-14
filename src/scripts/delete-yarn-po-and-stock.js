#!/usr/bin/env node
/**
 * Hard-delete a yarn PO and all stock rows tied to it (boxes, cones), plus GRNs,
 * vendor-return docs, yarn transactions keyed by those box/cone ids, and the PO itself.
 * Clears YarnRequisition refs to this PO. Recalculates YarnInventory for touched catalogs.
 *
 * Usage:
 *   node src/scripts/delete-yarn-po-and-stock.js PO-2026-1186           # dry-run (counts only)
 *   node src/scripts/delete-yarn-po-and-stock.js PO-2026-1186 --execute # perform deletes
 *
 * DB: same as `qc-approve-all-lots-yarn-po.js` — loads `./lib/mongoUrlParsePatch.js` before mongoose
 * (Node 22+ url.parse vs mongodb 3.x). Optional: `--mongo-url=mongodb+srv://...`
 */

import './lib/mongoUrlParsePatch.js';
import mongoose from 'mongoose';
import {
  YarnBox,
  YarnCone,
  YarnGrn,
  YarnPoVendorReturn,
  YarnPurchaseOrder,
  YarnRequisition,
  YarnTransaction,
} from '../models/index.js';
import config from '../config/config.js';
import { syncInventoriesFromStorageForCatalogIds } from '../services/yarnManagement/yarnInventory.service.js';

/**
 * Normalize URL for CLI overrides (quotes, BOM, stray CR).
 * @param {string} rawUrl
 * @returns {string}
 */
function sanitizeMongoUrl(rawUrl) {
  let u = String(rawUrl || '').replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  if (u.endsWith('>')) {
    u = u.slice(0, -1);
  }
  return u;
}

/**
 * Connect using `MONGODB_URL` via config, or `--mongo-url=...` override.
 * @returns {Promise<void>}
 */
async function connectMongo() {
  const cliArg = process.argv.find((a) => a.startsWith('--mongo-url='));
  const raw = cliArg
    ? sanitizeMongoUrl(cliArg.slice('--mongo-url='.length))
    : String(config?.mongoose?.url || '').trim();
  if (!raw) {
    throw new Error('MongoDB URL is empty. Set MONGODB_URL in .env or pass --mongo-url=');
  }
  await mongoose.connect(raw, config.mongoose.options);
}

/**
 * @param {string[]} argv
 * @returns {{ poNumber: string, execute: boolean }}
 */
function parseArgs(argv) {
  const positional = argv.filter((a) => !a.startsWith('-'));
  const poNumber = positional[0] || 'PO-2026-1186';
  const execute = argv.includes('--execute');
  return { poNumber: poNumber.trim(), execute };
}

/**
 * Collect unique yarn catalog ids from box/cone docs (Mongo-friendly strings).
 * @param {Array<{ yarnCatalogId?: unknown }>} docs
 * @returns {string[]}
 */
function catalogIdsFromDocs(docs) {
  const set = new Set();
  for (const d of docs) {
    const id = d?.yarnCatalogId;
    if (id != null && mongoose.Types.ObjectId.isValid(String(id))) {
      set.add(String(id));
    }
  }
  return [...set];
}

/**
 * @param {object} params
 * @param {string} params.poNumber
 * @param {boolean} params.execute
 */
async function deleteYarnPoCascade({ poNumber, execute }) {
  const poDoc = await YarnPurchaseOrder.findOne({ poNumber }).lean();
  const boxes = await YarnBox.find({ poNumber }).select('boxId yarnCatalogId').lean();
  const cones = await YarnCone.find({ poNumber }).select('_id yarnCatalogId').lean();
  const boxIds = [...new Set(boxes.map((b) => b.boxId).filter(Boolean))];
  const coneIds = cones.map((c) => c._id);

  const grnCount = await YarnGrn.countDocuments({ poNumber });
  const vendorReturnCount = await YarnPoVendorReturn.countDocuments({ poNumber });

  const txFilter =
    boxIds.length > 0 || coneIds.length > 0
      ? {
          $or: [
            ...(boxIds.length ? [{ orderno: { $in: boxIds } }, { boxIds: { $in: boxIds } }] : []),
            ...(coneIds.length ? [{ conesIdsArray: { $in: coneIds } }] : []),
          ],
        }
      : null;
  const txCount = txFilter ? await YarnTransaction.countDocuments(txFilter) : 0;

  const reqFilter = poDoc ? { $or: [{ linkedPurchaseOrderId: poDoc._id }, { attachedDraftPoId: poDoc._id }] } : null;
  const reqCount = reqFilter ? await YarnRequisition.countDocuments(reqFilter) : 0;

  console.log('\n--- delete-yarn-po-and-stock ---');
  console.log(`PO number:     ${poNumber}`);
  console.log(`PO document:   ${poDoc ? String(poDoc._id) : '(none — will still remove boxes/cones/etc.)'}`);
  console.log(`YarnBox:       ${boxes.length}`);
  console.log(`YarnCone:      ${cones.length}`);
  console.log(`YarnGrn:       ${grnCount}`);
  console.log(`VendorReturn:  ${vendorReturnCount}`);
  console.log(`YarnTransaction (matched): ${txCount}`);
  console.log(`YarnRequisition (unlink): ${reqCount}`);
  console.log(`Mode:          ${execute ? 'EXECUTE (destructive)' : 'DRY-RUN (pass --execute to delete)'}\n`);

  if (!execute) {
    console.log('Dry-run complete. No changes made.\n');
    return;
  }

  const catalogIds = [...new Set([...catalogIdsFromDocs(boxes), ...catalogIdsFromDocs(cones)])];

  // Sequential deletes (no multi-doc transaction — works on standalone MongoDB).
  if (coneIds.length) {
    const r = await YarnCone.deleteMany({ _id: { $in: coneIds } });
    console.log(`Deleted YarnCone: ${r.deletedCount}`);
  } else {
    console.log('Deleted YarnCone: 0');
  }

  const rBox = await YarnBox.deleteMany({ poNumber });
  console.log(`Deleted YarnBox: ${rBox.deletedCount}`);

  if (txFilter) {
    const r = await YarnTransaction.deleteMany(txFilter);
    console.log(`Deleted YarnTransaction: ${r.deletedCount}`);
  } else {
    console.log('Deleted YarnTransaction: 0');
  }

  const rGrn = await YarnGrn.deleteMany({ poNumber });
  console.log(`Deleted YarnGrn: ${rGrn.deletedCount}`);

  const rVr = await YarnPoVendorReturn.deleteMany({ poNumber });
  console.log(`Deleted YarnPoVendorReturn: ${rVr.deletedCount}`);

  if (poDoc) {
    if (reqFilter) {
      const r1 = await YarnRequisition.updateMany({ linkedPurchaseOrderId: poDoc._id }, { $unset: { linkedPurchaseOrderId: 1 } });
      const r2 = await YarnRequisition.updateMany({ attachedDraftPoId: poDoc._id }, { $unset: { attachedDraftPoId: 1 } });
      console.log(`Unlinked YarnRequisition (linkedPurchaseOrderId): ${r1.modifiedCount}`);
      console.log(`Unlinked YarnRequisition (attachedDraftPoId): ${r2.modifiedCount}`);
    }

    const rPo = await YarnPurchaseOrder.deleteOne({ _id: poDoc._id });
    console.log(`Deleted YarnPurchaseOrder: ${rPo.deletedCount}`);
  } else {
    console.log('Deleted YarnPurchaseOrder: 0 (no PO row)');
  }

  if (catalogIds.length) {
    console.log(`\nSyncing YarnInventory for ${catalogIds.length} catalog id(s)…`);
    try {
      await syncInventoriesFromStorageForCatalogIds(catalogIds);
      console.log('Inventory sync finished.');
    } catch (err) {
      console.error('Inventory sync failed:', err?.message || err);
      throw err;
    }
  } else {
    console.log('\nNo yarnCatalogId on deleted boxes/cones — skipped inventory sync.');
  }

  console.log('\nDone.\n');
}

const run = async () => {
  const { poNumber, execute } = parseArgs(process.argv.slice(2));
  try {
    await connectMongo();
    await deleteYarnPoCascade({ poNumber, execute });
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
};

run();
