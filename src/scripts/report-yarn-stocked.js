#!/usr/bin/env node
/**
 * Yarn Stocked Report Script
 * Shows yarn_stocked transactions and why opening balance may be 0.
 * Run: node src/scripts/report-yarn-stocked.js
 * Or: npm run report:yarn-stocked
 *
 * yarn_stocked = created when YarnBox is stored in long-term storage (LT) with QC approved.
 * Opening = sum(yarn_stocked) - sum(yarn_issued) + sum(yarn_returned) for txns BEFORE report start.
 */

import mongoose from 'mongoose';
import { YarnTransaction, YarnCatalog } from '../models/index.js';
import config from '../config/config.js';

const REPORT_START = new Date(2026, 1, 28); // 2026-02-28 local

const run = async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  const pipeline = [
    { $match: {} },
    {
      $group: {
        _id: '$yarn',
        stocked: { $sum: { $cond: [{ $eq: ['$transactionType', 'yarn_stocked'] }, '$transactionNetWeight', 0] } },
        stockedCount: { $sum: { $cond: [{ $eq: ['$transactionType', 'yarn_stocked'] }, 1, 0] } },
        issued: { $sum: { $cond: [{ $eq: ['$transactionType', 'yarn_issued'] }, '$transactionNetWeight', 0] } },
        returned: { $sum: { $cond: [{ $eq: ['$transactionType', 'yarn_returned'] }, '$transactionNetWeight', 0] } },
        stockedBeforeReport: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$transactionType', 'yarn_stocked'] },
                  { $lt: ['$transactionDate', REPORT_START] },
                ],
              },
              '$transactionNetWeight',
              0,
            ],
          },
        },
        issuedBeforeReport: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$transactionType', 'yarn_issued'] },
                  { $lt: ['$transactionDate', REPORT_START] },
                ],
              },
              '$transactionNetWeight',
              0,
            ],
          },
        },
        returnedBeforeReport: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$transactionType', 'yarn_returned'] },
                  { $lt: ['$transactionDate', REPORT_START] },
                ],
              },
              '$transactionNetWeight',
              0,
            ],
          },
        },
      },
    },
    {
      $project: {
        yarnId: '$_id',
        stocked: 1,
        stockedCount: 1,
        issued: 1,
        returned: 1,
        stockedBeforeReport: 1,
        issuedBeforeReport: 1,
        returnedBeforeReport: 1,
        opening: {
          $subtract: [
            { $add: ['$stockedBeforeReport', '$returnedBeforeReport'] },
            '$issuedBeforeReport',
          ],
        },
      },
    },
    { $sort: { stocked: -1 } },
      { $limit: 50 },
  ];

  const result = await YarnTransaction.aggregate(pipeline);
  const yarnIds = result.map((r) => r.yarnId).filter(Boolean);
  const catalogs = await YarnCatalog.find({ _id: { $in: yarnIds } })
    .select('yarnName')
    .lean();
  const catalogMap = new Map(catalogs.map((c) => [c._id.toString(), c.yarnName]));

  console.log('\n=== YARN STOCKED REPORT ===');
  console.log(`Report start date (opening cutoff): ${REPORT_START.toISOString()}`);
  console.log('Opening = stockedBeforeReport - issuedBeforeReport + returnedBeforeReport\n');

  const totalStocked = result.reduce((s, r) => s + (r.stocked || 0), 0);
  const totalStockedBefore = result.reduce((s, r) => s + (r.stockedBeforeReport || 0), 0);
  const totalIssuedBefore = result.reduce((s, r) => s + (r.issuedBeforeReport || 0), 0);
  const totalReturnedBefore = result.reduce((s, r) => s + (r.returnedBeforeReport || 0), 0);

  console.log('--- TOTALS ---');
  console.log(`Total yarn_stocked (all time): ${totalStocked.toFixed(2)} kg`);
  console.log(`Total yarn_stocked BEFORE report start: ${totalStockedBefore.toFixed(2)} kg`);
  console.log(`Total yarn_issued BEFORE report start: ${totalIssuedBefore.toFixed(2)} kg`);
  console.log(`Total yarn_returned BEFORE report start: ${totalReturnedBefore.toFixed(2)} kg`);
  console.log(`Calculated opening (all yarns): ${(totalStockedBefore - totalIssuedBefore + totalReturnedBefore).toFixed(2)} kg\n`);

  console.log('--- TOP 30 YARNS BY STOCKED (all time) ---');
  console.log(
    'YarnName'.padEnd(55) +
      'Stocked'.padStart(10) +
      'Stocked#'.padStart(8) +
      'BeforeReport'.padStart(12) +
      'IssuedBef'.padStart(10) +
      'Opening'.padStart(10)
  );
  console.log('-'.repeat(105));

  for (const r of result.slice(0, 30)) {
    const name = (catalogMap.get(r.yarnId?.toString?.()) || r.yarnId || '?').slice(0, 54);
    const stocked = (r.stocked || 0).toFixed(2);
    const stockedBefore = (r.stockedBeforeReport || 0).toFixed(2);
    const issuedBefore = (r.issuedBeforeReport || 0).toFixed(2);
    const opening = (r.opening || 0).toFixed(2);
    console.log(
      name.padEnd(55) +
        stocked.padStart(10) +
        String(r.stockedCount || 0).padStart(8) +
        stockedBefore.padStart(12) +
        issuedBefore.padStart(10) +
        opening.padStart(10)
    );
  }

  console.log('\n--- YARNS WITH STOCKED BEFORE REPORT = 0 (but have issued) ---');
  const zeroStocked = result.filter(
    (r) => (r.stockedBeforeReport || 0) === 0 && (r.issuedBeforeReport || r.issued || 0) > 0
  );
  for (const r of zeroStocked.slice(0, 15)) {
    const name = catalogMap.get(r.yarnId?.toString?.()) || r.yarnId || '?';
    console.log(`  ${name}: issued=${(r.issued || 0).toFixed(2)} kg, stockedBefore=${(r.stockedBeforeReport || 0).toFixed(2)} -> opening=${(r.opening || 0).toFixed(2)}`);
  }

  console.log('\n--- YARN_STOCKED TRANSACTION SAMPLE (first 10) ---');
  const stockedTxns = await YarnTransaction.find({ transactionType: 'yarn_stocked' })
    .sort({ transactionDate: -1 })
    .limit(10)
    .populate('yarn', 'yarnName')
    .lean();
  for (const t of stockedTxns) {
    console.log(
      `  ${t.transactionDate?.toISOString?.()} | ${t.yarnName || t.yarn?.yarnName} | ${(t.transactionNetWeight || 0).toFixed(2)} kg | orderno: ${t.orderno || '-'}`
    );
  }

  await mongoose.disconnect();
  console.log('\nDone.');
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
