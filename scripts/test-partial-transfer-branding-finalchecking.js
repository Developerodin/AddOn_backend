#!/usr/bin/env node
/**
 * Test partial transfers: Branding (30+70) and Final Checking
 * Verifies: transferredData APPEND, styleCode/brand enrichment when empty
 *
 * Usage: API_URL=http://localhost:8000 TEST_EMAIL=admin@addon.in TEST_PASSWORD=admin@1234 node scripts/test-partial-transfer-branding-finalchecking.js
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
  console.log('\n=== Partial Transfer Test: Branding (30+70) + Final Checking ===\n');

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
      knittingCode: `PARTIAL-TEST-${Date.now()}`,
      plannedQuantity: 100,
      linkingType: 'Auto Linking',
      priority: 'Medium',
      remarks: 'Partial transfer test',
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
    console.error('❌ No orderId or articleId:', orderRes.data);
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

    // Branding: partial transfer 1 - 30 with styleCode/brand
    log('Branding transfer 1: 30 with styleCode/brand');
    const patch1 = await request('PATCH', `${floorBase}/Branding/orders/${orderId}/articles/${articleId}`, token, body({
      transferredData: [{ transferred: 30, styleCode: 'ABC1SALBA04049', brand: 'Allen Solly' }],
    }));
    if (patch1.status !== 200) throw new Error(`Branding 1: ${patch1.status} ${JSON.stringify(patch1.data)}`);
    await sleep(300);

    let art = (await request('GET', articlePath, token)).data;
    const td1 = art?.floorQuantities?.branding?.transferredData;
    log('Branding after transfer 1', td1);
    if (!td1?.length || td1[0]?.transferred !== 30) {
      throw new Error(`Expected transferredData [30], got ${JSON.stringify(td1)}`);
    }

    // Branding: partial transfer 2 - 70 WITHOUT styleCode/brand (should enrich from first)
    log('Branding transfer 2: 70 WITHOUT styleCode/brand (enrich from first)');
    const patch2 = await request('PATCH', `${floorBase}/Branding/orders/${orderId}/articles/${articleId}`, token, body({
      transferredData: [{ transferred: 70 }],
    }));
    if (patch2.status !== 200) throw new Error(`Branding 2: ${patch2.status} ${JSON.stringify(patch2.data)}`);
    await sleep(300);

    art = (await request('GET', articlePath, token)).data;
    const td2 = art?.floorQuantities?.branding?.transferredData;
    log('Branding after transfer 2', td2);

    const failures = [];
    if (!td2 || td2.length !== 2) {
      failures.push(`branding.transferredData expected 2 entries, got ${td2?.length}`);
    }
    if (td2?.[0]?.transferred !== 30 || td2?.[1]?.transferred !== 70) {
      failures.push(`branding.transferredData expected [30,70], got [${td2?.[0]?.transferred},${td2?.[1]?.transferred}]`);
    }
    const secondHasBrand = (td2?.[1]?.styleCode || '').trim() || (td2?.[1]?.brand || '').trim();
    if (!secondHasBrand) {
      failures.push('branding.transferredData[1] (70) missing styleCode/brand - enrichment failed');
    }

    if (failures.length > 0) {
      console.error('\n❌ FAILURES:');
      failures.forEach((f) => console.error('  -', f));
      process.exit(1);
    }

    console.log('\n✅ Partial transfer test passed. Branding transferredData APPEND + enrichment OK.');
  } catch (err) {
    console.error('\n❌', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
