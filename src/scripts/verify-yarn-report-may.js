#!/usr/bin/env node
/**
 * Verify yarn stock report fields vs raw PO + transaction data for a date range.
 * Usage: NODE_ENV=development node src/scripts/verify-yarn-report-may.js --start=2026-05-01 --end=2026-05-31
 */

import url from 'url';

const _origUrlParse = url.parse;
url.parse = function patchedParse(urlStr, ...args) {
  try {
    return _origUrlParse.call(this, urlStr, ...args);
  } catch {
    const firstHost = String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2');
    return _origUrlParse.call(this, firstHost, ...args);
  }
};

import mongoose from 'mongoose';
import config from '../config/config.js';
import { YarnPurchaseOrder, YarnTransaction, YarnDailyClosingSnapshot } from '../models/index.js';
import { getYarnReportByDateRange } from '../services/yarnManagement/yarnReport.service.js';

const toNum = (v) => Number(v ?? 0);

function parseLocalDate(dateInput) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateInput).trim())) {
    const [y, m, d] = String(dateInput).trim().split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(NaN);
}

function parseArgs() {
  const startArg = process.argv.find((a) => a.startsWith('--start='))?.slice(8) ?? '2026-05-01';
  const endArg = process.argv.find((a) => a.startsWith('--end='))?.slice(6) ?? '2026-05-31';
  return { startArg, endArg };
}

