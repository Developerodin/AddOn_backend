#!/usr/bin/env node
/**
 * E2E test: warehouse fulfilment flow (order → pick → pack stages → scan → bill → dispatch → return).
 *
 * Prerequisites:
 *   - Backend running (default http://127.0.0.1:8000)
 *   - Admin (or super_admin) login with all whms* permissions
 *   - At least one StyleCode in catalogue (script ensures inventory stock)
 *
 * Usage:
 *   node src/scripts/e2e-whms-fulfilment-flow.js
 *   node src/scripts/e2e-whms-fulfilment-flow.js --execute   # same (always runs; flag kept for clarity)
 *   API_URL=http://localhost:8000 TEST_EMAIL=... TEST_PASSWORD=... node src/scripts/e2e-whms-fulfilment-flow.js
 *
 * Does NOT wipe data unless WHMS_E2E_CLEAN=1 (runs clear-whms-orders first).
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../config/config.js';
import { connectMongooseForScript } from '../../scripts/lib/mongoScriptConnect.js';
import StyleCode from '../models/styleCode.model.js';
import WarehouseInventory from '../models/whms/warehouseInventory.model.js';
import WarehouseClient from '../models/whms/warehouseClient.model.js';
import WarehouseOrder from '../models/whms/warehouseOrder.model.js';

const BASE_URL = process.env.LOCAL_API_URL || process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 8000}`;
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@addon.in';
const TEST_PASSWORD = process.env.TEST_PASSWORD || process.env.ADDON_TEST_PASSWORD || 'odin@1234';
const MIN_STOCK = Number(process.env.WHMS_E2E_MIN_STOCK || 20);
const ORDER_QTY = Number(process.env.WHMS_E2E_ORDER_QTY || 6);

/** @type {Array<{ step: string; ok: boolean; detail?: string }>} */
const results = [];

/**
 * Record a test step outcome.
 * @param {string} step
 * @param {boolean} ok
 * @param {string} [detail]
 */
function record(step, ok, detail = '') {
  results.push({ step, ok, detail });
  const icon = ok ? '✓' : '✗';
  console.log(`${icon} ${step}${detail ? ` — ${detail}` : ''}`);
}

/**
 * HTTP helper for WHMS API calls.
 * @param {string} method
 * @param {string} path
 * @param {string|null} token
 * @param {object|null} body
 */
