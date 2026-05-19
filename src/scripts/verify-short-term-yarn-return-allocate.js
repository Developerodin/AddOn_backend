#!/usr/bin/env node

/**
 * Verify cones from short-term-yarn-return-cones-to-allocate.csv exist in DB
 * with expected actual_weight and location_to_allocate.
 *
 * Usage:
 *   node src/scripts/verify-short-term-yarn-return-allocate.js
 *   node src/scripts/verify-short-term-yarn-return-allocate.js --csv=./reports/short-term-yarn-return-cones-to-allocate.csv
 */

import url from 'url';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import config from '../config/config.js';
import { YarnCone } from '../models/index.js';

const _origUrlParse = url.parse;
url.parse = function patchedParse(urlStr, ...args) {
  try {
    return _origUrlParse.call(this, urlStr, ...args);
  } catch {
    const firstHost = String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2');
    return _origUrlParse.call(this, firstHost, ...args);
  }
};

const WEIGHT_TOLERANCE = 0.011;

/**
 * @param {unknown} v
 * @returns {string}
 */
function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {string} fileContent
 */
function parseAllocateCsv(fileContent) {
  const lines = String(fileContent || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  const idx = (name) => headers.indexOf(name);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(',');
    rows.push({
      cone_barcode: String(parts[idx('cone_barcode')] ?? '').trim(),
      actual_weight: Number(parts[idx('actual_weight')]),
      location_to_allocate: String(parts[idx('location_to_allocate')] ?? '').trim(),
      current_issue_status: String(parts[idx('current_issue_status')] ?? '').trim().toLowerCase(),
    });
  }
  return rows;
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {boolean}
 */
function weightsMatch(a, b) {
  return Math.abs(Number(a) - Number(b)) <= WEIGHT_TOLERANCE;
}

/**
 * @param {string} rawUrl
 * @returns {string}
 */
function sanitizeMongoUrl(rawUrl) {
  let u = String(rawUrl || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim();
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  return u;
}

async function main() {
  const csvArg = process.argv.find((a) => a.startsWith('--csv='));
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const csvPath = csvArg
    ? path.resolve(process.cwd(), csvArg.slice(6))
    : path.resolve(process.cwd(), 'reports/short-term-yarn-return-cones-to-allocate.csv');
  const outPath = outArg
    ? path.resolve(process.cwd(), outArg.slice(6))
    : path.resolve(process.cwd(), 'reports/short-term-yarn-return-allocate-verify.csv');

  const raw = await fs.readFile(csvPath, 'utf-8');
  const rows = parseAllocateCsv(raw);

  const mongoUrl = sanitizeMongoUrl(config?.mongoose?.url || process.env.MONGODB_URL || '');
  if (!mongoUrl) throw new Error('MONGODB_URL missing');
  await mongoose.connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true });

  const dbName = mongoose.connection?.name || '(unknown)';
  const dbHost = (() => {
    try {
      const u = new URL(mongoUrl.replace(/^mongodb(\+srv)?:\/\//, 'https://'));
      return u.hostname || '(unknown host)';
    } catch {
      return '(parse failed)';
    }
  })();

  const barcodes = rows.map((r) => r.cone_barcode).filter(Boolean);
  const cones = await YarnCone.find({ barcode: { $in: barcodes } })
    .select('barcode coneWeight coneStorageId issueStatus returnStatus orderId articleId')
    .lean();
  const byBarcode = new Map(cones.map((c) => [String(c.barcode), c]));

  const verifyHeaders = [
    'cone_barcode',
    'verify_status',
    'issue',
    'expected_weight',
    'db_weight',
    'expected_location',
    'db_location',
    'db_issue_status',
    'csv_issue_status',
  ];

  /** @type {Record<string, number>} */
  const counts = { ok: 0, mismatch: 0, missing: 0 };
  /** @type {Record<string, number>} */
  const issueKindCounts = {};
  /** @type {string[]} */
  const sampleMismatchLines = [];
  const lines = [verifyHeaders.join(',')];

  for (const row of rows) {
    const cone = byBarcode.get(row.cone_barcode);
    const issues = [];

    if (!cone) {
      counts.missing += 1;
      lines.push(
        [
          row.cone_barcode,
          'missing',
          'Cone not found in database',
          row.actual_weight,
          '',
          row.location_to_allocate,
          '',
          '',
          row.current_issue_status,
        ]
          .map(csvEscape)
          .join(',')
      );
      continue;
    }

    const dbWeight = cone.coneWeight;
    const dbLoc = String(cone.coneStorageId || '').trim();
    const expLoc = String(row.location_to_allocate || '').trim();
    const expWeight = row.actual_weight;
    const isEmpty = expWeight < 0.01;

    if (!isEmpty && !weightsMatch(dbWeight, expWeight)) {
      issues.push(`weight: expected ${expWeight}, db ${dbWeight}`);
    }
    if (isEmpty) {
      if (cone.issueStatus !== 'used' && Number(dbWeight) > 0.01) {
        issues.push(`empty cone: expected used/0 weight, db issueStatus=${cone.issueStatus} weight=${dbWeight}`);
      }
    } else if (dbLoc.toUpperCase() !== expLoc.toUpperCase()) {
      issues.push(`location: expected ${expLoc}, db ${dbLoc || '(empty)'}`);
    }

    if (row.current_issue_status === 'issued' && cone.issueStatus === 'issued') {
      issues.push('still issued (expected returned → not_issued or used)');
    }

    if (issues.length) {
      counts.mismatch += 1;
      for (const iss of issues) {
        const kind = iss.split(':')[0].trim();
        issueKindCounts[kind] = (issueKindCounts[kind] || 0) + 1;
      }
      if (sampleMismatchLines.length < 5) {
        sampleMismatchLines.push(`${row.cone_barcode}: ${issues.join('; ')}`);
      }
      lines.push(
        [
          row.cone_barcode,
          'mismatch',
          issues.join('; '),
          expWeight,
          dbWeight,
          expLoc,
          dbLoc,
          cone.issueStatus,
          row.current_issue_status,
        ]
          .map(csvEscape)
          .join(',')
      );
    } else {
      counts.ok += 1;
      lines.push(
        [
          row.cone_barcode,
          'ok',
          '',
          expWeight,
          dbWeight,
          expLoc,
          dbLoc,
          cone.issueStatus,
          row.current_issue_status,
        ]
          .map(csvEscape)
          .join(',')
      );
    }
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${lines.join('\n')}\n`, 'utf-8');

  console.log('\n=== ST Yarn Return Allocate — DB Verification ===');
  console.log(`MongoDB:      ${dbHost} / db "${dbName}"`);
  console.log(`CSV:          ${csvPath}`);
  console.log(`CSV rows:     ${rows.length}`);
  console.log(`OK:           ${counts.ok}`);
  console.log(`Mismatch:     ${counts.mismatch}`);
  console.log(`Missing:      ${counts.missing}`);
  console.log(`Report:       ${outPath}`);

  if (counts.mismatch > 0) {
    console.log('\nMismatch breakdown (issue type → count):');
    for (const [kind, n] of Object.entries(issueKindCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${kind}: ${n}`);
    }
    console.log('\nSample mismatches:');
    for (const s of sampleMismatchLines) console.log(`  - ${s}`);
    if (counts.ok < rows.length * 0.5) {
      console.log(
        '\n⚠️  Most cones do not match — allocate script likely was NOT run against this database.'
      );
      console.log('   On this server run: npm run yarn:st-return-allocate');
      console.log('   Then re-run this verify script.');
    }
  }

  await mongoose.disconnect();
  if (counts.mismatch > 0 || counts.missing > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
