#!/usr/bin/env node
/**
 * Full flow test: Order → Branding (partial 20+80) → Final Checking receive + transfer
 * Tests: Branding APPEND transferredData, enrichment, Final Checking receive + transfer
 *
 * Usage: API_URL=http://localhost:8000 TEST_EMAIL=admin@addon.in TEST_PASSWORD=admin@1234 node scripts/test-full-flow-branding-20-80-finalchecking.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import Product from '../src/models/product.model.js';
import Machine from '../src/models/machine.model.js';

const BASE_URL = process.env.API_URL || 'http://localhost:8000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@addon.in';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin@1234';

const log = (msg, data) => {
  console.log(`[${new Date().toISOString()}] ${msg}`, data !== undefined ? JSON.stringify(data) : '');
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(method, path, token, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
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
  console.log('\n=== Full Flow: Branding (20+80) → Final Checking ===\n');

  const loginRes = await request('POST', '/v1/auth/login', null, { email: TEST_EMAIL, password: TEST_PASSWORD });
  if (loginRes.status !== 200) {
    console.error('❌ Login failed');
    process.exit(1);
  }
  const token = loginRes.data?.tokens?.access?.token || loginRes.data?.access?.token;
  const userId = loginRes.data?.user?.id || loginRes.data?.user?._id;
  if (!token) {
    console.error('❌ No token');
    process.exit(1);
  }

  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  const product = await Product.findOne({}).where('factoryCode').exists().ne('');
  const articleNumber = product?.factoryCode || 'A004';
  const machine = await Machine.findOne({ status: { $ne: 'Inactive' } });
  const machineId = machine?._id?.toString();

  const orderRes = await request('POST', '/v1/production/orders', token, {
    priority: 'Medium',
    articles: [{
      articleNumber,
      knittingCode: `FULL-FLOW-${Date.now()}`,
      plannedQuantity: 100,
      linkingType: 'Auto Linking',
      priority: 'Medium',
      remarks: 'Full flow test',
      machineId: machineId || undefined,
    }],
    createdBy: userId,
  });
  if (orderRes.status !== 201 && orderRes.status !== 200) {
    console.error('❌ Create order failed:', orderRes.data);
    process.exit(1);
  }
  const order = orderRes.data;
  const orderId = (order._id || order.id)?.toString();
  const firstArt = order.articles?.[0];
  const articleId = (typeof firstArt === 'string' ? firstArt : (firstArt?._id || firstArt?.id))?.toString();
  if (!orderId || !articleId) {
    console.error('❌ No orderId or articleId');
    process.exit(1);
  }
  log('Order created', { orderId, articleId });

  const floorBase = '/v1/production/floors';
  const articlePath = `/v1/production/articles/${articleId}`;
  const body = (o = {}) => ({ userId, floorSupervisorId: userId, ...o });

  const completeAndTransfer = async (floor, qty) => {
    const fp = floor.replace(/\s/g, '');
    const r = await request('PATCH', `${floorBase}/${fp}/orders/${orderId}/articles/${articleId}`, token, body({ completedQuantity: qty }));
    if (r.status !== 200) throw new Error(`PATCH ${floor}: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };

  const receiveOnFloor = async (floor, qty) => {
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
    for (const floor of ['Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking']) {
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

    // Branding: partial transfer 1 - 20 with styleCode/brand
    log('Branding transfer 1: 20 with styleCode/brand');
    const patch1 = await request('PATCH', `${floorBase}/Branding/orders/${orderId}/articles/${articleId}`, token, body({
      transferredData: [{ transferred: 20, styleCode: 'ABC1SALBA04049', brand: 'Allen Solly' }],
    }));
    if (patch1.status !== 200) throw new Error(`Branding 1: ${patch1.status} ${JSON.stringify(patch1.data)}`);
    await sleep(300);

    // Branding: partial transfer 2 - 80 WITHOUT styleCode/brand (enrich from first)
    log('Branding transfer 2: 80 WITHOUT styleCode/brand (enrich from first)');
    const patch2 = await request('PATCH', `${floorBase}/Branding/orders/${orderId}/articles/${articleId}`, token, body({
      transferredData: [{ transferred: 80 }],
    }));
    if (patch2.status !== 200) throw new Error(`Branding 2: ${patch2.status} ${JSON.stringify(patch2.data)}`);
    await sleep(300);

    let art = (await request('GET', articlePath, token)).data;
    const td = art?.floorQuantities?.branding?.transferredData;
    log('Branding transferredData after 20+80', td);
    if (!td || td.length !== 2) throw new Error(`branding.transferredData expected 2 entries, got ${td?.length}`);
    if (td[0]?.transferred !== 20 || td[1]?.transferred !== 80) throw new Error(`branding.transferredData expected [20,80]`);
    if (!(td[1]?.styleCode || td[1]?.brand)) throw new Error('branding.transferredData[1] missing styleCode/brand');

    // Final Checking: receive 100 (direct - bypasses container for script)
    log('Final Checking - receive 100 (auto from branding.transferredData)');
    await receiveOnFloor('Final Checking', 100);
    await sleep(300);

    art = (await request('GET', articlePath, token)).data;
    const fcReceived = art?.floorQuantities?.finalChecking?.received;
    if (fcReceived !== 100) throw new Error(`finalChecking.received expected 100, got ${fcReceived}`);

    // Final Checking: transfer ALL 100 to Warehouse (transferredData only)
    log('Final Checking - transfer 100 (all quantity to Warehouse)');
    const fcPatch = await request('PATCH', `${floorBase}/FinalChecking/orders/${orderId}/articles/${articleId}`, token, body({
      transferredData: [{ transferred: 100, styleCode: 'ABC1SALBA04049', brand: 'Allen Solly' }],
      repairStatus: 'Not Required',
      repairRemarks: '',
    }));
    if (fcPatch.status !== 200) throw new Error(`Final Checking PATCH: ${fcPatch.status} ${JSON.stringify(fcPatch.data)}`);
    await sleep(300);

    art = (await request('GET', articlePath, token)).data;
    const fcData = art?.floorQuantities?.finalChecking;
    const whData = art?.floorQuantities?.warehouse;
    log('Final Checking after transfer', { transferred: fcData?.transferred, remaining: fcData?.remaining, transferredData: fcData?.transferredData });
    log('Warehouse (container flow: received on container accept)', whData?.received);

    if (fcData?.transferred !== 100) throw new Error(`finalChecking.transferred expected 100, got ${fcData?.transferred}`);
    if (fcData?.remaining !== 0) throw new Error(`finalChecking.remaining expected 0, got ${fcData?.remaining}`);
    if (!fcData?.transferredData?.length) throw new Error('finalChecking.transferredData empty');
    // Warehouse uses container flow - received updates when container accepted; transfer creates containers

    console.log('\n✅ Full flow passed: Branding (20+80) → Final Checking receive + transfer 100 → Warehouse (containers).');
    console.log('   - branding.transferredData: APPEND + enrichment OK');
    console.log('   - finalChecking: receive + transfer OK');
  } catch (err) {
    console.error('\n❌', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
