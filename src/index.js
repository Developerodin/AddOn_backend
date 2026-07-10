import mongoose from 'mongoose';
import app from './app.js';
import config from './config/config.js';
import { redactMongoUri } from './config/mongoUri.js';
import logger from './config/logger.js';
import { mongoSupportsTransactions } from './utils/mongoDeployment.js';
import { testS3Connection } from './utils/s3Connection.js';
import { startOrderSyncJob } from './cron/orderSync.cron.js';
import { startYarnDailySnapshotJob, stopYarnDailySnapshotJob } from './cron/yarnDailySnapshot.cron.js';
import { startWebsiteOrderOutboundJob, stopWebsiteOrderOutboundJob } from './cron/websiteOrderOutbound.cron.js';

let server;
let orderSyncCronJob;
let yarnSnapshotCronJob;
let websiteOrderOutboundCronJob;

const mongoOptions = {
  ...config.mongoose.options,
  retryWrites: config.mongoose.options.retryWrites ?? false,
};

logger.info(
  `MongoDB connect → ${redactMongoUri(config.mongoose.url)} | retryWrites=${mongoOptions.retryWrites}`
);

mongoose.connect(config.mongoose.url, mongoOptions).then(async () => {
  logger.info('Connected to MongoDB');
  const txnSupported = await mongoSupportsTransactions();
  logger.info(`MongoDB deployment transactionsSupported=${txnSupported}`);
  
  // Test S3 connection
  await testS3Connection();
  
  // Start order sync cron job
  const cronSchedule = process.env.ORDER_SYNC_CRON_SCHEDULE || '*/30 * * * *'; // Every 30 minutes
  orderSyncCronJob = startOrderSyncJob(cronSchedule);

  // Start website order outbound sync (addonweb ← warehouse)
  const websiteOutboundSchedule = process.env.WEBSITE_ORDER_OUTBOUND_CRON || '*/2 * * * *';
  websiteOrderOutboundCronJob = startWebsiteOrderOutboundJob(websiteOutboundSchedule);

  // Start yarn daily closing snapshot job (feature-flagged)
  if (process.env.YARN_DAILY_SNAPSHOT_ENABLED === 'true') {
    yarnSnapshotCronJob = startYarnDailySnapshotJob();
  }
  
  server = app.listen(config.port, () => {
    logger.info(`Listening to port ${config.port}`);
  });
}).catch((error) => {
  logger.error('MongoDB connection error:', error);
  logger.error('MongoDB URL:', config.mongoose.url);
  logger.error('Please check your MONGODB_URL environment variable');
  process.exit(1);
});

const exitHandler = () => {
  if (server) {
    server.close(() => {
      logger.info('Server closed');
      // Stop cron jobs
      if (orderSyncCronJob) {
        orderSyncCronJob.stop();
        logger.info('Order sync cron job stopped');
      }
      stopYarnDailySnapshotJob(yarnSnapshotCronJob);
      stopWebsiteOrderOutboundJob(websiteOrderOutboundCronJob);
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
};

const unexpectedErrorHandler = (error) => {
  logger.error(error);
  exitHandler();
};

process.on('uncaughtException', unexpectedErrorHandler);
process.on('unhandledRejection', unexpectedErrorHandler);

process.on('SIGTERM', () => {
  logger.info('SIGTERM received');
  if (orderSyncCronJob) {
    orderSyncCronJob.stop();
    logger.info('Order sync cron job stopped');
  }
  stopYarnDailySnapshotJob(yarnSnapshotCronJob);
  stopWebsiteOrderOutboundJob(websiteOrderOutboundCronJob);
  if (server) {
    server.close();
  }
});
