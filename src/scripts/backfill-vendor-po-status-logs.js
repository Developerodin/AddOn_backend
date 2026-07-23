#!/usr/bin/env node
/**
 * Backfills VendorPurchaseOrder.statusLogs for POs with a currentStatus but empty history.
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/backfill-vendor-po-status-logs.js
 *   NODE_ENV=development node src/scripts/backfill-vendor-po-status-logs.js --apply
 *   NODE_ENV=development node src/scripts/backfill-vendor-po-status-logs.js --vpo=VPO-2026-0001 --apply
 */

import url from 'url';

const _origUrlParse = url.parse;
url.parse = function patchedParse(urlStr, ...args) {
  try {
    return _origUrlParse.call(this, urlStr, ...args);
  } catch {
    return _origUrlParse.call(this, String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2'), ...args);
  }
};

import mongoose from 'mongoose';
import config from '../config/config.js';
import { VendorPurchaseOrder } from '../models/index.js';
import User from '../models/user.model.js';

/**
 * @param {string} flag
 * @returns {string|undefined}
 */
function argValue(flag) {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

const apply = process.argv.includes('--apply');
const vpoFilter = argValue('--vpo');

/**
 * Resolve a system user id for backfill audit entries.
 * @returns {Promise<mongoose.Types.ObjectId|null>}
 */
async function resolveBackfillUserId() {
  const admin = await User.findOne({ role: { $in: ['admin', 'super_admin'] } })
    .sort({ createdAt: 1 })
    .select('_id name email')
    .lean();
  if (admin?._id) return admin._id;

  const anyUser = await User.findOne().sort({ createdAt: 1 }).select('_id').lean();
  return anyUser?._id ?? null;
}

async function main() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  const backfillUserId = await resolveBackfillUserId();
  if (!backfillUserId) {
    throw new Error('No user found to attach backfilled status history entries');
  }

  const match = {
    currentStatus: { $exists: true, $ne: null },
    $or: [{ statusLogs: { $exists: false } }, { statusLogs: { $size: 0 } }],
  };
  if (vpoFilter) {
    match.vpoNumber = new RegExp(`^${vpoFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  }

  const orders = await VendorPurchaseOrder.find(match)
    .select('vpoNumber currentStatus lastUpdateDate createDate')
    .lean();

  console.log(`Found ${orders.length} vendor PO(s) needing statusLogs backfill`);

  orders.forEach((po) => {
    const at = po.lastUpdateDate || po.createDate || new Date();
    console.log(`  ${po.vpoNumber} → ${po.currentStatus} (${new Date(at).toISOString()})`);
  });

  if (!apply) {
    console.log('\nDry run — pass --apply to write status history entries.');
    await mongoose.disconnect();
    return;
  }

  let applied = 0;
  for (const po of orders) {
    const updatedAt = po.lastUpdateDate || po.createDate || new Date();
    await VendorPurchaseOrder.updateOne(
      { _id: po._id },
      {
        $push: {
          statusLogs: {
            statusCode: po.currentStatus,
            updatedBy: {
              username: 'system',
              user: backfillUserId,
            },
            updatedAt,
            notes: 'Backfilled from current status',
          },
        },
      }
    );
    applied += 1;
  }

  console.log(`\nApplied statusLogs backfill on ${applied} vendor PO(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
