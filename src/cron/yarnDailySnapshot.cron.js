import { CronJob } from 'cron';
import mongoose from 'mongoose';
import logger from '../config/logger.js';
import { YarnCatalog, YarnDailyClosingSnapshot } from '../models/index.js';
import { computePhysicalKgMap, getYarnIdsWithPhysicalStock } from '../services/yarnManagement/physicalKgPerYarn.js';

const SNAPSHOT_TZ = process.env.YARN_SNAPSHOT_TZ || 'Asia/Kolkata';

// en-CA locale gives YYYY-MM-DD format
const toLocalDateString = (date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: SNAPSHOT_TZ }).format(date);

/** @param {string} s */
const isIsoDateKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/**
 * Compute and upsert EOD closing kg snapshots for the previous calendar day (business TZ),
 * or for an explicit calendar key when backfilling / testing.
 * Idempotent: safe to run multiple times.
 *
 * @param {{ snapshotDate?: string }} [opts] - If `snapshotDate` is `YYYY-MM-DD`, that key is used
 *   instead of "yesterday". **Values are always current physical stock** from DB — only the label
 *   changes; use for ops backfill when nightly jobs missed, not forensic historical truth.
 * @returns {Promise<{ snapshotDate: string, upserted: number, total?: number, duration: number }>}
 */
export const runYarnDailySnapshot = async (opts = {}) => {
  const now = new Date();
  let snapshotDate;
  if (opts.snapshotDate && isIsoDateKey(opts.snapshotDate)) {
    snapshotDate = opts.snapshotDate;
    logger.info(`[YarnSnapshot] Using explicit snapshotDate=${snapshotDate} (current stock → this key)`);
  } else {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    snapshotDate = toLocalDateString(yesterday);
  }

  logger.info(`[YarnSnapshot] Computing snapshot for ${snapshotDate} (TZ: ${SNAPSHOT_TZ})`);
  const startMs = Date.now();

  const physicalIds = await getYarnIdsWithPhysicalStock();
  const yarnIds = [...physicalIds];

  if (!yarnIds.length) {
    logger.info('[YarnSnapshot] No yarns with physical stock; skipping.');
    return { snapshotDate, upserted: 0, duration: Date.now() - startMs };
  }

  const catalogs = await YarnCatalog.find({
    _id: { $in: yarnIds.map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .select('_id yarnName')
    .lean();
  const catalogMap = new Map(catalogs.map((c) => [c._id.toString(), c]));

  const kgMap = await computePhysicalKgMap(yarnIds, catalogMap);

  const ops = [];
  for (const [yarnId, closingKg] of kgMap.entries()) {
    if (closingKg <= 0) continue;
    ops.push({
      updateOne: {
        filter: { snapshotDate, yarnCatalogId: new mongoose.Types.ObjectId(yarnId) },
        update: { $set: { closingKg, computedAt: now, source: 'cron' } },
        upsert: true,
      },
    });
  }

  let upserted = 0;
  if (ops.length) {
    const result = await YarnDailyClosingSnapshot.bulkWrite(ops, { ordered: false });
    upserted = (result.upsertedCount || 0) + (result.modifiedCount || 0);
  }

  const duration = Date.now() - startMs;
  logger.info(`[YarnSnapshot] Done: ${upserted}/${ops.length} rows for ${snapshotDate} in ${duration}ms`);
  return { snapshotDate, upserted, total: ops.length, duration };
};

/**
 * Start the daily snapshot cron job.
 * Default schedule: 00:00 (midnight) in `YARN_SNAPSHOT_TZ` (default Asia/Kolkata = IST);
 * each run still labels data as the **previous calendar day** in that TZ (EOD closing).
 * Override with `YARN_SNAPSHOT_CRON` — use five fields (`M H DoM Mo DoW`) for production.
 * Six-field patterns (leading seconds) are for short-interval dev testing only; do not use in prod.
 */
export const startYarnDailySnapshotJob = () => {
  const schedule = process.env.YARN_SNAPSHOT_CRON || '0 0 * * *';
  const job = new CronJob(
    schedule,
    async () => {
      try {
        await runYarnDailySnapshot({});
      } catch (err) {
        logger.error('[YarnSnapshot] Job failed:', err);
      }
    },
    null,
    true,
    SNAPSHOT_TZ
  );
  logger.info(`[YarnSnapshot] Cron started: "${schedule}" TZ=${SNAPSHOT_TZ}`);
  return job;
};

export const stopYarnDailySnapshotJob = (job) => {
  if (job) {
    job.stop();
    logger.info('[YarnSnapshot] Cron stopped');
  }
};

export default { startYarnDailySnapshotJob, stopYarnDailySnapshotJob, runYarnDailySnapshot };
