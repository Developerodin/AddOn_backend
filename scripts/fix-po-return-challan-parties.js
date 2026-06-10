#!/usr/bin/env node
/**
 * Fixes supplier/consignee on existing PO Return Challans:
 * - Legacy GRN-inverted layout (vendor as supplier, ADDON HOLDINGS as consignee)
 * - Incomplete consignee snapshots (name present but missing GST, address, or contact)
 *
 * Rebuilds vendor party from PO + Brand Master at backfill time, then stores immutably on challan.
 *
 * Usage:
 *   node scripts/fix-po-return-challan-parties.js                 # dry run (default)
 *   node scripts/fix-po-return-challan-parties.js --apply         # write updates
 *   node scripts/fix-po-return-challan-parties.js --apply --limit 10
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import { YarnPoReturnChallan, YarnPurchaseOrder } from '../src/models/index.js';
import { buildConsigneeSnapshot } from '../src/services/yarnManagement/yarnGrnSnapshot.builder.js';
import {
  buildVendorConsigneeSnapshot,
} from '../src/services/yarnManagement/yarnPoReturnChallanSnapshot.builder.js';
import { connectMongooseForScript } from './lib/mongoScriptConnect.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LIMIT_FLAG_IDX = args.indexOf('--limit');
const LIMIT = LIMIT_FLAG_IDX !== -1 ? parseInt(args[LIMIT_FLAG_IDX + 1] || '0', 10) || 0 : 0;

const log = (msg, data) => {
  if (data === undefined) {
    console.log(msg);
    return;
  }
  console.log(msg, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
};

/**
 * Maps legacy supplier snapshot fields into vendor consignee shape.
 * @param {object} legacySupplier
 * @returns {object}
 */
const consigneeFromLegacySupplier = (legacySupplier) => ({
  supplierId: legacySupplier?.supplierId || undefined,
  name: legacySupplier?.name || '',
  address: legacySupplier?.address || '',
  city: legacySupplier?.city || '',
  state: legacySupplier?.state || '',
  pincode: legacySupplier?.pincode || '',
  country: legacySupplier?.country || '',
  gstNo: legacySupplier?.gstNo || '',
  contactNumber: legacySupplier?.contactNumber || '',
  contactPersonName: legacySupplier?.contactPersonName || '',
  email: legacySupplier?.email || '',
  stateCode: (legacySupplier?.gstNo || '').trim().slice(0, 2) || undefined,
});

/**
 * Whether challan still uses legacy inverted party layout.
 * @param {object} challan
 * @returns {boolean}
 */
const isLegacyLayout = (challan) =>
  /^(ADDON HOLDINGS|ADDON HOLDINGS PRIVATE LIMITED)$/i.test((challan.consignee?.name || '').trim());

/**
 * Mongo filter for challans needing party snapshot repair.
 * @returns {object}
 */
const buildRepairQuery = () => ({
  $or: [
    { 'consignee.name': { $regex: /^ADDON HOLDINGS$/i } },
    {
      'consignee.name': { $exists: true, $nin: [null, ''] },
      $or: [
        { 'consignee.gstNo': { $in: [null, ''] } },
        { 'consignee.address': { $in: [null, ''] } },
        { 'consignee.contactNumber': { $in: [null, ''] } },
      ],
    },
  ],
});

/**
 * Resolves consignee snapshot for a challan needing repair.
 * @param {object} challan
 * @param {object|null} po
 * @returns {Promise<object|null>}
 */
const resolveConsigneeForRepair = async (challan, po) => {
  if (!po) return null;

  if (isLegacyLayout(challan)) {
    const fromLegacy = consigneeFromLegacySupplier(challan.supplier);
    const supplierIsAddon = /^(ADDON HOLDINGS|ADDON HOLDINGS PRIVATE LIMITED)$/i.test(
      (challan.supplier?.name || '').trim()
    );
    const legacyComplete =
      fromLegacy.name &&
      !supplierIsAddon &&
      fromLegacy.gstNo &&
      fromLegacy.address &&
      fromLegacy.contactNumber;

    if (legacyComplete) {
      const fromPo = await buildVendorConsigneeSnapshot(po);
      return {
        ...fromLegacy,
        supplierId: fromPo.supplierId || fromLegacy.supplierId,
      };
    }
  }

  return buildVendorConsigneeSnapshot(po);
};

const main = async () => {
  const redactedUri = await connectMongooseForScript(config);
  log(`[fix-po-return-challan-parties] connected to ${redactedUri} (apply=${APPLY})`);

  let query = YarnPoReturnChallan.find(buildRepairQuery()).sort({ createdAt: 1 });
  if (LIMIT > 0) query = query.limit(LIMIT);
  const challans = await query.lean();

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const challan of challans) {
    try {
      const po = await YarnPurchaseOrder.findById(challan.purchaseOrder).lean();
      if (!po) {
        log(`[skip] no PO for challan ${challan.challanNumber}`);
        skipped += 1;
        continue;
      }

      const consignee = await resolveConsigneeForRepair(challan, po);
      if (!consignee?.name) {
        log(`[skip] could not resolve consignee for ${challan.challanNumber}`);
        skipped += 1;
        continue;
      }

      const supplier = buildConsigneeSnapshot();
      const reason = isLegacyLayout(challan) ? 'legacy' : 'incomplete';

      if (!APPLY) {
        log(
          `[dry-run] would fix (${reason}) ${challan.challanNumber}: consignee=${consignee.name} gst=${consignee.gstNo || '—'}`
        );
        updated += 1;
        continue;
      }

      await YarnPoReturnChallan.updateOne(
        { _id: challan._id },
        { $set: { supplier, consignee } }
      );
      log(`[updated] (${reason}) ${challan.challanNumber} consignee=${consignee.name}`);
      updated += 1;
    } catch (err) {
      log(`[error] ${challan.challanNumber}: ${err?.message || err}`);
      errors += 1;
    }
  }

  log(`[done] total=${challans.length} updated=${updated} skipped=${skipped} errors=${errors}`);
  await mongoose.disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
