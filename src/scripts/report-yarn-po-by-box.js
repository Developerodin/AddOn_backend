#!/usr/bin/env node
/**
 * Prints YarnBox rows and YarnCone rows for a PO, grouped by `boxId`
 * (box summary + cones nested under each box).
 *
 * Run from `AddOn_backend` with `.env` (same as other yarn scripts):
 *   node src/scripts/report-yarn-po-by-box.js po-2026-1187
 *   node src/scripts/report-yarn-po-by-box.js --po=PO-2026-1187
 *   node src/scripts/report-yarn-po-by-box.js PO-2026-1187 --json
 *   node src/scripts/report-yarn-po-by-box.js PO-2026-1187 --json --out=reports/po-1187.json
 *
 * Flags:
 *   --active-only     Exclude boxes/cones with returnedToVendorAt set
 *   --json            Emit structured JSON (default: human-readable text)
 *   --out=PATH        With --json, write to file instead of stdout
 */

import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { YarnBox, YarnCone } from '../models/index.js';
import config from '../config/config.js';

const DEFAULT_PO = 'po-2026-1187';

/**
 * Escapes a string for safe use inside a RegExp source.
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses CLI args: positional PO, `--po=`, flags.
 * @returns {{ po: string; json: boolean; activeOnly: boolean; outPath: string | null }}
 */
function parseCli() {
  const argv = process.argv.slice(2);
  let po = DEFAULT_PO;
  let json = false;
  let activeOnly = false;
  let outPath = /** @type {string | null} */ (null);

  for (const a of argv) {
    if (a === '--json') json = true;
    else if (a === '--active-only') activeOnly = true;
    else if (a.startsWith('--po=')) po = a.slice(5).trim() || DEFAULT_PO;
    else if (a.startsWith('--out=')) outPath = a.slice(6).trim() || null;
    else if (!a.startsWith('--')) po = a.trim() || DEFAULT_PO;
  }

  return { po, json, activeOnly, outPath };
}

/**
 * @param {number | null | undefined} v
 * @returns {number}
 */
function toNum(v) {
  return Math.max(0, Number(v ?? 0));
}

/**
 * Builds Mongo match for PO string (case-insensitive exact match).
 * @param {string} po
 * @returns {{ poNumber: RegExp }}
 */
