#!/usr/bin/env node

/**
 * Backfill YarnBox.boxWeight (remaining in LT) using cones already stored in ST.
 *
 * Problem this fixes:
 * - Some boxes were partially/fully transferred to ST (cones have coneStorageId + weight),
 *   but the YarnBox in LT still shows the original weight.
 *
 * Safety rules:
 * - Only touches boxes that are currently in LONG-TERM storage (storageLocation matches LT pattern).
 * - Skips boxes with no ST cones.
 * - Skips boxes where storageLocation is empty / not LT, or where boxWeight is already 0.
 *
 * Usage:
 *   node src/scripts/backfill-lt-boxweight-from-st-cones.js --dry-run
 *   node src/scripts/backfill-lt-boxweight-from-st-cones.js --limit=200
 *   node src/scripts/backfill-lt-boxweight-from-st-cones.js --only-box=BOX-PO-2026-1044-ST... --verbose
 *
 * Flags:
 *   --dry-run          Preview changes only (no writes).
 *   --limit=N          Process at most N boxes.
 *   --only-box=BOXID   Process a single boxId (exact match).
 *   --verbose          Log first 20 skipped boxes with reasons.
 */

import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { YarnBox, YarnCone } from '../models/index.js';

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : 0;
const ONLY_BOX_ARG = process.argv.find((a) => a.startsWith('--only-box='));
const ONLY_BOX = ONLY_BOX_ARG ? String(ONLY_BOX_ARG.split('=')[1] || '').trim() : '';

/** Long-term storage identifiers: legacy LT-* or rack barcodes B7-02..B7-05 (matches UI/service logic). */
const LT_STORAGE_PATTERN = /^(LT-|B7-0[2-5]-)/i;

/**
 * Format a number for logs.
 * @param {unknown} v
 * @returns {string}
 */
function fmt(v) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '-';
  return n.toFixed(4);
}

/**
 * Try to auto-fix MongoDB URL credentials by percent-encoding username/password.
 * Helps when passwords contain reserved characters (%, @, :, /, ?, #, space).
 *
 * @param {string} mongoUrl
 * @returns {string}
 */
function encodeMongoCredentials(mongoUrl) {
  const url = String(mongoUrl || '').trim();
  // If there are stray '%' sequences anywhere in the URI, the driver's internal decode can throw.
  // Normalize those first so later parsing doesn't explode.
  const normalized = url.replace(/%(?![0-9a-fA-F]{2})/g, '%25');
  const schemeIdx = normalized.indexOf('://');
  if (schemeIdx < 0) return url;

  const afterScheme = normalized.slice(schemeIdx + 3);
  const atIdx = afterScheme.indexOf('@');
  if (atIdx < 0) return normalized; // no credentials

  const rawCred = afterScheme.slice(0, atIdx);
  const rest = afterScheme.slice(atIdx + 1);

  const colonIdx = rawCred.indexOf(':');
  if (colonIdx < 0) return url;

  const rawUser = rawCred.slice(0, colonIdx);
  const rawPass = rawCred.slice(colonIdx + 1);

  const safeEncode = (v) => {
    const s = String(v ?? '');
    try {
      // If already encoded, normalize by decode→encode.
      return encodeURIComponent(decodeURIComponent(s));
    } catch {
      // If malformed (e.g. contains stray %), encode raw.
      return encodeURIComponent(s);
    }
  };

  const user = safeEncode(rawUser);
  const pass = safeEncode(rawPass);
  return `${normalized.slice(0, schemeIdx + 3)}${user}:${pass}@${rest}`;
}

/**
 * Infer original LT base weight.
 * - Prefer initialBoxWeight if present.
 * - Otherwise infer from current boxWeight + cones moved (handles both legacy and partially-fixed states).
 *
 * @param {object} args
 * @param {number|null|undefined} args.initialBoxWeight
 * @param {number|null|undefined} args.boxWeightNow
 * @param {number} args.totalConeWeightInST
 * @returns {number}
 */
