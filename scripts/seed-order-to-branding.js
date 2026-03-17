#!/usr/bin/env node
/**
 * Seed script: Create order and progress it to Branding floor (ready for frontend testing)
 * Article will have branding.received=100, branding.completed=0, branding.remaining=100
 *
 * Usage:
 *   1. Start server: npm run dev
 *   2. Run: npm run seed:order-to-branding
 *
 * If login fails (401): override credentials
 *   TEST_EMAIL=your@email.com TEST_PASSWORD=yourpass npm run seed:order-to-branding
 *
 * Create multiple orders:
 *   NUM_ORDERS=5 npm run seed:order-to-branding
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import Process from '../src/models/process.model.js';
import Product from '../src/models/product.model.js';
import Machine from '../src/models/machine.model.js';

// Prefer LOCAL_API_URL for seed scripts (localhost); fallback to API_URL then localhost
const BASE_URL = process.env.LOCAL_API_URL || process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 8000}`;
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@addon.in';
const TEST_PASSWORD = process.env.TEST_PASSWORD || process.env.ADDON_TEST_PASSWORD || 'odin@1234';
const NUM_ORDERS = parseInt(process.env.NUM_ORDERS || '5', 10) || 5;

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
    console.error('❌ Login failed. Ensure server is running and credentials are correct.');
    console.error('   URL:', BASE_URL);
    console.error('   Response:', loginRes.status, loginRes.data?.message || loginRes.data);
    console.error('   Use: API_URL=http://localhost:8000 TEST_EMAIL=admin@addon.in TEST_PASSWORD=odin@1234 npm run seed:order-to-branding');
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

  const floorBase = `/v1/production/floors`;
  const body = (overrides = {}) => ({ userId, floorSupervisorId: userId, ...overrides });

  const createdOrders = [];

  try {
    for (let i = 0; i < NUM_ORDERS; i++) {
      const orderBody = {
        priority: 'Medium',
        articles: [{
          articleNumber,
          knittingCode: `BRANDING-TEST-${Date.now()}-${i + 1}`,
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
      log(`✓ Order ${i + 1}/${NUM_ORDERS} created`, { orderId, orderNumber: order.orderNumber, articleId });

      const articlePath = `/v1/production/articles/${articleId}`;
      const completeAndTransfer = async (floor, qty = 100) => {
        const fp = floor.replace(/\s/g, '');
        const r = await request('PATCH', `${floorBase}/${fp}/orders/${orderId}/articles/${articleId}`, token, body({ completedQuantity: qty }));
        if (r.status !== 200) {
          const errMsg = r.data?.message || r.data?.error || JSON.stringify(r.data);
          throw new Error(`PATCH ${floor}: ${r.status} - ${errMsg}`);
        }
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

      await completeAndTransfer('Knitting', 100);
      await sleep(300);

      // Product flow may skip Silicon; use only floors in product's process flow
      const floors = ['Checking', 'Washing', 'Boarding', 'Secondary Checking'];
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
      createdOrders.push({ orderNumber: order.orderNumber, orderId, articleId, brand });
      log(`✓ Order ${i + 1}/${NUM_ORDERS} at Branding`, { received: brand?.received, completed: brand?.completed, remaining: brand?.remaining });
    }

    console.log('\n✅ Done. Articles ready for Branding frontend testing.');
    createdOrders.forEach((o, i) => {
      console.log(`   ${i + 1}. Order: ${o.orderNumber} (${o.orderId}) | Article: ${o.articleId} | Branding: received=${o.brand?.received}, completed=${o.brand?.completed}, remaining=${o.brand?.remaining}`);
    });
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
