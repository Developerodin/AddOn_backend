#!/usr/bin/env node
/** Quick check: vendor returns vs report PurRet sources for a month. */
import url from 'url';
const _origUrlParse = url.parse;
url.parse = function patchedParse(urlStr, ...args) {
  try { return _origUrlParse.call(this, urlStr, ...args); }
  catch { return _origUrlParse.call(this, String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2'), ...args); }
};
import mongoose from 'mongoose';
import config from '../config/config.js';
import { YarnPurchaseOrder, YarnPoVendorReturn } from '../models/index.js';

const startArg = process.argv.find((a) => a.startsWith('--start='))?.slice(8) ?? '2026-05-01';
const endArg = process.argv.find((a) => a.startsWith('--end='))?.slice(6) ?? '2026-05-31';
const [sy, sm, sd] = startArg.split('-').map(Number);
const [ey, em, ed] = endArg.split('-').map(Number);
const start = new Date(sy, sm - 1, sd);
const end = new Date(ey, em - 1, ed);
start.setHours(0, 0, 0, 0);
end.setHours(23, 59, 59, 999);

await mongoose.connect(config.mongoose.url, config.mongoose.options);

const vendorReturns = await YarnPoVendorReturn.find({
  status: 'completed',
  completedAt: { $gte: start, $lte: end },
})
  .select('poNumber completedAt totalNetWeight coneCount')
  .lean();

console.log(`Vendor returns (YarnPoVendorReturn) in ${startArg}..${endArg}:`, vendorReturns.length);
let vrKg = 0;
vendorReturns.forEach((v) => {
  vrKg += Number(v.totalNetWeight || 0);
  console.log(`  ${v.poNumber} ${v.completedAt?.toISOString?.()?.slice(0, 10)} ${v.totalNetWeight} kg (${v.coneCount} cones)`);
});
console.log('Total vendor return kg:', vrKg.toFixed(3));

const pos = await YarnPurchaseOrder.find({
  $or: [
    { currentStatus: 'po_rejected', lastUpdateDate: { $gte: start, $lte: end } },
    { 'receivedLotDetails.status': 'lot_rejected', lastUpdateDate: { $gte: start, $lte: end } },
    { 'receivedLotDetails.status': 'lot_returned_to_vendor', lastUpdateDate: { $gte: start, $lte: end } },
  ],
}).select('poNumber currentStatus receivedLotDetails lastUpdateDate').lean();

console.log(`\nPOs with lot_rejected / lot_returned_to_vendor / po_rejected in range: ${pos.length}`);
for (const po of pos.slice(0, 15)) {
  const lotStatuses = [...new Set((po.receivedLotDetails || []).map((l) => l.status))];
  console.log(`  ${po.poNumber} status=${po.currentStatus} lots=[${lotStatuses.join(',')}]`);
}

await mongoose.disconnect();
