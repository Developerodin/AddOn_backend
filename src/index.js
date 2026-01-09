import mongoose from 'mongoose';
import app from './app.js';
import config from './config/config.js';
import logger from './config/logger.js';
import { testS3Connection } from './utils/s3Connection.js';
import { startOrderSyncJob } from './cron/orderSync.cron.js';

let server;
let orderSyncCronJob;

mongoose.connect(config.mongoose.url, config.mongoose.options).then(async () => {
  logger.info('Connected to MongoDB');
  
  // Test S3 connection
  await testS3Connection();
  
  // Start order sync cron job
  const cronSchedule = process.env.ORDER_SYNC_CRON_SCHEDULE || '*/30 * * * *'; // Every 30 minutes
  orderSyncCronJob = startOrderSyncJob(cronSchedule);
  
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
  if (server) {
    server.close();
  }
});
