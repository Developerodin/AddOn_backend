import { CronJob } from 'cron';
import mongoose from 'mongoose';
import logger from '../config/logger.js';
import { YarnCatalog, YarnDailyClosingSnapshot } from '../models/index.js';
import { computePhysicalKgMap, getYarnIdsWithPhysicalStock } from '../services/yarnManagement/physicalKgPerYarn.js';

const SNAPSHOT_TZ = process.env.YARN_SNAPSHOT_TZ || 'Asia/Kolkata';

// en-CA locale gives YYYY-MM-DD format
const toLocalDateString = (date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: SNAPSHOT_TZ }).format(date);

/**
 * Compute and upsert EOD closing kg snapshots for the previous calendar day.
 * Idempotent: safe to run multiple times.
 */
export const runYarnDailySnapshot = async () => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const snapshotDate = toLocalDateString(yesterday);

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
 * Default schedule: 00:05 local TZ (snapshots previous calendar day).
 * Override with YARN_SNAPSHOT_CRON env var.
 */
export const startYarnDailySnapshotJob = () => {
  const schedule = process.env.YARN_SNAPSHOT_CRON || '5 0 * * *';
  const job = new CronJob(
    schedule,
    async () => {
      try {
        await runYarnDailySnapshot();
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
