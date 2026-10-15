#!/usr/bin/env node
/**
 * Backfill multi-pair lines on website orders that were ingested before pair lookup.
 * Pulls the original product rows from addonweb, then re-runs ingest repair.
 *
 * Usage: node src/scripts/repair-website-multipair-orders.js 21006 21599
 */
import mongoose from 'mongoose';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { ingestWebsiteOrder } from '../services/integrations/websiteOrderIngest.service.js';

/**
 * Fetch original website order payloads.
 * @param {number[]} opencartOrderIds
 * @returns {Promise<object[]>}
 */
const fetchPayloads = async (opencartOrderIds) => {
  const base = (config.integrations?.addonwebBaseUrl || '').replace(/\/$/, '');
  const apiKey = config.integrations?.websiteOrderSyncApiKey || '';
  if (!base || !apiKey) {
    throw new Error('ADDONWEB_BASE_URL or WEBSITE_ORDER_SYNC_API_KEY is not set');
  }

  const url = `${base}/index.php?route=extension/addon/whms_sync.replay`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({ opencartOrderIds }),
  });

  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw new Error(`Website replay did not return JSON (${res.status})`);
  }

  if (!res.ok || body?.error) {
    throw new Error(body?.error || `Website replay failed (${res.status})`);
  }

  return Array.isArray(body?.orders) ? body.orders : [];
};

const run = async () => {
  const ids = process.argv.slice(2).map((value) => Number(value)).filter((id) => id > 0);
  if (!ids.length) {
    throw new Error('Pass OpenCart order ids, e.g. node src/scripts/repair-website-multipair-orders.js 21006 21599');
  }

  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  const payloads = await fetchPayloads(ids);
  logger.info(`Website returned ${payloads.length} order payload(s)`);

  for (const payload of payloads) {
    const result = await ingestWebsiteOrder(payload);
    logger.info(
      `${payload.addonOrderId}: ${result.status} multi=${result.multiPairCount ?? '-'} remainingErrors=${(result.syncErrors || []).length}`
    );
  }
};

run()
  .catch((error) => {
    logger.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
