#!/usr/bin/env node
/**
 * Yarn Inventory Report Script
 * Outputs: Long-term (boxes) stock, Short-term (cones) stock, and total inventory per yarn
 * Run: node src/scripts/report-yarn-inventory.js
 * Or: npm run report:yarn-inventory
 */

import mongoose from 'mongoose';
import { YarnBox, YarnCone, YarnCatalog } from '../models/index.js';
import { ST_SECTION_CODE, LT_SECTION_CODES } from '../models/storageManagement/storageSlot.model.js';
import config from '../config/config.js';

/** LT: legacy LT-* OR B7-02/03/04/05- (StorageSlot) */
const LT_REGEX = new RegExp(`^(LT-|${LT_SECTION_CODES.map((s) => `${s}-`).join('|')})`, 'i');
/** ST: legacy ST-* OR B7-01- (StorageSlot) */
const ST_REGEX = new RegExp(`^(ST-|${ST_SECTION_CODE}-)`, 'i');

const toNum = (v) => Math.max(0, Number(v ?? 0));

const run = async () => {
  try {
    await mongoose.connect(config.mongoose.url, config.mongoose.options);

    // LT: boxes only (LT-* or B7-02/03/04/05-*, stored, qc_approved)
    const ltBoxes = await YarnBox.find({
      storageLocation: { $regex: LT_REGEX },
      storedStatus: true,
      'qcData.status': 'qc_approved',
    })
      .lean();

    // ST: cones with storage (coneStorageId, not issued)
    const stCones = await YarnCone.find({
      coneStorageId: { $exists: true, $nin: [null, ''] },
      issueStatus: { $ne: 'issued' },
    })
      .lean();

    // Unopened boxes in ST (no cones from them yet)
    const boxIdsWithCones = new Set(stCones.map((c) => c.boxId).filter(Boolean));
    const stBoxes = await YarnBox.find({
      storageLocation: { $regex: ST_REGEX },
      storedStatus: true,
      'qcData.status': 'qc_approved',
      boxId: { $nin: Array.from(boxIdsWithCones) },
    })
      .lean();

    // Aggregate by yarnName (boxes) and yarn (cones)
    const byYarn = new Map();

    const addBox = (box, isLT) => {
      const key = (box.yarnName || '').trim() || '_unknown_';
      if (!byYarn.has(key)) {
        byYarn.set(key, {
          yarnName: key,
          yarnId: null,
          lt: { totalWeight: 0, netWeight: 0, boxCount: 0 },
          st: { totalWeight: 0, netWeight: 0, coneCount: 0 },
        });
      }
      const r = byYarn.get(key);
      const bucket = isLT ? r.lt : r.st;
      const tw = toNum(box.boxWeight);
      const tear = toNum(box.tearweight);
      bucket.totalWeight += tw;
      bucket.netWeight += Math.max(0, tw - tear);
      if (isLT) bucket.boxCount += 1;
    };

    for (const b of ltBoxes) {
      addBox(b, true);
    }
    for (const b of stBoxes) {
      addBox(b, false);
    }

    for (const c of stCones) {
      const yarnId = c.yarn?.toString?.() || c.yarn;
      const key = (c.yarnName || '').trim() || (yarnId || '_unknown_');
      if (!byYarn.has(key)) {
        byYarn.set(key, {
          yarnName: key,
          yarnId: yarnId || null,
          lt: { totalWeight: 0, netWeight: 0, boxCount: 0 },
          st: { totalWeight: 0, netWeight: 0, coneCount: 0 },
        });
      }
      const r = byYarn.get(key);
      if (yarnId && !r.yarnId) r.yarnId = yarnId;
      const tw = toNum(c.coneWeight);
      const tear = toNum(c.tearWeight);
      r.st.totalWeight += tw;
      r.st.netWeight += Math.max(0, tw - tear);
      r.st.coneCount += 1;
    }

    // Resolve yarn names from catalog where possible
    const catalogs = await YarnCatalog.find({ status: { $ne: 'deleted' } })
      .select('_id yarnName')
      .lean();
    const catalogByName = new Map(catalogs.map((c) => [c.yarnName?.trim(), c]));
    const catalogById = new Map(catalogs.map((c) => [c._id.toString(), c]));

    const rows = [];
    for (const [key, r] of byYarn.entries()) {
      const catalog = catalogByName.get(key) || catalogById.get(r.yarnId);
      const displayName = catalog?.yarnName || r.yarnName;
      const lt = r.lt;
      const st = r.st;
      const totalNet = lt.netWeight + st.netWeight;
      const totalWeight = lt.totalWeight + st.totalWeight;
      rows.push({
        yarnName: displayName,
        yarnId: r.yarnId || catalog?._id?.toString(),
        longTerm: {
          totalWeight: Math.round(lt.totalWeight * 1000) / 1000,
          netWeight: Math.round(lt.netWeight * 1000) / 1000,
          boxCount: lt.boxCount,
        },
        shortTerm: {
          totalWeight: Math.round(st.totalWeight * 1000) / 1000,
          netWeight: Math.round(st.netWeight * 1000) / 1000,
          coneCount: st.coneCount,
        },
        total: {
          totalWeight: Math.round(totalWeight * 1000) / 1000,
          netWeight: Math.round(totalNet * 1000) / 1000,
        },
      });
    }

    rows.sort((a, b) => (b.total.netWeight || 0) - (a.total.netWeight || 0));

    // Print report
    console.log('\n========== YARN INVENTORY REPORT ==========\n');
    console.log('Long-term = boxes in LT storage | Short-term = cones + unopened boxes in ST\n');

    const pad = (s, n) => String(s).padEnd(n);
    const padNum = (n, w = 12) => String(n).padStart(w);

    console.log(
      pad('Yarn Name', 55) +
        padNum('LT Boxes', 10) +
        padNum('LT Net(kg)', 12) +
        padNum('ST Cones', 10) +
        padNum('ST Net(kg)', 12) +
        padNum('Total Net(kg)', 14)
    );
    console.log('-'.repeat(115));

    let grandLtBoxes = 0;
    let grandLtNet = 0;
    let grandStCones = 0;
    let grandStNet = 0;
    let grandTotalNet = 0;

    for (const row of rows) {
      grandLtBoxes += row.longTerm.boxCount;
      grandLtNet += row.longTerm.netWeight;
      grandStCones += row.shortTerm.coneCount;
      grandStNet += row.shortTerm.netWeight;
      grandTotalNet += row.total.netWeight;

      const name = row.yarnName.length > 52 ? row.yarnName.slice(0, 49) + '...' : row.yarnName;
      console.log(
        pad(name, 55) +
          padNum(row.longTerm.boxCount, 10) +
          padNum(row.longTerm.netWeight.toFixed(2), 12) +
          padNum(row.shortTerm.coneCount, 10) +
          padNum(row.shortTerm.netWeight.toFixed(2), 12) +
          padNum(row.total.netWeight.toFixed(2), 14)
      );
    }

    console.log('-'.repeat(115));
    console.log(
      pad('TOTAL', 55) +
        padNum(grandLtBoxes, 10) +
        padNum(grandLtNet.toFixed(2), 12) +
        padNum(grandStCones, 10) +
        padNum(grandStNet.toFixed(2), 12) +
        padNum(grandTotalNet.toFixed(2), 14)
    );
    console.log('\n');

    // Summary
    console.log('--- SUMMARY ---');
    console.log(`Long-term (boxes): ${grandLtBoxes} boxes, ${grandLtNet.toFixed(2)} kg net`);
    console.log(`Short-term (cones): ${grandStCones} cones, ${grandStNet.toFixed(2)} kg net`);
    console.log(`Total inventory: ${grandTotalNet.toFixed(2)} kg net`);
    console.log(`Yarns with stock: ${rows.length}`);
    console.log('\n');
  } catch (err) {
    console.error('Error:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
