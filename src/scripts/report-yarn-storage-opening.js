#!/usr/bin/env node
/**
 * Yarn Storage & Opening Balance Report
 *
 * Deep investigation: stored boxes, unstored boxes, cones - total yarn in stock.
 * This gives the TRUE opening balance per yarn (current physical stock).
 *
 * Run: node src/scripts/report-yarn-storage-opening.js
 * Or: npm run report:yarn-storage-opening
 *
 * Sources:
 * 1. Stored boxes: YarnBox in LT (storageLocation LT-* or B7-02/03/04/05-*), storedStatus=true, qc_approved
 * 2. Unstored boxes: YarnBox NOT in LT (received but not yet put in LT storage)
 * 3. Cones: YarnCone in ST (coneStorageId set, issueStatus != issued)
 */

import mongoose from 'mongoose';
import { YarnBox, YarnCone, YarnCatalog } from '../models/index.js';
import { LT_SECTION_CODES, ST_SECTION_CODE } from '../models/storageManagement/storageSlot.model.js';
import config from '../config/config.js';

const LT_REGEX = new RegExp(`^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`, 'i');
const ST_REGEX = new RegExp(`^(ST-|${ST_SECTION_CODE}-)`, 'i');

const toNum = (v) => Math.max(0, Number(v ?? 0));

