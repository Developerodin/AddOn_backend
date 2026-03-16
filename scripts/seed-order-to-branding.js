#!/usr/bin/env node
/**
 * Seed script: Create order and progress it to Branding floor (ready for frontend testing)
 * Article will have branding.received=100, branding.completed=0, branding.remaining=100
 *
 * Usage:
 *   1. Start server: npm run dev
 *   2. Run: npm run seed:order-to-branding
 *   Or: API_URL=http://localhost:8000 TEST_EMAIL=admin@addon.in TEST_PASSWORD=admin@1234 node scripts/seed-order-to-branding.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import Process from '../src/models/process.model.js';
import Product from '../src/models/product.model.js';
import Machine from '../src/models/machine.model.js';

const BASE_URL = process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 8000}`;
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@addon.in';
const TEST_PASSWORD = process.env.TEST_PASSWORD || process.env.ADDON_TEST_PASSWORD || 'admin@1234';

const log = (msg, data) => {
  console.log(`[${new Date().toISOString()}] ${msg}`, data !== undefined ? (typeof data === 'object' ? JSON.stringify(data, null, 2) : data) : '');
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function run() {
  console.log('\n=== Seed Order to Branding Floor ===\n');
  log('Base URL', BASE_URL);

  const loginRes = await request('POST', '/v1/auth/login', null, {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (loginRes.status !== 200) {
    console.error('❌ Login failed. Use:', 'TEST_EMAIL=your@email.com TEST_PASSWORD=xxx npm run seed:order-to-branding');
    process.exit(1);
  }
  const token = loginRes.data?.tokens?.access?.token || loginRes.data?.access?.token;
  const userId = loginRes.data?.user?.id || loginRes.data?.user?._id;
  if (!token) {
    console.error('❌ No token in login response');
    process.exit(1);
  }
  log('✓ Login OK');

  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  const product = await Product.findOne({}).where('factoryCode').exists().ne('').populate('processes.processId');
  if (!product || !product.processes?.length) {
    console.error('❌ No product with processes found.');
    process.exit(1);
  }
  const articleNumber = product.factoryCode;
  const machine = await Machine.findOne({ status: { $ne: 'Inactive' } });
  const machineId = machine?._id?.toString();

  const orderBody = {
    priority: 'Medium',
    articles: [{
      articleNumber,
      knittingCode: `BRANDING-TEST-${Date.now()}`,
      plannedQuantity: 100,
      linkingType: 'Auto Linking',
      priority: 'Medium',
      remarks: 'Test Branding frontend',
      machineId: machineId || undefined,
    }],
    createdBy: userId,
  };
  const createRes = await request('POST', '/v1/production/orders', token, orderBody);
  if (createRes.status !== 201 && createRes.status !== 200) {
    console.error('❌ Create order failed:', createRes.status, createRes.data);
    process.exit(1);
  }
  const order = createRes.data;
  const orderId = (order._id || order.id)?.toString();
  const articleId = (order.articles?.[0]?._id || order.articles?.[0]?.id || order.articles?.[0])?.toString();
  if (!orderId || !articleId) {
    console.error('❌ No orderId or articleId');
    process.exit(1);
  }
  log('✓ Order created', { orderId, orderNumber: order.orderNumber, articleId });

  const floorBase = `/v1/production/floors`;
  const articlePath = `/v1/production/articles/${articleId}`;
  const body = (overrides = {}) => ({ userId, floorSupervisorId: userId, ...overrides });

  const completeAndTransfer = async (floor, qty = 100) => {
    const fp = floor.replace(/\s/g, '');
    const r = await request('PATCH', `${floorBase}/${fp}/orders/${orderId}/articles/${articleId}`, token, body({ completedQuantity: qty }));
    if (r.status !== 200) throw new Error(`PATCH ${floor}: ${r.status}`);
    return r.data;
  };

  const receiveOnFloor = async (floor, qty = 100) => {
    const r = await request('PATCH', `${articlePath}/floor-received-data`, token, {
      floor,
      quantity: qty,
      receivedData: { receivedStatusFromPreviousFloor: 'Completed', receivedTimestamp: new Date().toISOString() },
    });
    if (r.status !== 200) throw new Error(`receive ${floor}: ${r.status}`);
    return r.data;
  };

  try {
    await completeAndTransfer('Knitting', 100);
    await sleep(300);

    const floors = ['Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking'];
    for (const floor of floors) {
      await receiveOnFloor(floor, 100);
      await sleep(150);
      if (floor === 'Checking' || floor === 'Secondary Checking') {
        const qPath = floor === 'Checking' ? 'Checking' : 'Secondary%20Checking';
        await request('PATCH', `${floorBase}/${qPath}/quality/${articleId}`, token, body({ m1Quantity: 100, m2Quantity: 0, m3Quantity: 0, m4Quantity: 0 }));
        await sleep(150);
      }
      await completeAndTransfer(floor, 100);
      await sleep(150);
    }

    await receiveOnFloor('Branding', 100);
    await sleep(300);

    const art = (await request('GET', articlePath, token)).data;
    const brand = art?.floorQuantities?.branding;
    log('✓ Article at Branding floor', {
      received: brand?.received,
      completed: brand?.completed,
      remaining: brand?.remaining,
    });

    console.log('\n✅ Done. Article ready for Branding frontend testing.');
    console.log(`   Order: ${order.orderNumber} (${orderId})`);
    console.log(`   Article: ${articleId}`);
    console.log(`   Branding: received=${brand?.received}, completed=${brand?.completed}, remaining=${brand?.remaining}`);
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
