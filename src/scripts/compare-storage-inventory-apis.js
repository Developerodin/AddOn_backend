#!/usr/bin/env node
/**
 * Compare Storage Slots API vs Yarn Inventory API
 * Calls both APIs and reports data consistency.
 * Run: node src/scripts/compare-storage-inventory-apis.js
 * Or: npm run report:storage-inventory
 * Requires: Server running on localhost:8000 (or set BASE_URL env)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} => ${res.status} ${res.statusText}`);
  return res.json();
};

const round3 = (n) => Math.round((n || 0) * 1000) / 1000;

const run = async () => {
  console.log('\n========== STORAGE vs INVENTORY API COMPARISON REPORT ==========\n');
  console.log(`Base URL: ${BASE_URL}\n`);

  let storageLT, storageST, inventory;
  try {
    [storageLT, storageST, inventory] = await Promise.all([
      fetchJson(`${BASE_URL}/v1/storage/slots/with-contents?zone=LT`),
      fetchJson(`${BASE_URL}/v1/storage/slots/with-contents?zone=ST`),
      fetchJson(`${BASE_URL}/v1/yarn-management/yarn-inventories`),
    ]);
  } catch (err) {
    console.error('ERROR: Failed to fetch APIs. Is the server running?');
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  // --- Aggregate from STORAGE API (use raw boxes/cones for accurate NET weight) ---
  const storageByYarn = new Map();

  const addBox = (box, isLT) => {
    const key = (box.yarnName || 'Unknown').trim();
    if (!storageByYarn.has(key)) {
      storageByYarn.set(key, { yarnName: key, ltKg: 0, stKg: 0, ltBoxes: 0, stCones: 0 });
    }
    const r = storageByYarn.get(key);
    const netKg = Math.max(0, (box.boxWeight || 0) - (box.tearweight || 0));
    if (isLT) {
      r.ltKg += netKg;
      r.ltBoxes += 1;
    } else {
      r.stKg += netKg;
    }
  };

  const addCone = (cone) => {
    const key = (cone.yarnName || 'Unknown').trim();
    if (!storageByYarn.has(key)) {
      storageByYarn.set(key, { yarnName: key, ltKg: 0, stKg: 0, ltBoxes: 0, stCones: 0 });
    }
    const r = storageByYarn.get(key);
    r.stKg += Math.max(0, (cone.coneWeight || 0) - (cone.tearWeight || 0));
    r.stCones += 1;
  };

  for (const slot of storageLT.results || []) {
    for (const box of slot.boxes || []) addBox(box, true);
  }
  for (const slot of storageST.results || []) {
    for (const box of slot.boxes || []) addBox(box, false);
    for (const cone of slot.cones || []) addCone(cone);
  }

  // Round storage totals
  for (const r of storageByYarn.values()) {
    r.ltKg = round3(r.ltKg);
    r.stKg = round3(r.stKg);
  }

  // --- Get INVENTORY API summary ---
  const invSummary = inventory.summary || {};
  const invYarnWise = (invSummary.yarnWise || []).reduce((acc, y) => {
    acc[y.yarnName] = {
      longTermKg: round3(y.longTermKg),
      shortTermKg: round3(y.shortTermKg),
      totalKg: round3(y.totalKg),
      shortTermCones: y.shortTermCones ?? 0,
    };
    return acc;
  }, {});

  // --- Compare ---
  const allYarns = new Set([...storageByYarn.keys(), ...Object.keys(invYarnWise)]);
  const issues = [];
  const matches = [];
  const onlyInStorage = [];
  const onlyInInventory = [];

  for (const yarnName of allYarns) {
    const storage = storageByYarn.get(yarnName);
    const inv = invYarnWise[yarnName];

    if (!storage && inv) {
      onlyInInventory.push({ yarnName, inv });
      continue;
    }
    if (storage && !inv) {
      onlyInStorage.push({ yarnName, storage });
      continue;
    }

    const ltDiff = round3((storage.ltKg || 0) - (inv.longTermKg || 0));
    const stDiff = round3((storage.stKg || 0) - (inv.shortTermKg || 0));
    const match = Math.abs(ltDiff) < 0.01 && Math.abs(stDiff) < 0.01;

    if (match) {
      matches.push({ yarnName, ltKg: storage.ltKg, stKg: storage.stKg });
    } else {
      issues.push({
        yarnName,
        storage: { ltKg: storage.ltKg, stKg: storage.stKg },
        inventory: { ltKg: inv.longTermKg, stKg: inv.shortTermKg },
        diff: { ltDiff, stDiff },
      });
    }
  }

  // --- Totals ---
  let storageLtTotal = 0;
  let storageStTotal = 0;
  for (const r of storageByYarn.values()) {
    storageLtTotal += r.ltKg;
    storageStTotal += r.stKg;
  }
  storageLtTotal = round3(storageLtTotal);
  storageStTotal = round3(storageStTotal);

  const invLtTotal = round3(invSummary.totalLongTermKg ?? 0);
  const invStTotal = round3(invSummary.totalShortTermKg ?? 0);

  // --- Print Report ---
  console.log('--- 1. STORAGE API TOTALS (from slots/with-contents) ---');
  console.log(`  LT zone: ${storageLT.totalResults ?? 0} slots, ${storageLT.results?.reduce((s, r) => s + (r.boxCount || 0), 0) ?? 0} boxes`);
  console.log(`  ST zone: ${storageST.totalResults ?? 0} slots, ${storageST.results?.reduce((s, r) => s + (r.coneCount || 0), 0) ?? 0} cones`);
  console.log(`  LT total net (kg): ${storageLtTotal}`);
  console.log(`  ST total net (kg): ${storageStTotal}`);
  console.log(`  Grand total (kg):  ${round3(storageLtTotal + storageStTotal)}`);
  console.log('');

  console.log('--- 2. INVENTORY API TOTALS ---');
  console.log(`  Yarn records: ${inventory.totalResults ?? inventory.results?.length ?? 0}`);
  console.log(`  LT total (kg): ${invLtTotal}`);
  console.log(`  ST total (kg): ${invStTotal}`);
  console.log(`  Grand total (kg): ${round3(invSummary.totalKg ?? 0)}`);
  console.log('');

  console.log('--- 3. TOTALS COMPARISON ---');
  const ltTotalDiff = round3(storageLtTotal - invLtTotal);
  const stTotalDiff = round3(storageStTotal - invStTotal);
  const totalsMatch = Math.abs(ltTotalDiff) < 0.01 && Math.abs(stTotalDiff) < 0.01;
  if (totalsMatch) {
    console.log('  ✓ Totals MATCH');
  } else {
    console.log('  ✗ Totals MISMATCH:');
    console.log(`    LT diff: ${ltTotalDiff} kg (Storage - Inventory)`);
    console.log(`    ST diff: ${stTotalDiff} kg (Storage - Inventory)`);
  }
  console.log('');

  console.log('--- 4. YARN-WISE COMPARISON ---');
  console.log(`  Matching yarns: ${matches.length}`);
  console.log(`  Mismatched yarns: ${issues.length}`);
  console.log(`  Only in Storage (no Inventory record): ${onlyInStorage.length}`);
  console.log(`  Only in Inventory (no boxes/cones in slots): ${onlyInInventory.length}`);
  console.log('');

  if (issues.length > 0) {
    console.log('--- 5. MISMATCHED YARNS (DETAIL) ---');
    for (const i of issues) {
      console.log(`  [${i.yarnName}]`);
      console.log(`    Storage:  LT=${i.storage.ltKg} kg, ST=${i.storage.stKg} kg`);
      console.log(`    Inventory: LT=${i.inventory.ltKg} kg, ST=${i.inventory.stKg} kg`);
      console.log(`    Diff:     LT=${i.diff.ltDiff} kg, ST=${i.diff.stDiff} kg`);
    }
    console.log('');
  }

  if (onlyInStorage.length > 0) {
    console.log('--- 6. YARNS IN STORAGE BUT NOT IN INVENTORY ---');
    for (const i of onlyInStorage) {
      console.log(`  ${i.yarnName}: LT=${i.storage.ltKg} kg, ST=${i.storage.stKg} kg`);
    }
    console.log('');
  }

  if (onlyInInventory.length > 0) {
    console.log('--- 7. YARNS IN INVENTORY BUT NOT IN STORAGE ---');
    for (const i of onlyInInventory) {
      console.log(`  ${i.yarnName}: LT=${i.inv.longTermKg} kg, ST=${i.inv.shortTermKg} kg`);
    }
    console.log('');
  }

  // --- Root cause analysis ---
  console.log('--- 8. ROOT CAUSES & FIXES ---');
  if (issues.length > 0 || onlyInStorage.length > 0 || onlyInInventory.length > 0) {
    if (onlyInStorage.length > 0) {
      console.log('  ISSUE B (PRIMARY): Inventory only includes yarns with YarnInventory record');
      console.log(`    -> ${onlyInStorage.length} yarn(s) have stock in slots but no YarnInventory.`);
      console.log('    -> Fix: Create YarnInventory when boxes are stocked, or compute from storage.');
      console.log('');
    }
    if (issues.length > 0) {
      console.log('  ISSUE: Yarn-wise LT/ST mismatch (see section 5 above)');
      console.log('    -> Check qcData.status (Inventory requires qc_approved, Storage does not).');
      console.log('');
    }
    if (onlyInInventory.length > 0) {
      console.log('  NOTE: Yarns with YarnInventory but no stock = depleted/zero stock (expected).');
      console.log('');
    }
  } else {
    console.log('  All data matches.');
  }
  console.log('');
  console.log('========== END REPORT ==========\n');
};

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
