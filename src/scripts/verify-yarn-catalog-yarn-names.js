#!/usr/bin/env node
/**
 * Compare stored YarnCatalog.yarnName to the canonical string from embedded fields
 * (countSize, colorFamily, pantonName, yarnType/subtype). Use after pantone/color renames.
 *
 *   node src/scripts/verify-yarn-catalog-yarn-names.js
 *   node src/scripts/verify-yarn-catalog-yarn-names.js --fix
 *   node src/scripts/verify-yarn-catalog-yarn-names.js --json
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import YarnCatalog from '../models/yarnManagement/yarnCatalog.model.js';
import { buildYarnCatalogYarnName } from '../utils/yarnCatalogYarnName.util.js';

const FIX = process.argv.includes('--fix');
const AS_JSON = process.argv.includes('--json');

async function main() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  // Raw docs (no Mongoose post-find hooks) so expected name matches embedded snapshot on disk,
  // not live Color/YarnType master rows.
  const catalogs = await YarnCatalog.collection
    .find({})
    .project({
      yarnName: 1,
      countSize: 1,
      colorFamily: 1,
      pantonName: 1,
      yarnType: 1,
      yarnSubtype: 1,
    })
    .toArray();

  const mismatches = [];
  let ok = 0;

  for (const c of catalogs) {
    const expected = buildYarnCatalogYarnName(c);
    const stored = c.yarnName != null ? String(c.yarnName).trim() : '';

    if (expected === null) {
      if (!stored) ok += 1;
      else {
        mismatches.push({
          _id: c._id.toString(),
          stored,
          expected: null,
          reason: 'cannot_build_expected_missing_parts',
        });
      }
      continue;
    }

    if (stored === expected) ok += 1;
    else {
      mismatches.push({
        _id: c._id.toString(),
        stored,
        expected,
        reason: 'drift',
      });
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ ok, mismatchCount: mismatches.length, mismatches }, null, 2));
  } else {
    logger.info(
      `YarnCatalog yarnName check: ${ok} match, ${mismatches.length} mismatch (of ${catalogs.length})`
    );
    mismatches.slice(0, 50).forEach((m) => {
      logger.info(`  ${m._id}: "${m.stored}" → expected "${m.expected}" (${m.reason})`);
    });
    if (mismatches.length > 50) {
      logger.info(`  ... and ${mismatches.length - 50} more (use --json for full list)`);
    }
  }

  if (FIX && mismatches.length > 0) {
    let updated = 0;
    for (const m of mismatches) {
      if (m.expected == null) continue;
      await YarnCatalog.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(m._id) },
        { $set: { yarnName: m.expected } }
      );
      updated += 1;
    }
    if (!AS_JSON) {
      const skipped = mismatches.filter((x) => x.expected == null).length;
      logger.info(`--fix: updated ${updated} documents (${skipped} skipped: cannot build expected from embedded fields).`);
    }
  }

  await mongoose.disconnect();
  process.exit(!FIX && mismatches.length > 0 ? 1 : 0);
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
