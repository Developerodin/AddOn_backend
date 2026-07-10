import config from '../../config/config.js';
import logger from '../../config/logger.js';
import WarehouseOrder from '../../models/whms/warehouseOrder.model.js';
import WebsiteOrderOutboundQueue from '../../models/integrations/websiteOrderOutboundQueue.model.js';
import WebsiteOrderSyncLog from '../../models/integrations/websiteOrderSyncLog.model.js';
import { buildSyncToken, buildWhmsSyncComment, mapWhmsToWebsite } from './websiteOrderSyncMap.js';

const MAX_ATTEMPTS = 10;
const BATCH_SIZE = 20;

/**
 * Build outbound payload for the website receiver endpoint.
 * @param {object} order - Mongoose warehouse order document
 * @param {object} target - from mapWhmsToWebsite
 * @param {string} event
 * @param {string} syncToken
 * @returns {object}
 */
export const buildOutboundPayload = (order, target, event, syncToken) => {
  const dispatchPlain = order.dispatch?.toObject ? order.dispatch.toObject() : order.dispatch || {};
  const meta = order.meta && typeof order.meta.toObject === 'function' ? order.meta.toObject() : order.meta || {};
  const opencartOrderId = meta.opencartOrderId || parseInt(String(order.addonOrderId || '').replace(/^WEB-/i, ''), 10) || 0;

  return {
    addonOrderId: order.addonOrderId,
    opencartOrderId,
    whmsOrderId: String(order._id),
    whmsOrderNumber: order.orderNumber,
    event,
    whmsFlowStatus: order.flowStatus,
    whmsStatus: order.status,
    targetOrderStatusId: target.orderStatusId,
    comment: buildWhmsSyncComment(target.label, dispatchPlain),
    notifyCustomer: Boolean(target.notify),
    dispatch: {
      courierName: dispatchPlain.courierName || '',
      trackingNumber: dispatchPlain.trackingNumber || '',
      dispatchDate: dispatchPlain.dispatchDate || null,
      boxCount: dispatchPlain.boxCount || 0,
    },
    syncToken,
    syncOrigin: 'warehouse',
  };
};

/**
 * Enqueue a website status push for an addonweb-sourced warehouse order.
 * Non-throwing — safe to call from fulfilment hooks.
 * @param {object} order - saved WarehouseOrder document
 * @param {'status_update'|'tracking_update'|'cancel'} event
 */
export const enqueueWebsitePush = async (order, event = 'status_update') => {
  if (!order?.addonOrderId || order?.meta?.source !== 'addonweb') return;

  const target = mapWhmsToWebsite(order.flowStatus);
  if (!target && event === 'status_update') return;

  const meta = order.meta && typeof order.meta.toObject === 'function' ? order.meta.toObject() : order.meta || {};
  if (event === 'status_update' && meta.lastPushedWhmsFlowStatus === order.flowStatus) return;

  const syncToken = buildSyncToken(order, event);

  const existing = await WebsiteOrderOutboundQueue.findOne({ syncToken, status: { $in: ['pending', 'sent'] } }).lean();
  if (existing) return;

  const payloadTarget = target || { orderStatusId: 2, notify: false, label: 'Processing' };
  const payload = buildOutboundPayload(order, payloadTarget, event, syncToken);

  await WebsiteOrderOutboundQueue.create({
    warehouseOrderId: order._id,
    addonOrderId: order.addonOrderId,
    event,
    payload,
    syncToken,
    status: 'pending',
    attempts: 0,
  });
};

