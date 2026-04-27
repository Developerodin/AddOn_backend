#!/usr/bin/env node

/**
 * Extract inputBarcode values from bulk cone return report that are NOT valid Mongo ObjectIds (24 hex).
 * Optionally, if a value is a valid ObjectId, also verify if it exists as a YarnCone _id.
 *
 * Usage:
 *   node src/scripts/extract-invalid-cone-ids-from-bulk-return-report.js \
 *     --in=./bulk-cone-return-report.csv \
 *     --out=./bulk-cone-return-invalid-ids.csv
 *
 * Optional:
 *   --also-check-db=true   # for 24-hex values: check YarnCone.findById exists, else mark as missing
 *   --mongo-url=mongodb://...
 *
 * Output columns:
 *   inputBarcode,isValidObjectId,coneExistsAsId,reason,count
 */

import fs from 'fs';
import path from 'path';
import url from 'url';

/** @type {boolean} */
const ALSO_CHECK_DB = String(process.argv.find((a) => a.startsWith('--also-check-db='))?.split('=')[1] || 'false') === 'true';

/**
 * @param {string} arg
 * @returns {string | null}
 */
function getArg(arg) {
  const raw = process.argv.find((a) => a.startsWith(`${arg}=`));
  if (!raw) return null;
  const v = raw.slice(arg.length + 1).trim();
  return v ? v : null;
}

/**
 * Minimal CSV parsing for this report format:
 * - first column is `inputBarcode`
 * - values appear unquoted (based on generated report)
 * We still handle quoted first field safely.
 *
 * @param {string} line
 * @returns {string}
 */
function parseFirstCsvField(line) {
  const s = String(line || '');
  if (!s) return '';
  if (s[0] !== '"') {
    const idx = s.indexOf(',');
    return (idx === -1 ? s : s.slice(0, idx)).trim();
  }
  // quoted first field
  let i = 1;
  let out = '';
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      if (s[i + 1] === '"') {
        out += '"';
        i += 2;
        continue;
      }
      break;
    }
    out += ch;
    i += 1;
  }
  return out.trim();
}

/**
 * Escape CSV cell value.
 * @param {unknown} v
 * @returns {string}
 */
function csvCell(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {string} v
 * @returns {boolean}
 */
function isValidObjectIdString(v) {
  const s = String(v || '').trim();
  return /^[a-fA-F0-9]{24}$/.test(s);
}

/**
 * @param {string} p
 * @returns {string}
 */
function resolvePathRelativeToCwd(p) {
  if (!p) return '';
  if (path.isAbsolute(p)) return p;
  return path.resolve(process.cwd(), p);
}

async function main() {
  const inPathArg = getArg('--in') || './bulk-cone-return-report.csv';
  const outPathArg = getArg('--out') || './bulk-cone-return-invalid-ids.csv';

  const inPath = resolvePathRelativeToCwd(inPathArg);
  const outPath = resolvePathRelativeToCwd(outPathArg);

  if (!fs.existsSync(inPath)) {
    throw new Error(`Input file not found: ${inPath}`);
  }

  const raw = fs.readFileSync(inPath, 'utf8');
  const lines = raw.split(/\n/).map((l) => l.replace(/\r$/, ''));
  if (lines.length <= 1) {
    throw new Error('CSV seems empty (no data rows).');
  }

  // Collect barcodes + counts
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (let idx = 1; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (!line || !line.trim()) continue;
    const inputBarcode = parseFirstCsvField(line);
    if (!inputBarcode) continue;
    counts.set(inputBarcode, (counts.get(inputBarcode) || 0) + 1);
  }

  /** @type {Array<{ inputBarcode: string, isValidObjectId: boolean, coneExistsAsId: 'yes'|'no'|'not_checked', reason: string, count: number }>} */
  const rows = [];

  for (const [inputBarcode, count] of counts.entries()) {
    const valid = isValidObjectIdString(inputBarcode);
    if (!valid) {
      rows.push({
        inputBarcode,
        isValidObjectId: false,
        coneExistsAsId: 'not_checked',
        reason: 'not_a_valid_objectid_24hex',
        count,
      });
    } else {
      rows.push({
        inputBarcode,
        isValidObjectId: true,
        coneExistsAsId: 'not_checked',
        reason: ALSO_CHECK_DB ? 'will_check_db' : 'valid_objectid',
        count,
      });
    }
  }

  // Optional DB check for valid ObjectId strings.
  if (ALSO_CHECK_DB) {
    // Patch url.parse like other scripts (Node 25+ + old mongodb driver edge cases).
    const _origUrlParse = url.parse;
    url.parse = function patchedParse(urlStr, ...args) {
      try {
        return _origUrlParse.call(this, urlStr, ...args);
      } catch {
        const firstHost = String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2');
        return _origUrlParse.call(this, firstHost, ...args);
      }
    };

    const mongoose = (await import('mongoose')).default;
    const config = (await import('../config/config.js')).default;
    const { YarnCone } = await import('../models/index.js');

    /**
     * @param {string} rawUrl
     * @returns {string}
     */
    function sanitizeMongoUrl(rawUrl) {
      let u = String(rawUrl || '').replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
      if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
        u = u.slice(1, -1).trim();
      }
      if (u.endsWith('>')) u = u.slice(0, -1);
      return u;
    }

    const cliMongo = process.argv.find((a) => a.startsWith('--mongo-url='));
    const mongoUrl = sanitizeMongoUrl(
      cliMongo ? cliMongo.slice('--mongo-url='.length) : String(config?.mongoose?.url || process.env.MONGODB_URL || '')
    );
    if (!mongoUrl) throw new Error('MongoDB URL is empty. Set MONGODB_URL or pass --mongo-url=');

    await mongoose.connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true });

    for (const r of rows) {
      if (!r.isValidObjectId) continue;
      const cone = await YarnCone.findById(r.inputBarcode).select('_id').lean();
      if (cone?._id) {
        r.coneExistsAsId = 'yes';
        r.reason = 'valid_objectid_and_cone_exists';
      } else {
        r.coneExistsAsId = 'no';
        r.reason = 'valid_objectid_but_no_cone_with_that_id';
      }
    }

    await mongoose.connection.close();
  }

  // Only output the rows user asked for:
  // - not a valid ObjectId OR (if ALSO_CHECK_DB) valid ObjectId but no cone exists with that _id
  const filtered = rows
    .filter((r) => !r.isValidObjectId || (ALSO_CHECK_DB && r.coneExistsAsId === 'no'))
    .sort((a, b) => b.count - a.count || a.inputBarcode.localeCompare(b.inputBarcode));

  const header = ['inputBarcode', 'isValidObjectId', 'coneExistsAsId', 'reason', 'count'].join(',');
  const body = filtered
    .map((r) =>
      [
        csvCell(r.inputBarcode),
        csvCell(r.isValidObjectId),
        csvCell(r.coneExistsAsId),
        csvCell(r.reason),
        csvCell(r.count),
      ].join(',')
    )
    .join('\n');

  fs.writeFileSync(outPath, `${header}\n${body}\n`, 'utf8');

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        inPath,
        outPath,
        uniqueInputBarcodes: counts.size,
        outputRows: filtered.length,
        alsoCheckDb: ALSO_CHECK_DB,
      },
      null,
      2
    ) + '\n'
  );
}

main().catch((e) => {
  process.stderr.write(`${e?.message || String(e)}\n`);
  process.exit(1);
});

