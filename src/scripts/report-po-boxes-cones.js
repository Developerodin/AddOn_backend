#!/usr/bin/env node
/**
 * Report all boxes and cones for a given PO number.
 * Run: node src/scripts/report-po-boxes-cones.js [PO_NUMBER]
 * Default PO: PO-2026-1070
 * Example: node src/scripts/report-po-boxes-cones.js PO-2026-1070
 */

import mongoose from 'mongoose';
import { YarnBox, YarnCone } from '../models/index.js';
import config from '../config/config.js';

const PO_NUMBER = process.argv[2] || 'PO-2026-1070';

const toNum = (v) => Math.max(0, Number(v ?? 0));

const run = async () => {
  try {
    await mongoose.connect(config.mongoose.url, config.mongoose.options);

    const boxes = await YarnBox.find({ poNumber: PO_NUMBER }).lean().sort({ boxId: 1 });
    const cones = await YarnCone.find({ poNumber: PO_NUMBER }).lean().sort({ boxId: 1, createdAt: 1 });

    console.log('\n' + '='.repeat(60));
    console.log(`PO: ${PO_NUMBER}`);
    console.log('='.repeat(60));

    // Boxes
    console.log('\n--- BOXES ---\n');
    if (boxes.length === 0) {
      console.log('  (none)');
    } else {
      let totalBoxWeight = 0;
      let totalBoxTear = 0;
      let totalBoxCones = 0;
      for (const b of boxes) {
        const w = toNum(b.boxWeight);
        const t = toNum(b.tearweight);
        const nc = toNum(b.numberOfCones);
        totalBoxWeight += w;
        totalBoxTear += t;
        totalBoxCones += nc;
        console.log(`  ${b.boxId}`);
        console.log(`    yarn: ${b.yarnName || '-'} | shade: ${b.shadeCode || '-'}`);
        console.log(`    weight: ${w} kg | tear: ${t} kg | net: ${Math.max(0, w - t)} kg`);
        console.log(`    cones: ${nc} | lot: ${b.lotNumber || '-'} | stored: ${b.storedStatus ? 'yes' : 'no'}`);
        console.log('');
      }
      console.log(`  Subtotal: ${boxes.length} boxes | weight: ${totalBoxWeight} kg | tear: ${totalBoxTear} kg | cones: ${totalBoxCones}`);
    }

    // Cones
    console.log('\n--- CONES ---\n');
    if (cones.length === 0) {
      console.log('  (none)');
    } else {
      let totalConeWeight = 0;
      let totalConeTear = 0;
      for (const c of cones) {
        const w = toNum(c.coneWeight);
        const t = toNum(c.tearWeight);
        totalConeWeight += w;
        totalConeTear += t;
        console.log(`  ${c.barcode || c._id} (box: ${c.boxId})`);
        console.log(`    yarn: ${c.yarnName || '-'} | shade: ${c.shadeCode || '-'}`);
        console.log(`    weight: ${w} kg | tear: ${t} kg | net: ${Math.max(0, w - t)} kg`);
        console.log(`    issue: ${c.issueStatus} | return: ${c.issueStatus === 'issued' ? c.returnStatus : '-'}`);
        console.log('');
      }
      console.log(`  Subtotal: ${cones.length} cones | weight: ${totalConeWeight} kg | tear: ${totalConeTear} kg`);
    }

    // Totals
    const totalBoxWeight = boxes.reduce((s, b) => s + toNum(b.boxWeight), 0);
    const totalBoxTear = boxes.reduce((s, b) => s + toNum(b.tearweight), 0);
    const totalConeWeight = cones.reduce((s, c) => s + toNum(c.coneWeight), 0);
    const totalConeTear = cones.reduce((s, c) => s + toNum(c.tearWeight), 0);

    console.log('\n' + '='.repeat(60));
    console.log('TOTALS');
    console.log('='.repeat(60));
    console.log(`  Boxes:  ${boxes.length}`);
    console.log(`  Cones:  ${cones.length}`);
    console.log(`  Box weight (gross):  ${totalBoxWeight} kg`);
    console.log(`  Box tear weight:     ${totalBoxTear} kg`);
    console.log(`  Cone weight (gross): ${totalConeWeight} kg`);
    console.log(`  Cone tear weight:    ${totalConeTear} kg`);
    console.log(`  Box net weight:      ${Math.max(0, totalBoxWeight - totalBoxTear)} kg`);
    console.log(`  Cone net weight:     ${Math.max(0, totalConeWeight - totalConeTear)} kg`);
    console.log('='.repeat(60) + '\n');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
};

run();
