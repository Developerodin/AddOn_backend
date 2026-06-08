#!/usr/bin/env node
/**
 * Backfill PO Return Challans for every completed YarnPoVendorReturn that
 * does not yet have a YarnPoReturnChallan snapshot.
 *
 * Usage:
 *   node scripts/backfill-po-return-challans.js                 # dry run (default)
 *   node scripts/backfill-po-return-challans.js --apply         # write challans
 *   node scripts/backfill-po-return-challans.js --apply --limit 10
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import { YarnPoVendorReturn, YarnPurchaseOrder, YarnPoReturnChallan } from '../src/models/index.js';
import * as yarnPoReturnChallanService from '../src/services/yarnManagement/yarnPoReturnChallan.service.js';
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

const main = async () => {
  const redactedUri = await connectMongooseForScript(config);
  log(`[backfill-po-return-challans] connected to ${redactedUri} (apply=${APPLY})`);

  let query = YarnPoVendorReturn.find({ status: 'completed' }).sort({ completedAt: 1, createdAt: 1 });
  if (LIMIT > 0) query = query.limit(LIMIT);
  const returns = await query.lean();

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const vr of returns) {
    const existing = await YarnPoReturnChallan.findOne({ vendorReturnId: vr._id }).select('_id challanNumber').lean();
    if (existing) {
      skipped += 1;
      continue;
    }

    const po = await YarnPurchaseOrder.findOne({ poNumber: vr.poNumber }).lean();
    if (!po) {
      log(`[skip] no PO for vendor return ${vr._id} po=${vr.poNumber}`);
      errors += 1;
      continue;
    }

    if (!APPLY) {
      log(`[dry-run] would create challan for vendorReturn=${vr._id} po=${vr.poNumber}`);
      created += 1;
      continue;
    }

    try {
      const challan = await yarnPoReturnChallanService.createChallanFromVendorReturn(vr, po, null, {
        isLegacy: true,
        challanDate: vr.completedAt || vr.createdAt,
      });
      log(`[created] ${challan.challanNumber} for vendorReturn=${vr._id}`);
      created += 1;
    } catch (err) {
      log(`[error] vendorReturn=${vr._id}: ${err?.message || err}`);
      errors += 1;
    }
  }

  log(`[done] total=${returns.length} created=${created} skipped=${skipped} errors=${errors}`);
  await mongoose.disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