async function request(method, path, token = null, body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

/**
 * Assert HTTP status and record step.
 * @param {string} step
 * @param {{ status: number; data: unknown }} res
 * @param {number} expected
 */
function expectStatus(step, res, expected) {
  const ok = res.status === expected;
  const msg = ok
    ? ''
    : `HTTP ${res.status}: ${(res.data && typeof res.data === 'object' && 'message' in res.data ? res.data.message : JSON.stringify(res.data)) || 'no body'}`;
  record(step, ok, msg);
  return ok;
}

/**
 * PATCH flow status helper.
 * @param {string} token
 * @param {string} orderId
 * @param {string} flowStatus
 * @param {string} stepLabel
 */
async function flow(token, orderId, flowStatus, stepLabel) {
  const res = await request('PATCH', `/v1/whms/warehouse-orders/${orderId}/flow-status`, token, { flowStatus });
  expectStatus(stepLabel, res, 200);
  return res;
}

/**
 * Find a style with enough available stock, or seed inventory for the first style found.
 * @returns {Promise<{ styleCodeId: string; styleCode: string; available: number }>}
 */
async function resolveStockStyle(token) {
  let inv = await WarehouseInventory.findOne({ availableQuantity: { $gte: ORDER_QTY } })
    .sort({ availableQuantity: -1 })
    .lean();
  if (inv) {
    return {
      styleCodeId: String(inv.styleCodeId),
      styleCode: inv.styleCode,
      available: Number(inv.availableQuantity || 0),
    };
  }

  const style = await StyleCode.findOne({ styleCode: { $exists: true, $ne: '' } }).sort({ createdAt: -1 }).lean();
  if (!style) {
    throw new Error('No StyleCode in DB — add catalogue style codes first');
  }

  const res = await request('POST', '/v1/whms/warehouse-inventory', token, {
    styleCodeId: String(style._id),
    styleCode: style.styleCode,
    totalQuantity: MIN_STOCK,
    blockedQuantity: 0,
  });
  if (res.status !== 201 && res.status !== 200) {
    const patchRes = await request('PATCH', `/v1/whms/warehouse-inventory/${String(style._id)}`, token, {
      totalQuantity: MIN_STOCK,
      blockedQuantity: 0,
    }).catch(() => null);
    if (!patchRes || (patchRes.status !== 200 && patchRes.status !== 404)) {
      throw new Error(`Could not seed inventory for ${style.styleCode}: ${JSON.stringify(res.data)}`);
    }
  }

  inv = await WarehouseInventory.findOne({ styleCode: style.styleCode }).lean();
  return {
    styleCodeId: String(style._id),
    styleCode: style.styleCode,
    available: Number(inv?.availableQuantity || MIN_STOCK),
  };
}

/**
 * Resolve or create a Trade warehouse client for test orders.
 * @param {string} token
 */
async function resolveClient(token) {
  let client = await WarehouseClient.findOne({ type: 'Trade', status: 'active' }).sort({ createdAt: -1 }).lean();
  if (client) return { id: String(client._id), type: 'Trade', name: client.retailerName || 'Test Client' };

  const res = await request('POST', '/v1/whms/warehouse-clients', token, {
    type: 'Trade',
    retailerName: `E2E Test Retailer ${Date.now()}`,
    city: 'Mumbai',
    state: 'Maharashtra',
    status: 'active',
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Could not create warehouse client: ${JSON.stringify(res.data)}`);
  }
  const id = res.data?.id || res.data?._id;
  return { id: String(id), type: 'Trade', name: res.data?.retailerName || 'E2E Client' };
}

async function main() {
  console.log('\n=== WHMS Fulfilment E2E Test ===\n');
  console.log(`API: ${BASE_URL}`);
  console.log(`Login: ${TEST_EMAIL}\n`);

  const loginRes = await request('POST', '/v1/auth/login', null, {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (!expectStatus('Login', loginRes, 200)) {
    console.error('\nFix: start server + set TEST_EMAIL / TEST_PASSWORD (admin with whms permissions).\n');
    process.exit(1);
  }

  const token = loginRes.data?.tokens?.access?.token || loginRes.data?.access?.token;
  const userRole = loginRes.data?.user?.role || '';
  record('User role check', ['admin', 'super_admin'].includes(userRole), userRole || 'unknown');

  await connectMongooseForScript(config);

  if (process.env.WHMS_E2E_CLEAN === '1') {
    const { spawnSync } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
    spawnSync('node', ['src/scripts/clear-whms-orders.js', '--execute'], { stdio: 'inherit', cwd: root });
  }

  let stock;
  try {
    stock = await resolveStockStyle(token);
    record('Stock available for order', stock.available >= ORDER_QTY, `${stock.styleCode} avail=${stock.available}, order qty=${ORDER_QTY}`);
  } catch (err) {
    record('Stock / style resolution', false, err instanceof Error ? err.message : String(err));
    await mongoose.disconnect();
    process.exit(1);
  }

  let client;
  try {
    client = await resolveClient(token);
    record('Warehouse client', true, `${client.name} (${client.id})`);
  } catch (err) {
    record('Warehouse client', false, err instanceof Error ? err.message : String(err));
    await mongoose.disconnect();
    process.exit(1);
  }

  const orderBody = {
    clientType: client.type,
    clientId: client.id,
    styleCodeSinglePair: [
      {
        styleCodeId: stock.styleCodeId,
        styleCode: stock.styleCode,
        pack: '1x',
        colour: 'Black',
        type: 'Crew',
        pattern: 'Solid',
        quantity: ORDER_QTY,
      },
    ],
    styleCodeMultiPair: [],
  };

  const createRes = await request('POST', '/v1/whms/warehouse-orders', token, orderBody);
  if (!expectStatus('Create warehouse order', createRes, 201)) {
    await mongoose.disconnect();
    process.exit(1);
  }
  const orderId = createRes.data?.id || createRes.data?._id;
  const orderNumber = createRes.data?.orderNumber || orderId;
  record('Order created', true, `${orderNumber} (${orderId})`);

  const pickRes = await request('GET', `/v1/whms/pick-list/order/${orderId}`, token);
  if (!expectStatus('Pick list auto-generated', pickRes, 200)) {
    await mongoose.disconnect();
    process.exit(1);
  }
  const pickRows = Array.isArray(pickRes.data) ? pickRes.data : [];
  record('Pick list rows', pickRows.length > 0, `${pickRows.length} row(s)`);

  const owRes = await request('GET', `/v1/whms/pick-list/order-wise?orderId=${orderId}`, token);
  const owGroup = owRes.data?.results?.[0];
  const owItem = owGroup?.items?.[0];
  const availOnRow = Number(owItem?.availableStock ?? -1);
  record(
    'Pick list shows available stock',
    owRes.status === 200 && availOnRow >= ORDER_QTY,
    `availableStock=${availOnRow}`
  );

  await flow(token, orderId, 'picking', 'Flow → picking');

  for (const row of pickRows) {
    const pickId = row.id || row._id;
    const qty = Math.min(ORDER_QTY, Number(row.quantity || ORDER_QTY));
    const patchRes = await request('PATCH', `/v1/whms/pick-list/${pickId}`, token, { pickupQuantity: qty });
    expectStatus(`Pick qty saved (${row.styleCode || pickId})`, patchRes, 200);
  }

  const invAfterPick = await WarehouseInventory.findOne({ styleCode: stock.styleCode }).lean();
  const stockDeducted = Number(invAfterPick?.availableQuantity || 0) <= stock.available - ORDER_QTY + 1;
  record('Inventory deducted after pick', stockDeducted, `avail now=${invAfterPick?.availableQuantity}`);

  await flow(token, orderId, 'picking-done', 'Flow → picking-done');
  await flow(token, orderId, 'barcode-in-progress', 'Flow → barcode-in-progress');
  await flow(token, orderId, 'packing-done', 'Flow → packing-done');
  await flow(token, orderId, 'sent-to-scanning', 'Flow → sent-to-scanning');

  const sessionRes = await request('POST', '/v1/whms/scanning/sessions', token, { orderId });
  if (!expectStatus('Create scan session', sessionRes, 201)) {
    await mongoose.disconnect();
    process.exit(1);
  }
  const sessionId = sessionRes.data?.id || sessionRes.data?._id;

  for (const row of pickRows) {
    const code = row.styleCode || row.skuCode;
    const qty = Math.min(ORDER_QTY, Number(row.quantity || ORDER_QTY));
    const scanRes = await request('POST', `/v1/whms/scanning/sessions/${sessionId}/scan`, token, {
      barcode: code,
      qty,
    });
    expectStatus(`Scan barcode ${code}`, scanRes, 200);
  }

  const completeRes = await request('POST', `/v1/whms/scanning/sessions/${sessionId}/complete`, token, {});
  expectStatus('Complete scan session → scanning-done', completeRes, 200);

  await flow(token, orderId, 'sent-to-billing', 'Flow → sent-to-billing');

  const invRes = await request('POST', `/v1/whms/invoices/from-order/${orderId}`, token, {
    rates: [{ styleCode: stock.styleCode, rate: 100 }],
    remarks: 'E2E test invoice',
  });
  if (!expectStatus('Generate invoice → billed', invRes, 201)) {
    await mongoose.disconnect();
    process.exit(1);
  }
  const invoiceId = invRes.data?.id || invRes.data?._id;
  const invoiceNumber = invRes.data?.invoiceNumber || invoiceId;

  const dispatchDetailsRes = await request('PATCH', `/v1/whms/warehouse-orders/${orderId}/dispatch-details`, token, {
    courierName: 'E2E Courier',
    trackingNumber: `AWB-E2E-${Date.now()}`,
    vehicleDetails: 'Truck-01',
    boxCount: 1,
    shippingRemarks: 'E2E dispatch test',
  });
  expectStatus('Dispatch details → ready-to-dispatch', dispatchDetailsRes, 200);

  const shipLabelRes = await request('GET', `/v1/whms/warehouse-orders/${orderId}/shipping-label`, token);
  expectStatus('Shipping label payload', shipLabelRes, 200);

  const packListRes = await request('GET', `/v1/whms/warehouse-orders/${orderId}/packing-list`, token);
  expectStatus('Packing list payload', packListRes, 200);

  const dispatchRes = await request('POST', `/v1/whms/warehouse-orders/${orderId}/dispatch`, token, {
    mode: 'dispatched',
    remarks: 'E2E shipped',
  });
  expectStatus('Dispatch order', dispatchRes, 200);

  const returnCreateRes = await request('POST', '/v1/whms/returns', token, {
    type: 'rtv',
    invoiceId,
    reason: 'courier-rto',
    remarks: 'E2E return test',
  });
  if (!expectStatus('Create return (RTV)', returnCreateRes, 201)) {
    await mongoose.disconnect();
    process.exit(1);
  }
  const returnId = returnCreateRes.data?.id || returnCreateRes.data?._id;
  const returnItems = returnCreateRes.data?.items || [];

  const returnScanRes = await request('POST', `/v1/whms/returns/${returnId}/scan`, token, {
    barcode: stock.styleCode,
    qty: ORDER_QTY,
  });
  expectStatus('Return scan-in', returnScanRes, 200);

  for (const item of returnItems) {
    const itemId = item.id || item._id;
    const patchItemRes = await request('PATCH', `/v1/whms/returns/${returnId}/items/${itemId}`, token, {
      verifiedQty: ORDER_QTY,
      condition: 'saleable',
      decision: 'restock',
    });
    expectStatus(`Return item verify ${item.styleCode}`, patchItemRes, 200);
  }

  const submitRes = await request('POST', `/v1/whms/returns/${returnId}/submit`, token, {});
  expectStatus('Submit return for approval', submitRes, 200);

  const diffRes = await request('GET', `/v1/whms/returns/${returnId}/difference-report`, token);
  expectStatus('Return difference report', diffRes, 200);

  const invBeforeReturn = Number((await WarehouseInventory.findOne({ styleCode: stock.styleCode }).lean())?.totalQuantity || 0);

  const approveRes = await request('POST', `/v1/whms/returns/${returnId}/approve`, token, {});
  expectStatus('Approve return (restock)', approveRes, 200);

  const invAfterReturn = await WarehouseInventory.findOne({ styleCode: stock.styleCode }).lean();
  const restocked = Number(invAfterReturn?.totalQuantity || 0) >= invBeforeReturn + ORDER_QTY - 1;
  record('Inventory restocked after return approve', restocked, `total ${invBeforeReturn} → ${invAfterReturn?.totalQuantity}`);

  const finalOrder = await WarehouseOrder.findById(orderId).select('flowStatus status invoiceId').lean();
  record('Final order flowStatus = dispatched', finalOrder?.flowStatus === 'dispatched', finalOrder?.flowStatus || '');

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log('\n--- Summary ---');
  console.log(`Steps: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Order: ${orderNumber} | Invoice: ${invoiceNumber} | Return approved`);
  console.log(`Production ready: ${failed === 0 ? 'YES (API E2E passed)' : 'NO — fix failures above'}\n`);

  if (failed > 0) {
    console.log('Failed steps:');
    results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.step}: ${r.detail}`));
    console.log('');
  }

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