function resolveBaseWeight({ initialBoxWeight, boxWeightNow, totalConeWeightInST }) {
  const initial = initialBoxWeight != null ? Number(initialBoxWeight) : 0;
  if (Number.isFinite(initial) && initial > 0) return initial;

  const bw = Number(boxWeightNow ?? 0);
  const moved = Number(totalConeWeightInST ?? 0);
  if (!Number.isFinite(bw) || bw <= 0) return 0;
  if (!Number.isFinite(moved) || moved <= 0) return bw;

  // Legacy boxes: bw is original LT weight -> base is bw.
  // If bw looks like "remaining" (already decremented), infer base as remaining + moved.
  return bw >= moved ? bw : bw + moved;
}

async function run() {
  try {
    logger.info('Connecting to MongoDB...');
    const rawUrl = String(config?.mongoose?.url || '');
    const trimmedUrl = rawUrl.trim();
    const unquotedUrl =
      (trimmedUrl.startsWith('"') && trimmedUrl.endsWith('"')) ||
      (trimmedUrl.startsWith("'") && trimmedUrl.endsWith("'"))
        ? trimmedUrl.slice(1, -1)
        : trimmedUrl;
    // Some local .env files accidentally end Atlas URLs with ">" (copy/paste issue).
    const sanitizedUrl = unquotedUrl.endsWith('>') ? unquotedUrl.slice(0, -1) : unquotedUrl;
    const redactedUrl = sanitizedUrl.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
    logger.info(`MongoDB URL: ${redactedUrl}`);
    // Use the same connection options as the app to avoid URI parse issues across driver versions.
    try {
      await mongoose.connect(sanitizedUrl, config?.mongoose?.options || {});
    } catch (e) {
      const msg = e?.message || String(e);
      if (!/URI malformed/i.test(msg)) throw e;
      const repaired = encodeMongoCredentials(sanitizedUrl);
      const repairedRedacted = repaired.replace(/\/\/([^:]+):([^@]+)@/g, '//<user>:<pass>@');
      logger.warn(`MongoDB URL looks unescaped. Retrying with encoded credentials: ${repairedRedacted}`);
      await mongoose.connect(repaired, config?.mongoose?.options || {});
    }

    if (DRY_RUN) logger.info('DRY RUN – no writes will be performed');
    if (LIMIT) logger.info(`Limit: ${LIMIT} boxes`);
    if (ONLY_BOX) logger.info(`Only boxId: ${ONLY_BOX}`);

    // 1) Aggregate ST cone weights by boxId.
    const coneMatch = {
      coneStorageId: { $exists: true, $nin: [null, ''] },
      coneWeight: { $gt: 0 },
      ...(ONLY_BOX ? { boxId: ONLY_BOX } : {}),
    };

    const coneAgg = await YarnCone.aggregate([
      { $match: coneMatch },
      {
        $group: {
          _id: '$boxId',
          totalConeWeight: { $sum: { $ifNull: ['$coneWeight', 0] } },
          coneCount: { $sum: 1 },
        },
      },
    ]).allowDiskUse(true);

    const byBoxId = new Map();
    for (const row of coneAgg) {
      const boxId = String(row._id || '').trim();
      if (!boxId) continue;
      const totalConeWeight = Number(row.totalConeWeight ?? 0);
      const coneCount = Number(row.coneCount ?? 0);
      if (!Number.isFinite(totalConeWeight) || totalConeWeight <= 0 || coneCount <= 0) continue;
      byBoxId.set(boxId, { totalConeWeight, coneCount });
    }

    const boxIds = Array.from(byBoxId.keys());
    logger.info(`Found ${boxIds.length} boxId(s) with cones in ST.`);
    if (boxIds.length === 0) return;

    // 2) Load candidate LT boxes that still have boxWeight > 0.
    let q = YarnBox.find({
      boxId: { $in: boxIds },
      boxWeight: { $gt: 0 },
      storageLocation: { $exists: true, $ne: '' },
    })
      .select('_id boxId boxWeight initialBoxWeight storageLocation storedStatus coneData')
      .sort({ createdAt: 1 })
      .lean();

    if (LIMIT > 0) q = q.limit(LIMIT);
    const boxes = await q;
    logger.info(`Loaded ${boxes.length} YarnBox doc(s) with boxWeight > 0 & storageLocation set.`);

    let updated = 0;
    let skipped = 0;
    let skippedLogged = 0;

    for (const box of boxes) {
      const boxId = String(box.boxId || '').trim();
      const storageLocation = String(box.storageLocation || '').trim();
      const boxWeightNow = Number(box.boxWeight ?? 0);

      if (!boxId) {
        skipped += 1;
        continue;
      }

      if (!storageLocation || !LT_STORAGE_PATTERN.test(storageLocation)) {
        skipped += 1;
        if (VERBOSE && skippedLogged < 20) {
          logger.info(`  [skip] ${boxId}: not in LT storage (${storageLocation || '-'})`);
          skippedLogged += 1;
        }
        continue;
      }

      if (!Number.isFinite(boxWeightNow) || boxWeightNow <= 0.001) {
        skipped += 1;
        continue;
      }

      const st = byBoxId.get(boxId);
      if (!st) {
        skipped += 1;
        continue;
      }

      const baseWeight = resolveBaseWeight({
        initialBoxWeight: box.initialBoxWeight,
        boxWeightNow,
        totalConeWeightInST: st.totalConeWeight,
      });

      if (!Number.isFinite(baseWeight) || baseWeight <= 0) {
        skipped += 1;
        if (VERBOSE && skippedLogged < 20) {
          logger.info(`  [skip] ${boxId}: invalid baseWeight (${fmt(baseWeight)})`);
          skippedLogged += 1;
        }
        continue;
      }

      const remaining = Math.max(0, baseWeight - st.totalConeWeight);
      const fullyTransferred = st.coneCount > 0 && remaining <= 0.001;

      // If already consistent (within epsilon), skip.
      if (Math.abs(remaining - boxWeightNow) <= 0.0005) {
        skipped += 1;
        continue;
      }

      const update = fullyTransferred
        ? {
            $set: {
              boxWeight: 0,
              storedStatus: false,
              initialBoxWeight:
                box.initialBoxWeight == null || Number(box.initialBoxWeight) <= 0
                  ? baseWeight
                  : box.initialBoxWeight,
              coneData: {
                ...(box.coneData && typeof box.coneData === 'object' ? box.coneData : {}),
                conesIssued: true,
                numberOfCones: st.coneCount,
                coneIssueDate: new Date(),
              },
            },
            $unset: { storageLocation: '' },
          }
        : {
            $set: {
              boxWeight: remaining,
              ...(box.initialBoxWeight == null || Number(box.initialBoxWeight) <= 0
                ? { initialBoxWeight: baseWeight }
                : {}),
            },
          };

      if (DRY_RUN) {
        logger.info(
          `  [dry-run] ${boxId}: LT ${storageLocation} boxWeight ${fmt(boxWeightNow)} → ${fmt(
            fullyTransferred ? 0 : remaining
          )} (ST moved=${fmt(st.totalConeWeight)}, cones=${st.coneCount})`
        );
      } else {
        await YarnBox.updateOne({ _id: box._id }, update);
        logger.info(
          `  ${boxId}: boxWeight ${fmt(boxWeightNow)} → ${fmt(
            fullyTransferred ? 0 : remaining
          )} (ST moved=${fmt(st.totalConeWeight)})`
        );
      }

      updated += 1;
    }

    logger.info('---');
    logger.info(`Updated: ${updated}`);
    logger.info(`Skipped: ${skipped}`);
    if (DRY_RUN && updated) logger.info('Run without --dry-run to apply changes.');
  } catch (err) {
    logger.error('Script failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB.');
  }
}

run();

