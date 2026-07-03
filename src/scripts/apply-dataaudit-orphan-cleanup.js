#!/usr/bin/env node

/**
 * Full DATAAUDIT orphan cleanup — single production command.
 *
 * Reads cones-not-in-excel.xlsx + boxes-not-in-excel.xlsx from a sync report dir and:
 *   1. Cones  — mark used, zero weight, clear rack (issued cones are skipped)
 *   2. Boxes  — zero all phantom LT boxes, including:
 *        • LT boxes with ST cones  → zero ST cones first, then box
 *        • Boxes with issued cones → zero box only (issued cones untouched)
 *
 * Always dry-run unless --apply is passed. Inventory sync runs once at the end on apply.
 *
 * Usage (dev):
 *   npm run orphans:cleanup-dataaudit -- --from-sync-dir=./reports/dataaudit-sync-29062026-apply
 *   npm run orphans:cleanup-dataaudit:apply -- --from-sync-dir=./reports/dataaudit-sync-29062026-apply
 *
 * Usage (production):
 *   NODE_ENV=production node src/scripts/apply-dataaudit-orphan-cleanup.js \
 *     --from-sync-dir=./reports/dataaudit-sync-29062026-apply \
 *     --mongo-url="$PROD_MONGODB_URL" \
 *     --dry-run
 *
 *   NODE_ENV=production node src/scripts/apply-dataaudit-orphan-cleanup.js \
 *     --from-sync-dir=./reports/dataaudit-sync-29062026-apply \
 *     --mongo-url="$PROD_MONGODB_URL" \
 *     --apply
 *
 * Flags (same as zero-out-dataaudit-orphans.js):
 *   --from-sync-dir=PATH   Dir with cones/boxes-not-in-excel.xlsx (default: latest reports/dataaudit-sync-*)
 *   --cones-file=PATH      Override cone xlsx
 *   --boxes-file=PATH      Override box xlsx
 *   --out-dir=PATH         Report output dir
 *   --dry-run              Default unless --apply
 *   --apply                Persist updates + inventory sync
 *   --mongo-url=URL        Override Mongo connection string
 *   --cones-only / --boxes-only   Limit to one entity type (rare)
 */

import './lib/mongoUrlParsePatch.js';

if (!process.argv.includes('--full-cleanup')) {
  process.argv.push('--full-cleanup');
}

await import('./zero-out-dataaudit-orphans.js');
