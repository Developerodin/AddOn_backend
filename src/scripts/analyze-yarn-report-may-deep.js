#!/usr/bin/env node
/** Deep analysis for May yarn report issue/return and purchase data. */
import url from 'url';
const _origUrlParse = url.parse;
url.parse = function patchedParse(urlStr, ...args) {
  try { return _origUrlParse.call(this, urlStr, ...args); }
  catch { return _origUrlParse.call(this, String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2'), ...args); }
};

import mongoose from 'mongoose';
import config from '../config/config.js';
import { YarnPurchaseOrder, YarnTransaction } from '../models/index.js';

const toNum = (v) => Number(v ?? 0);
const startArg = process.argv.find((a) => a.startsWith('--start='))?.slice(8) ?? '2026-05-01';
const endArg = process.argv.find((a) => a.startsWith('--end='))?.slice(6) ?? '2026-05-31';
const [sy, sm, sd] = startArg.split('-').map(Number);
const [ey, em, ed] = endArg.split('-').map(Number);
const start = new Date(sy, sm - 1, sd);
const end = new Date(ey, em - 1, ed);
start.setHours(0, 0, 0, 0);
end.setHours(23, 59, 59, 999);

await mongoose.connect(config.mongoose.url, config.mongoose.options);

const pos = await YarnPurchaseOrder.find({
  createDate: { $gte: start, $lte: end },
  currentStatus: { $ne: 'draft' },
}).lean();

let altPur = 0;
let altPurRet = 0;
for (const po of pos) {
  for (const item of po.poItems || []) {
    for (const lot of po.receivedLotDetails || []) {
      for (const rec of lot.poItems || []) {
        if (rec.poItem?.toString?.() !== item._id?.toString?.()) continue;
        const qty = toNum(rec.receivedQuantity);
        if (lot.status === 'lot_accepted') altPur += qty;
        else if (lot.status === 'lot_rejected') altPurRet += qty;
      }
    }
  }
}

console.log('=== ALT PUR (May POs, lot_accepted, ignoring goodsReceivedDate) ===');
console.log(`Pur: ${altPur.toFixed(3)} kg | PurRet: ${altPurRet.toFixed(3)} kg | PO count: ${pos.length}`);

const retByDay = await YarnTransaction.aggregate([
  { $match: { transactionType: 'yarn_returned', transactionDate: { $gte: start, $lte: end } } },
  {
    $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$transactionDate' } },
      kg: { $sum: '$transactionNetWeight' },
      cnt: { $sum: 1 },
    },
  },
  { $sort: { _id: 1 } },
]);

console.log('\n=== RETURN TXNS BY DAY ===');
retByDay.forEach((d) => console.log(`  ${d._id}: ${d.kg.toFixed(1)} kg (${d.cnt} txns)`));

const [issueStats] = await YarnTransaction.aggregate([
  { $match: { transactionType: 'yarn_issued', transactionDate: { $gte: start, $lte: end } } },
  {
    $group: {
      _id: null,
      avg: { $avg: '$transactionNetWeight' },
      max: { $max: '$transactionNetWeight' },
      zero: { $sum: { $cond: [{ $eq: ['$transactionNetWeight', 0] }, 1, 0] } },
      total: { $sum: 1 },
    },
  },
]);

const [retStats] = await YarnTransaction.aggregate([
  { $match: { transactionType: 'yarn_returned', transactionDate: { $gte: start, $lte: end } } },
  {
    $group: {
      _id: null,
      avg: { $avg: '$transactionNetWeight' },
      max: { $max: '$transactionNetWeight' },
      zero: { $sum: { $cond: [{ $eq: ['$transactionNetWeight', 0] }, 1, 0] } },
      total: { $sum: 1 },
    },
  },
]);

console.log('\n=== ISSUE vs RETURN WEIGHT STATS ===');
console.log('Issue:', issueStats);
console.log('Return:', retStats);

const bigReturns = await YarnTransaction.find({
  transactionType: 'yarn_returned',
  transactionDate: { $gte: start, $lte: end },
  transactionNetWeight: { $gt: 20 },
})
  .select('yarnName transactionNetWeight transactionDate transactionConeCount orderno issueBatchId')
  .sort({ transactionNetWeight: -1 })
  .limit(8)
  .lean();

console.log('\n=== TOP RETURN TXNS (>20kg) ===');
bigReturns.forEach((t) => {
  console.log(
    `  ${(t.yarnName || '').slice(0, 45)} | ${t.transactionNetWeight} kg | ${t.transactionConeCount} cones | ${t.transactionDate?.toISOString?.()?.slice(0, 10)}`
  );
});

// Compare Apr returns for context
const aprStart = new Date(2026, 3, 1);
const aprEnd = new Date(2026, 3, 30, 23, 59, 59, 999);
const [aprRet] = await YarnTransaction.aggregate([
  { $match: { transactionType: 'yarn_returned', transactionDate: { $gte: aprStart, $lte: aprEnd } } },
  { $group: { _id: null, kg: { $sum: '$transactionNetWeight' }, cnt: { $sum: 1 } } },
]);
console.log('\n=== APR 2026 COMPARISON ===');
console.log(`Apr returned: ${(aprRet?.kg ?? 0).toFixed(1)} kg (${aprRet?.cnt ?? 0} txns)`);
console.log(`May returned: ${retStats?.total ? retStats.total : 0} txns`);

const badReturns = await YarnTransaction.find({
  transactionType: 'yarn_returned',
  transactionDate: { $gte: new Date(2026, 4, 4), $lte: new Date(2026, 4, 4, 23, 59, 59, 999) },
  transactionNetWeight: { $gt: 1000 },
})
  .select(
    'yarnName transactionNetWeight transactionConeCount conesIdsArray orderno orderId articleId createdAt issueBatchId issuedByEmail'
  )
  .lean();

console.log('\n=== BAD RETURN TXNS (>1000kg on May 4) ===');
badReturns.forEach((t) => {
  console.log(
    JSON.stringify(
      {
        id: String(t._id),
        yarnName: t.yarnName,
        weight: t.transactionNetWeight,
        cones: t.transactionConeCount,
        coneIdCount: t.conesIdsArray?.length,
        orderno: t.orderno,
        issueBatchId: t.issueBatchId,
        createdAt: t.createdAt,
      },
      null,
      2
    )
  );
});

await mongoose.disconnect();