/**
 * POST one outbound job to the website receiver.
 * @param {object} job - queue document
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
const sendOutboundJob = async (job) => {
  const baseUrl = (config.integrations?.addonwebBaseUrl || '').replace(/\/$/, '');
  const receivePath = config.integrations?.addonwebReceivePath || 'index.php?route=extension/addon/whms_sync.receive';
  const apiKey = config.integrations?.websiteOrderSyncApiKey;

  if (!baseUrl || !apiKey) {
    return { ok: false, error: 'Website sync URL or API key not configured' };
  }

  const url = `${baseUrl}/${receivePath.replace(/^\//, '')}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(job.payload),
    });

    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (!res.ok) {
      return { ok: false, error: body?.error || body?.message || `HTTP ${res.status}` };
    }

    if (body?.status === 'applied' || body?.status === 'already_applied') {
      return { ok: true };
    }

    return { ok: false, error: body?.error || 'Unexpected response from website' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
};

/**
 * Process pending outbound website sync jobs.
 * @returns {Promise<{ processed: number, sent: number, failed: number }>}
 */
export const processOutboundQueue = async () => {
  const now = new Date();
  const jobs = await WebsiteOrderOutboundQueue.find({
    $or: [
      { status: 'pending' },
      { status: 'failed', nextRetryAt: { $lte: now }, attempts: { $lt: MAX_ATTEMPTS } },
    ],
  })
    .sort({ createdAt: 1 })
    .limit(BATCH_SIZE);

  let sent = 0;
  let failed = 0;

  for (const job of jobs) {
    const result = await sendOutboundJob(job);
    if (result.ok) {
      job.status = 'sent';
      job.lastError = '';
      await job.save();

      const order = await WarehouseOrder.findById(job.warehouseOrderId);
      if (order) {
        const meta = order.meta && typeof order.meta.toObject === 'function' ? order.meta.toObject() : order.meta || {};
        order.meta = {
          ...meta,
          lastPushedWhmsFlowStatus: order.flowStatus,
          lastWebsitePushAt: new Date(),
          lastWebsitePushError: '',
        };
        order.markModified('meta');
        await order.save();
      }

      await WebsiteOrderSyncLog.create({
        addonOrderId: job.addonOrderId,
        direction: 'outbound',
        status: 'sent',
        warehouseOrderId: job.warehouseOrderId,
        requestPayload: { event: job.event, syncToken: job.syncToken },
      });

      sent += 1;
    } else {
      job.attempts += 1;
      job.lastError = result.error || 'unknown';
      if (job.attempts >= MAX_ATTEMPTS) {
        job.status = 'dead';
      } else {
        job.status = 'failed';
        const backoffMs = Math.min(60000 * 2 ** job.attempts, 3600000);
        job.nextRetryAt = new Date(Date.now() + backoffMs);
      }
      await job.save();

      const order = await WarehouseOrder.findById(job.warehouseOrderId);
      if (order) {
        const meta = order.meta && typeof order.meta.toObject === 'function' ? order.meta.toObject() : order.meta || {};
        order.meta = { ...meta, lastWebsitePushError: job.lastError };
        order.markModified('meta');
        await order.save();
      }

      failed += 1;
      logger.warn(`Website outbound sync failed for ${job.addonOrderId}: ${job.lastError}`);
    }
  }

  return { processed: jobs.length, sent, failed };
};

/**
 * Manually re-push the current warehouse order state to the website.
 * @param {string} warehouseOrderId
 * @returns {Promise<object>}
 */
export const manualPushToWebsite = async (warehouseOrderId) => {
  const order = await WarehouseOrder.findById(warehouseOrderId);
  if (!order) throw new Error('Warehouse order not found');
  if (order.meta?.source !== 'addonweb') throw new Error('Not a website-sourced order');

  const meta = order.meta && typeof order.meta.toObject === 'function' ? order.meta.toObject() : order.meta || {};
  order.meta = { ...meta, lastPushedWhmsFlowStatus: undefined };
  order.markModified('meta');
  await order.save();

  await enqueueWebsitePush(order, 'status_update');
  const result = await processOutboundQueue();
  return { queued: true, ...result };
};

/**
 * Fire-and-forget website push from fulfilment hooks.
 * @param {object} order
 * @param {string} event
 */
export const notifyWebsiteFromOrder = (order, event = 'status_update') => {
  enqueueWebsitePush(order, event).catch((e) => {
    logger.error('website push enqueue failed', e);
  });
};