async function main() {
  const { startArg, endArg } = parseArgs();
  const start = parseLocalDate(startArg);
  const end = parseLocalDate(endArg);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  console.log('\n=== YARN REPORT VERIFICATION ===');
  console.log(`Range: ${startArg} → ${endArg}\n`);

  // --- Raw PO queries ---
  const posByGoodsReceived = await YarnPurchaseOrder.find({
    goodsReceivedDate: { $gte: start, $lte: end },
  })
    .select('poNumber goodsReceivedDate createDate currentStatus lastUpdateDate poItems receivedLotDetails')
    .lean();

  const posByCreateDate = await YarnPurchaseOrder.find({
    createDate: { $gte: start, $lte: end },
    currentStatus: { $ne: 'draft' },
  })
    .select('poNumber goodsReceivedDate createDate currentStatus')
    .lean();

  const posReportQuery = await YarnPurchaseOrder.find({
    $or: [
      { goodsReceivedDate: { $gte: start, $lte: end } },
      { currentStatus: 'po_rejected', lastUpdateDate: { $gte: start, $lte: end } },
      { 'receivedLotDetails.status': 'lot_rejected', lastUpdateDate: { $gte: start, $lte: end } },
    ],
  })
    .select('poNumber goodsReceivedDate createDate currentStatus lastUpdateDate poItems receivedLotDetails')
    .lean();

  console.log('--- PURCHASE ORDERS ---');
  console.log(`POs with goodsReceivedDate in range: ${posByGoodsReceived.length}`);
  console.log(`POs with createDate in range (non-draft): ${posByCreateDate.length}`);
  console.log(`POs matched by report query ($or): ${posReportQuery.length}`);

  // Manual pur calculation like report service
  let manualPurKg = 0;
  let manualPurRetKg = 0;
  const purByPo = [];

  for (const po of posReportQuery) {
    const poInRange = po.goodsReceivedDate >= start && po.goodsReceivedDate <= end;
    const rejectionInRange = po.lastUpdateDate >= start && po.lastUpdateDate <= end;
    let poPur = 0;
    let poPurRet = 0;

    for (const item of po.poItems || []) {
      for (const lot of po.receivedLotDetails || []) {
        for (const rec of lot.poItems || []) {
          const poItemId = rec.poItem?.toString?.();
          if (poItemId !== item._id?.toString?.()) continue;
          const qty = toNum(rec.receivedQuantity);
          if (lot.status === 'lot_rejected' && rejectionInRange) poPurRet += qty;
          else if (lot.status === 'lot_accepted' && poInRange) poPur += qty;
        }
      }
      if (po.currentStatus === 'po_rejected' && rejectionInRange) {
        poPurRet += toNum(item.quantity);
      }
    }

    if (poPur > 0 || poPurRet > 0) {
      purByPo.push({
        poNumber: po.poNumber,
        goodsReceivedDate: po.goodsReceivedDate,
        createDate: po.createDate,
        status: po.currentStatus,
        pur: poPur,
        purRet: poPurRet,
        lotCount: (po.receivedLotDetails || []).length,
        lotsAccepted: (po.receivedLotDetails || []).filter((l) => l.status === 'lot_accepted').length,
      });
    }
    manualPurKg += poPur;
    manualPurRetKg += poPurRet;
  }

  console.log(`Manual Pur (report logic): ${manualPurKg.toFixed(3)} kg`);
  console.log(`Manual PurRet (report logic): ${manualPurRetKg.toFixed(3)} kg`);
  console.log(`POs contributing Pur/PurRet: ${purByPo.length}`);

  // POs with createDate in range but NO goodsReceivedDate in range
  const createdNotReceived = posByCreateDate.filter((po) => {
    const grd = po.goodsReceivedDate;
    return !grd || grd < start || grd > end;
  });
  if (createdNotReceived.length) {
    console.log(`\n⚠ POs CREATED in range but goodsReceivedDate NOT in range: ${createdNotReceived.length}`);
    createdNotReceived.slice(0, 10).forEach((po) => {
      console.log(
        `  ${po.poNumber} create=${po.createDate?.toISOString?.()?.slice(0, 10)} grd=${po.goodsReceivedDate?.toISOString?.()?.slice(0, 10) ?? 'null'} status=${po.currentStatus}`
      );
    });
  }

  // POs with goodsReceivedDate but no lot_accepted lots
  const receivedNoAcceptedLots = posByGoodsReceived.filter((po) => {
    const hasAccepted = (po.receivedLotDetails || []).some((l) => l.status === 'lot_accepted');
    return !hasAccepted;
  });
  if (receivedNoAcceptedLots.length) {
    console.log(`\n⚠ POs with goodsReceivedDate in range but NO lot_accepted: ${receivedNoAcceptedLots.length}`);
    receivedNoAcceptedLots.slice(0, 10).forEach((po) => {
      const statuses = [...new Set((po.receivedLotDetails || []).map((l) => l.status))];
      console.log(`  ${po.poNumber} grd=${po.goodsReceivedDate?.toISOString?.()?.slice(0, 10)} lots=${statuses.join(',') || 'none'}`);
    });
  }

  if (purByPo.length) {
    console.log('\nTop POs with Pur/PurRet:');
    purByPo.sort((a, b) => b.pur - a.pur).slice(0, 15).forEach((p) => {
      console.log(
        `  ${p.poNumber} pur=${p.pur.toFixed(2)} purRet=${p.purRet.toFixed(2)} grd=${p.goodsReceivedDate?.toISOString?.()?.slice(0, 10)} lots=${p.lotsAccepted}/${p.lotCount}`
      );
    });
  }

  // --- Transactions ---
  const txnAgg = await YarnTransaction.aggregate([
    { $match: { transactionDate: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: '$transactionType',
        kg: { $sum: { $ifNull: ['$transactionNetWeight', 0] } },
        count: { $sum: 1 },
      },
    },
    { $sort: { kg: -1 } },
  ]);

  console.log('\n--- YARN TRANSACTIONS ---');
  txnAgg.forEach((t) => console.log(`  ${t._id}: ${t.kg.toFixed(3)} kg (${t.count} txns)`));

  const issueTypes = ['yarn_issued', 'yarn_issued_linking', 'yarn_issued_sampling'];
  const issuedKg = txnAgg.filter((t) => issueTypes.includes(t._id)).reduce((s, t) => s + t.kg, 0);
  const returnedKg = txnAgg.find((t) => t._id === 'yarn_returned')?.kg ?? 0;
  console.log(`Total issued (report types): ${issuedKg.toFixed(3)} kg`);
  console.log(`Total returned: ${returnedKg.toFixed(3)} kg`);

  // --- Snapshots ---
  const prevDay = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
  const openingKey = `${prevDay.getFullYear()}-${String(prevDay.getMonth() + 1).padStart(2, '0')}-${String(prevDay.getDate()).padStart(2, '0')}`;
  const closingKey = endArg;

  const openingSnap = await YarnDailyClosingSnapshot.countDocuments({ snapshotDate: openingKey });
  const closingSnap = await YarnDailyClosingSnapshot.countDocuments({ snapshotDate: closingKey });

  console.log('\n--- SNAPSHOTS ---');
  console.log(`Opening snapshot (${openingKey}): ${openingSnap} yarn rows`);
  console.log(`Closing snapshot (${closingKey}): ${closingSnap} yarn rows`);

  // --- Full report API ---
  let report;
  try {
    report = await getYarnReportByDateRange({ startDate: startArg, endDate: endArg });
  } catch (err) {
    console.log(`\n⚠ Report API error: ${err.message}`);
    await mongoose.disconnect();
    return;
  }

  const reportPur = report.results.reduce((s, r) => s + r.pur, 0);
  const reportPurRet = report.results.reduce((s, r) => s + r.purRet, 0);
  const reportIssued = report.results.reduce((s, r) => s + r.yarnIssueToKnitting, 0);
  const reportReturned = report.results.reduce((s, r) => s + r.yarnReturnedFromKnitting, 0);
  const rowsWithPur = report.results.filter((r) => r.pur > 0).length;
  const rowsWithPurRet = report.results.filter((r) => r.purRet > 0).length;

  console.log('\n--- REPORT OUTPUT ---');
  console.log(`Report rows: ${report.results.length}`);
  console.log(`Rows with pur > 0: ${rowsWithPur}`);
  console.log(`Rows with purRet > 0: ${rowsWithPurRet}`);
  console.log(`Σ pur (all rows): ${reportPur.toFixed(3)} kg (manual: ${manualPurKg.toFixed(3)})`);
  console.log(`Σ purRet (all rows): ${reportPurRet.toFixed(3)} kg (manual: ${manualPurRetKg.toFixed(3)})`);
  console.log(`Σ issued (all rows): ${reportIssued.toFixed(3)} kg (raw txn: ${issuedKg.toFixed(3)})`);
  console.log(`Σ returned (all rows): ${reportReturned.toFixed(3)} kg (raw txn: ${returnedKg.toFixed(3)})`);

  // Issue/return duplication check
  const issuedByYarn = new Map();
  for (const r of report.results) {
    // can't get yarnId from report row directly - check duplication via yarnName
    const key = `${r.yarnName}|${r.shadeNumber}|${r.brand}`;
    if (r.yarnIssueToKnitting > 0) {
      const yarnKey = r.yarnName;
      if (!issuedByYarn.has(yarnKey)) issuedByYarn.set(yarnKey, { rows: 0, issuedSum: 0, issuedVal: r.yarnIssueToKnitting });
      const entry = issuedByYarn.get(yarnKey);
      entry.rows += 1;
      entry.issuedSum += r.yarnIssueToKnitting;
    }
  }
  const dupedYarns = [...issuedByYarn.entries()].filter(([, v]) => v.rows > 1 && v.issuedVal > 0);
  if (dupedYarns.length) {
    console.log(`\n⚠ ISSUE DUPLICATION: ${dupedYarns.length} yarn(s) have issue amount on multiple rows`);
    dupedYarns.slice(0, 5).forEach(([name, v]) => {
      console.log(`  ${name}: ${v.rows} rows, Σ issued=${v.issuedSum.toFixed(2)} (per-row=${v.issuedVal.toFixed(2)}, expected once)`);
    });
  }

  if (report.meta?.closingVariances?.length) {
    console.log(`\nClosing variances: ${report.meta.closingVariances.length}`);
    report.meta.closingVariances.slice(0, 5).forEach((v) => {
      console.log(`  ${v.yarnName}: snapshot=${v.snapshotClosingKg} formula=${v.formulaClosingKg} var=${v.varianceKg}`);
    });
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