function poMatch(po) {
  const trimmed = String(po).trim();
  return { poNumber: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') };
}

/**
 * @param {import('mongoose').LeanDocument<any>} box
 * @returns {Record<string, unknown>}
 */
function slimBox(box) {
  return {
    boxId: box.boxId,
    poNumber: box.poNumber,
    yarnName: box.yarnName ?? null,
    shadeCode: box.shadeCode ?? null,
    lotNumber: box.lotNumber ?? null,
    barcode: box.barcode ?? null,
    boxWeight: box.boxWeight ?? null,
    initialBoxWeight: box.initialBoxWeight ?? null,
    grossWeight: box.grossWeight ?? null,
    tearweight: box.tearweight ?? null,
    numberOfCones: box.numberOfCones ?? null,
    storedStatus: box.storedStatus ?? null,
    storageLocation: box.storageLocation ?? null,
    returnedToVendorAt: box.returnedToVendorAt ?? null,
    qcStatus: box.qcData?.status ?? null,
    createdAt: box.createdAt ?? null,
    updatedAt: box.updatedAt ?? null,
  };
}

/**
 * @param {import('mongoose').LeanDocument<any>} cone
 * @returns {Record<string, unknown>}
 */
function slimCone(cone) {
  return {
    _id: cone._id?.toString?.() ?? cone._id,
    barcode: cone.barcode ?? null,
    boxId: cone.boxId,
    poNumber: cone.poNumber,
    yarnName: cone.yarnName ?? null,
    shadeCode: cone.shadeCode ?? null,
    coneWeight: cone.coneWeight ?? null,
    tearWeight: cone.tearWeight ?? null,
    issueStatus: cone.issueStatus ?? null,
    returnStatus: cone.returnStatus ?? null,
    coneStorageId: cone.coneStorageId ?? null,
    issueDate: cone.issueDate ?? null,
    returnedToVendorAt: cone.returnedToVendorAt ?? null,
    createdAt: cone.createdAt ?? null,
    updatedAt: cone.updatedAt ?? null,
  };
}

/**
 * @param {object} payload
 * @returns {Promise<void>}
 */
async function maybeWriteJson(payload, outPath) {
  const text = JSON.stringify(payload, null, 2) + '\n';
  if (!outPath) {
    process.stdout.write(text);
    return;
  }
  const abs = path.isAbsolute(outPath) ? outPath : path.resolve(process.cwd(), outPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text, 'utf8');
  console.error(`Wrote ${abs}`);
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const { po, json, activeOnly, outPath } = parseCli();
  const match = poMatch(po);
  const vendorFilter = activeOnly ? { returnedToVendorAt: null } : {};

  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  try {
    const [boxes, cones] = await Promise.all([
      YarnBox.find({ ...match, ...vendorFilter }).lean().sort({ boxId: 1 }),
      YarnCone.find({ ...match, ...vendorFilter }).lean().sort({ boxId: 1, createdAt: 1 }),
    ]);

    /** @type {Map<string, typeof cones>} */
    const conesByBox = new Map();
    for (const c of cones) {
      const bid = String(c.boxId ?? '').trim() || '__no_box_id__';
      if (!conesByBox.has(bid)) conesByBox.set(bid, []);
      conesByBox.get(bid).push(c);
    }

    const boxIdSet = new Set([
      ...boxes.map((b) => String(b.boxId)),
      ...conesByBox.keys(),
    ]);
    const sortedBoxIds = [...boxIdSet].filter((id) => id !== '__no_box_id__').sort((a, b) => a.localeCompare(b));
    if (conesByBox.has('__no_box_id__')) sortedBoxIds.push('__no_box_id__');

    const distinctPoStrings = [...new Set([...boxes.map((b) => b.poNumber), ...cones.map((c) => c.poNumber)])];

    const grouped = sortedBoxIds.map((boxId) => {
      const boxDoc =
        boxId === '__no_box_id__'
          ? null
          : boxes.find((b) => String(b.boxId) === boxId) ?? null;
      const boxCones = conesByBox.get(boxId) ?? [];
      return {
        boxId: boxId === '__no_box_id__' ? null : boxId,
        box: boxDoc ? slimBox(boxDoc) : null,
        cones: boxCones.map(slimCone),
      };
    });

    const payload = {
      query: { poInput: po, caseInsensitive: true, activeOnly },
      generatedAt: new Date().toISOString(),
      distinctPoStringsInRows: distinctPoStrings,
      summary: {
        yarnBoxDocuments: boxes.length,
        yarnConeDocuments: cones.length,
        distinctBoxIds: sortedBoxIds.filter((id) => id !== '__no_box_id__').length,
        conesMissingBoxId: (conesByBox.get('__no_box_id__') ?? []).length,
      },
      byBox: grouped,
    };

    if (json) {
      await maybeWriteJson(payload, outPath);
      return;
    }

    console.log('\n' + '='.repeat(72));
    console.log(`PO query: ${po} (case-insensitive)`);
    console.log(`Distinct poNumber values in matched rows: ${distinctPoStrings.join(', ') || '(none)'}`);
    if (activeOnly) console.log('Filter: active only (returnedToVendorAt is null)');
    console.log('='.repeat(72));

    for (const g of grouped) {
      const label = g.boxId ?? '(cone rows missing boxId)';
      console.log(`\n--- Box: ${label} ---`);
      if (g.box) {
        const b = g.box;
        console.log(
          `  YarnBox: ${b.yarnName ?? '-'} | shade: ${b.shadeCode ?? '-'} | lot: ${b.lotNumber ?? '-'}`
        );
        console.log(
          `  weight: ${toNum(b.boxWeight)} kg | tear: ${toNum(b.tearweight)} kg | net: ${Math.max(
            0,
            toNum(b.boxWeight) - toNum(b.tearweight)
          )} kg`
        );
        console.log(
          `  declared cones on box: ${b.numberOfCones ?? '-'} | stored: ${b.storedStatus ? 'yes' : 'no'} | LT/ST loc: ${b.storageLocation ?? '-'}`
        );
        if (b.returnedToVendorAt) console.log(`  returnedToVendorAt: ${b.returnedToVendorAt}`);
      } else {
        console.log('  (no YarnBox document for this boxId — cones only)');
      }

      const list = g.cones;
      console.log(`  Cones (${list.length}):`);
      if (list.length === 0) {
        console.log('    (none)');
        continue;
      }
      for (const c of list) {
        const w = toNum(c.coneWeight);
        const t = toNum(c.tearWeight);
        console.log(`    ${c.barcode ?? c._id}`);
        console.log(
          `      yarn: ${c.yarnName ?? '-'} | shade: ${c.shadeCode ?? '-'} | wt: ${w} kg | tear: ${t} kg | net: ${Math.max(0, w - t)} kg`
        );
        console.log(
          `      issue: ${c.issueStatus ?? '-'} | storageId: ${c.coneStorageId ?? '-'}${c.returnedToVendorAt ? ` | returnedToVendorAt: ${c.returnedToVendorAt}` : ''}`
        );
      }
    }

    console.log('\n' + '='.repeat(72));
    console.log('SUMMARY');
    console.log('='.repeat(72));
    console.log(`  YarnBox docs:  ${payload.summary.yarnBoxDocuments}`);
    console.log(`  YarnCone docs: ${payload.summary.yarnConeDocuments}`);
    console.log(`  Distinct boxIds: ${payload.summary.distinctBoxIds}`);
    console.log('='.repeat(72) + '\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error:', msg);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