const run = async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  // --- BOXES: Stored vs Unstored ---
  const allBoxes = await YarnBox.find({ boxWeight: { $gt: 0 } })
    .select('yarnName boxWeight tearweight storageLocation storedStatus qcData receivedDate createdAt boxId')
    .lean();

  const storedBoxes = allBoxes.filter(
    (b) =>
      b.storageLocation &&
      LT_REGEX.test(b.storageLocation) &&
      b.storedStatus === true &&
      b.qcData?.status === 'qc_approved'
  );
  const unstoredBoxes = allBoxes.filter(
    (b) =>
      !b.storageLocation ||
      !LT_REGEX.test(b.storageLocation) ||
      b.storedStatus !== true ||
      b.qcData?.status !== 'qc_approved'
  );

  // --- CONES: In ST storage (not issued) ---
  const conesInST = await YarnCone.find({
    coneStorageId: { $exists: true, $nin: [null, ''] },
    issueStatus: { $ne: 'issued' },
    $or: [{ coneWeight: { $gt: 0 } }, { coneWeight: { $exists: true } }],
  })
    .select('yarn yarnName coneWeight tearWeight')
    .lean();

  // --- Aggregate by yarnName (boxes) and yarn (cones) ---
  const byYarn = new Map();

  const addBox = (box, category) => {
    const key = (box.yarnName || '').trim() || '_unknown_';
    if (!byYarn.has(key)) {
      byYarn.set(key, {
        yarnName: key,
        yarnId: null,
        storedBoxes: { netKg: 0, count: 0 },
        unstoredBoxes: { netKg: 0, count: 0 },
        cones: { netKg: 0, count: 0 },
        totalNetKg: 0,
      });
    }
    const r = byYarn.get(key);
    const net = toNum(box.boxWeight) - toNum(box.tearweight);
    if (category === 'stored') {
      r.storedBoxes.netKg += net;
      r.storedBoxes.count += 1;
    } else {
      r.unstoredBoxes.netKg += net;
      r.unstoredBoxes.count += 1;
    }
  };

  for (const b of storedBoxes) {
    addBox(b, 'stored');
  }
  for (const b of unstoredBoxes) {
    addBox(b, 'unstored');
  }

  for (const c of conesInST) {
    const net = toNum(c.coneWeight) - toNum(c.tearWeight);
    const key = (c.yarnName || '').trim() || (c.yarnCatalogId ? c.yarnCatalogId.toString() : '_unknown_');
    if (!byYarn.has(key)) {
      byYarn.set(key, {
        yarnName: key,
        yarnId: c.yarnCatalogId?.toString?.(),
        storedBoxes: { netKg: 0, count: 0 },
        unstoredBoxes: { netKg: 0, count: 0 },
        cones: { netKg: 0, count: 0 },
        totalNetKg: 0,
      });
    }
    const r = byYarn.get(key);
    r.cones.netKg += net;
    r.cones.count += 1;
  }

  // Link yarnName to yarnId via YarnCatalog
  const catalogNames = await YarnCatalog.find({ status: { $ne: 'deleted' } })
    .select('yarnName')
    .lean();
  const nameToId = new Map();
  catalogNames.forEach((c) => {
    if (c.yarnName) nameToId.set(c.yarnName.trim().toLowerCase(), c._id.toString());
  });

  // Compute totals and sort
  for (const r of byYarn.values()) {
    r.totalNetKg =
      r.storedBoxes.netKg + r.unstoredBoxes.netKg + r.cones.netKg;
    r.yarnId = r.yarnId || nameToId.get(r.yarnName?.toLowerCase());
  }

  const rows = [...byYarn.values()].filter((r) => r.totalNetKg > 0).sort((a, b) => b.totalNetKg - a.totalNetKg);

  // --- OUTPUT ---
  console.log('\n========== YARN STORAGE & OPENING BALANCE REPORT ==========\n');
  console.log('Summary:');
  console.log(`  Stored boxes (LT, qc approved): ${storedBoxes.length} boxes`);
  console.log(`  Unstored boxes (received, not in LT): ${unstoredBoxes.length} boxes`);
  console.log(`  Cones in ST (not issued): ${conesInST.length} cones`);
  console.log(`  Unique yarns with stock: ${rows.length}`);
  console.log('');

  const totalStored = rows.reduce((s, r) => s + r.storedBoxes.netKg, 0);
  const totalUnstored = rows.reduce((s, r) => s + r.unstoredBoxes.netKg, 0);
  const totalCones = rows.reduce((s, r) => s + r.cones.netKg, 0);
  console.log('Totals (kg):');
  console.log(`  From stored boxes: ${totalStored.toFixed(2)}`);
  console.log(`  From unstored boxes: ${totalUnstored.toFixed(2)}`);
  console.log(`  From cones: ${totalCones.toFixed(2)}`);
  console.log(`  TOTAL OPENING: ${(totalStored + totalUnstored + totalCones).toFixed(2)} kg`);
  console.log('');

  console.log('--- Per-yarn breakdown (top 40 by total kg) ---');
  console.log(
    'YarnName'.padEnd(55) +
      'StoredBox'.padStart(12) +
      'Unstored'.padStart(12) +
      'Cones'.padStart(12) +
      'TOTAL'.padStart(12)
  );
  console.log('-'.repeat(103));

  for (const r of rows.slice(0, 40)) {
    const name = (r.yarnName || '?').slice(0, 54);
    const stored = r.storedBoxes.netKg.toFixed(2).padStart(12);
    const unstored = r.unstoredBoxes.netKg.toFixed(2).padStart(12);
    const cones = r.cones.netKg.toFixed(2).padStart(12);
    const total = r.totalNetKg.toFixed(2).padStart(12);
    console.log(name.padEnd(55) + stored + unstored + cones + total);
  }

  console.log('\n--- Yarns with UNSTORED boxes (received but not in LT) ---');
  const withUnstored = rows.filter((r) => r.unstoredBoxes.netKg > 0);
  for (const r of withUnstored.slice(0, 20)) {
    console.log(
      `  ${r.yarnName}: ${r.unstoredBoxes.netKg.toFixed(2)} kg (${r.unstoredBoxes.count} boxes)`
    );
  }

  console.log('\n--- Sample unstored box details ---');
  for (const b of unstoredBoxes.slice(0, 5)) {
    const net = toNum(b.boxWeight) - toNum(b.tearweight);
    console.log(
      `  ${b.boxId} | ${b.yarnName} | net=${net.toFixed(2)} kg | storage=${b.storageLocation || 'null'} | stored=${b.storedStatus} | qc=${b.qcData?.status || 'null'}`
    );
  }

  await mongoose.disconnect();
  console.log('\nDone.');
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
