#!/usr/bin/env node

/**
 * Debug a specific yarn report row - trace opening, balance, and all field values.
 * Usage: node src/scripts/debug-yarn-report-row.js "20/70-Royal Blue-Marlin-Nylon/Spandex"
 * Or with date range: node src/scripts/debug-yarn-report-row.js "20/70-Royal Blue-Marlin-Nylon/Spandex" 2026-02-28 2026-03-19
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import {
  YarnCatalog,
  YarnBox,
  YarnCone,
  YarnTransaction,
} from '../models/index.js';

const yarnName = process.argv[2] || '20/70-Royal Blue-Marlin-Nylon/Spandex';
const startStr = process.argv[3] || '2026-02-28';
const endStr = process.argv[4] || '2026-03-19';

const parseDate = (str) => {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const start = parseDate(startStr);
const end = parseDate(endStr);
start.setHours(0, 0, 0, 0);
end.setHours(23, 59, 59, 999);

const toNum = (v) => Number(v ?? 0);

async function run() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  const catalog = await YarnCatalog.findOne({
    yarnName: { $regex: new RegExp(`^${yarnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    status: { $ne: 'deleted' },
  }).lean();

  if (!catalog) {
    console.log(`Yarn not found: ${yarnName}`);
    process.exit(1);
  }

  const yarnId = catalog._id.toString();
  const yarnNameNorm = (catalog.yarnName || '').trim().toLowerCase();

  console.log('\n=== YARN CATALOG ===');
  console.log('yarnId:', yarnId);
  console.log('yarnName:', catalog.yarnName);

  // 1. Physical (boxes + cones) - for opening
  const boxes = await YarnBox.find({ boxWeight: { $gt: 0 } })
    .select('boxId yarnName boxWeight tearweight storageLocation storedStatus')
    .lean();

  const matchingBoxes = boxes.filter(
    (b) => (b.yarnName || '').trim().toLowerCase() === yarnNameNorm
  );

  let boxTotal = 0;
  console.log('\n=== YARNBOX (physical) ===');
  for (const b of matchingBoxes) {
    const net = Math.max(0, toNum(b.boxWeight) - toNum(b.tearweight));
    boxTotal += net;
    console.log(`  ${b.boxId}: boxWeight=${b.boxWeight}, tearweight=${b.tearweight}, net=${net.toFixed(3)}`);
  }
  console.log(`  Box total net: ${boxTotal.toFixed(3)} kg`);

  const cones = await YarnCone.find({
    yarn: catalog._id,
    coneStorageId: { $exists: true, $nin: [null, ''] },
    issueStatus: { $ne: 'issued' },
  })
    .select('barcode coneWeight tearWeight coneStorageId')
    .lean();

  let coneTotal = 0;
  console.log('\n=== YARNCONE (physical, in ST, not issued) ===');
  for (const c of cones) {
    const net = Math.max(0, toNum(c.coneWeight) - toNum(c.tearWeight));
    coneTotal += net;
    console.log(`  ${c.barcode}: coneWeight=${c.coneWeight}, tearWeight=${c.tearWeight}, net=${net.toFixed(3)}`);
  }
  console.log(`  Cone total net: ${coneTotal.toFixed(3)} kg`);

  const openingPhysical = boxTotal + coneTotal;
  console.log('\n=== OPENING (physical) ===');
  console.log(`  opening = boxTotal + coneTotal = ${boxTotal.toFixed(3)} + ${coneTotal.toFixed(3)} = ${openingPhysical.toFixed(3)} kg`);

  // 2. YarnTransaction in date range - store, issued, returned
  const txns = await YarnTransaction.find({
    yarn: catalog._id,
    transactionDate: { $gte: start, $lte: end },
  })
    .sort({ transactionDate: 1 })
    .lean();

  let store = 0;
  let issued = 0;
  let returned = 0;

  console.log('\n=== YARNTRANSACTION (in period)', startStr, 'to', endStr, '===');
  for (const t of txns) {
    const w = toNum(t.transactionNetWeight);
    console.log(`  ${t.transactionType}: ${w.toFixed(3)} kg, date=${t.transactionDate}, orderno=${t.orderno || '-'}`);
    if (t.transactionType === 'yarn_stocked') store += w;
    else if (t.transactionType === 'yarn_issued') issued += w;
    else if (t.transactionType === 'yarn_returned') returned += w;
  }

  console.log('\n=== PERIOD TOTALS ===');
  console.log(`  store (yarn_stocked): ${store.toFixed(3)} kg`);
  console.log(`  issued (yarn_issued): ${issued.toFixed(3)} kg`);
  console.log(`  returned (yarn_returned): ${returned.toFixed(3)} kg`);

  const pur = 0;
  const purRet = 0;
  const balance = openingPhysical + pur - purRet + store + returned - issued;

  console.log('\n=== BALANCE CALCULATION ===');
  console.log(`  balance = opening + pur - purRet + store + returned - issued`);
  console.log(`  balance = ${openingPhysical.toFixed(3)} + ${pur} - ${purRet} + ${store.toFixed(3)} + ${returned.toFixed(3)} - ${issued.toFixed(3)}`);
  console.log(`  balance = ${balance.toFixed(3)} kg`);

  const rate = 458;
  const gstPercent = 5;
  const amount = rate * balance * (1 + gstPercent / 100);

  console.log('\n=== REPORT ROW VALUES ===');
  console.log('  opening:', Math.round(openingPhysical * 1000) / 1000);
  console.log('  pur:', pur);
  console.log('  purRet:', purRet);
  console.log('  yarnIssueToKnitting:', Math.round(issued * 1000) / 1000);
  console.log('  yarnReturnedFromKnitting:', Math.round(returned * 1000) / 1000);
  console.log('  balance:', Math.round(balance * 1000) / 1000);
  console.log('  rate:', rate);
  console.log('  gstPercent:', gstPercent);
  console.log('  amount:', Math.round(amount * 100) / 100, `(= ${rate} * ${balance.toFixed(3)} * 1.05)`);

  await mongoose.disconnect();
  console.log('\nDone.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
