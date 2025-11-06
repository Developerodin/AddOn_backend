import { CronJob } from 'cron';
import logger from '../config/logger.js';
import * as orderService from '../services/order.service.js';

/**
 * Schedule order synchronization job
 * Runs every 30 minutes by default
 * @param {string} schedule - Cron schedule pattern (default: every 30 minutes)
 */
export const startOrderSyncJob = (schedule = '*/30 * * * *') => {
  const job = new CronJob(
    schedule,
    async () => {
      try {
        logger.info('Starting scheduled order sync from all sources...');
        
        const result = await orderService.syncOrdersFromAllSources({
          startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
          limit: 100,
        });

        logger.info('Scheduled order sync completed:', {
          success: result.success,
          summary: result.summary,
        });
      } catch (error) {
        logger.error('Error in scheduled order sync:', error);
      }
    },
    null, // onComplete callback
    true, // start immediately
    'UTC' // timezone
  );

  logger.info(`Order sync cron job started with schedule: ${schedule}`);
  return job;
};

/**
 * Schedule order sync for specific source
 * @param {string} source - Source to sync (Website, Amazon, Flipkart, Blinkit)
 * @param {string} schedule - Cron schedule pattern
 */
export const startSourceSyncJob = (source, schedule = '*/30 * * * *') => {
  const job = new CronJob(
    schedule,
    async () => {
      try {
        logger.info(`Starting scheduled order sync from ${source}...`);
        
        const result = await orderService.syncOrdersFromSource(source, {
          startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
          limit: 100,
        });

        logger.info(`Scheduled order sync from ${source} completed:`, result);
      } catch (error) {
        logger.error(`Error in scheduled order sync from ${source}:`, error);
      }
    },
    null,
    true,
    'UTC'
  );

  logger.info(`Order sync cron job for ${source} started with schedule: ${schedule}`);
  return job;
};

/**
 * Stop a cron job
 * @param {CronJob} job - Cron job instance
 */
export const stopOrderSyncJob = (job) => {
  if (job) {
    job.stop();
    logger.info('Order sync cron job stopped');
  }
};

export default {
  startOrderSyncJob,
  startSourceSyncJob,
  stopOrderSyncJob,
};
