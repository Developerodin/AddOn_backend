#!/usr/bin/env node
/**
 * Backfills YarnPurchaseOrder.goodsReceivedDate for POs with accepted lots but null date.
 *
 * Usage:
 *   NODE_ENV=development node src/scripts/backfill-po-goods-received-date.js
 *   NODE_ENV=development node src/scripts/backfill-po-goods-received-date.js --apply
 *   NODE_ENV=development node src/scripts/backfill-po-goods-received-date.js --po=PO-2026-1187 --apply
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
import { YarnPurchaseOrder, YarnBox } from '../models/index.js';

/**
 * @param {string} flag
 * @returns {string|undefined}
 */
function argValue(flag) {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

const apply = process.argv.includes('--apply');
const poFilter = argValue('--po');

/**
 * Resolves goodsReceivedDate for a PO using receive metadata and box dates.
 * @param {object} po Lean PO document
 * @param {Date|null} earliestBoxDate
 * @returns {Date}
 */
function resolveGoodsReceivedDate(po, earliestBoxDate) {
  if (po.receivedBy?.receivedAt) return new Date(po.receivedBy.receivedAt);
  if (earliestBoxDate) return earliestBoxDate;
  if (po.lastUpdateDate) return new Date(po.lastUpdateDate);
  if (po.createDate) return new Date(po.createDate);
  return new Date();
}

/**
 * @param {object} po
 * @returns {boolean}
 */
function hasAcceptedLot(po) {
  return (po.receivedLotDetails || []).some((lot) => lot.status === 'lot_accepted');
}

/**
 * Earliest QC-approved box received date for a PO.
 * @param {string} poNumber
 * @returns {Promise<Date|null>}
 */
async function getEarliestBoxDate(poNumber) {
  const earliestBox = await YarnBox.findOne({
    poNumber,
    'qcData.status': 'qc_approved',
    returnedToVendorAt: null,
  })
    .sort({ receivedDate: 1, createdAt: 1 })
    .select('receivedDate createdAt')
    .lean();

  if (earliestBox?.receivedDate) return new Date(earliestBox.receivedDate);
  if (earliestBox?.createdAt) return new Date(earliestBox.createdAt);
  return null;
}

async function main() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  const match = {
    goodsReceivedDate: null,
    currentStatus: { $in: ['goods_received', 'goods_partially_received'] },
    'receivedLotDetails.status': 'lot_accepted',
  };
  if (poFilter) {
    match.poNumber = new RegExp(`^${poFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  }

  const pos = await YarnPurchaseOrder.find(match)
    .select('poNumber goodsReceivedDate receivedBy lastUpdateDate createDate receivedLotDetails')
    .lean();

  console.log(`Found ${pos.length} PO(s) needing goodsReceivedDate backfill`);

  const updates = [];
  for (const po of pos) {
    if (!hasAcceptedLot(po)) continue;

    const boxDate = await getEarliestBoxDate(po.poNumber);
    const proposed = resolveGoodsReceivedDate(po, boxDate);
    updates.push({
      poNumber: po.poNumber,
      proposed: proposed.toISOString().slice(0, 10),
      source: po.receivedBy?.receivedAt
        ? 'receivedBy.receivedAt'
        : boxDate
          ? 'YarnBox.receivedDate'
          : 'lastUpdateDate',
    });
  }

  updates.forEach((u) => {
    console.log(`  ${u.poNumber} → ${u.proposed} (${u.source})`);
  });

  if (!apply) {
    console.log('\nDry run — pass --apply to write dates.');
    await mongoose.disconnect();
    return;
  }

  let applied = 0;
  for (const po of pos) {
    if (!hasAcceptedLot(po)) continue;

    const boxDate = await getEarliestBoxDate(po.poNumber);
    const goodsReceivedDate = resolveGoodsReceivedDate(po, boxDate);
    await YarnPurchaseOrder.updateOne({ _id: po._id }, { $set: { goodsReceivedDate } });
    applied += 1;
  }

  console.log(`\nApplied goodsReceivedDate on ${applied} PO(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
