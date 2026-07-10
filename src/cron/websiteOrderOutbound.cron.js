import { CronJob } from 'cron';
import logger from '../config/logger.js';
import { processOutboundQueue } from '../services/integrations/websiteOrderOutbound.service.js';

/**
 * Start the website order outbound sync worker.
 * @param {string} [schedule] - cron schedule; defaults to every two minutes
 * @returns {import('cron').CronJob}
 */
export const startWebsiteOrderOutboundJob = (schedule = '*/2 * * * *') => {
  const job = new CronJob(
    schedule,
  async () => {
      try {
        const result = await processOutboundQueue();
        if (result.processed > 0) {
          logger.info(
            `[WebsiteOrderSync] Outbound processed=${result.processed} sent=${result.sent} failed=${result.failed}`
          );
        }
      } catch (error) {
        logger.error('[WebsiteOrderSync] Outbound worker error:', error);
      }
    },
    null,
    true,
    'Asia/Kolkata'
  );

  logger.info(`[WebsiteOrderSync] Outbound cron started: "${schedule}"`);
  return job;
};

/**
 * Stop the outbound cron job.
 * @param {import('cron').CronJob | null | undefined} job
 */
export const stopWebsiteOrderOutboundJob = (job) => {
  if (job) {
    job.stop();
    logger.info('[WebsiteOrderSync] Outbound cron stopped');
  }
};
