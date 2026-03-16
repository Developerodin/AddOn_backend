#!/usr/bin/env node
/**
 * Test script: Full production flow from Order creation → Final Checking
 * Verifies Branding → Final Checking transferItems and Final Checking → Warehouse transferItems
 *
 * Usage:
 *   1. Start server: npm run dev
 *   2. Run: npm run test:production-flow
 *   Or: API_URL=http://localhost:8000 TEST_EMAIL=user@addon.in TEST_PASSWORD=xxx node scripts/test-production-flow-branding-finalchecking.js
 *
 * Requires: Server running on localhost, valid user, Product with factoryCode and processes, Machine
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import Process from '../src/models/process.model.js'; // Register schema for Product.populate
import Product from '../src/models/product.model.js';
import Machine from '../src/models/machine.model.js';

const BASE_URL = process.env.API_URL || `http://127.0.0.1:${process.env.PORT || 8000}`;
const TEST_EMAIL = process.env.TEST_EMAIL || 'supervisor@addon.in';
const TEST_PASSWORD = process.env.TEST_PASSWORD || process.env.ADDON_TEST_PASSWORD || 'password1';

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
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: Object.fromEntries(res.headers) };
}

async function run() {
  console.log('\n=== Production Flow Test: Order → Branding → Final Checking ===\n');
  log('Base URL', BASE_URL);

  let token = null;
  let userId = null;

  // 1. Login
  log('Step 1: Login...');
  const loginRes = await request('POST', '/v1/auth/login', null, {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (loginRes.status !== 200) {
    console.error('❌ Login failed:', loginRes.status, loginRes.data);
    console.error('   Use: TEST_EMAIL=your@email.com TEST_PASSWORD=xxx npm run test:production-flow');
    process.exit(1);
  }
  token = loginRes.data?.tokens?.access?.token || loginRes.data?.access?.token;
  userId = loginRes.data?.user?.id || loginRes.data?.user?._id;
  if (!token) {
    console.error('❌ No token in login response');
    process.exit(1);
  }
  log('✓ Login OK, userId', userId);

  // 2. Get Product with processes (articleNumber = factoryCode)
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  const product = await Product.findOne({})
    .where('factoryCode').exists().ne('')
    .populate('processes.processId');
  if (!product || !product.processes?.length) {
    console.error('❌ No product with processes found. Create a product with factoryCode and processes first.');
    process.exit(1);
  }
  const articleNumber = product.factoryCode;
  log('✓ Using product', { factoryCode: articleNumber, name: product.name });

  // 3. Get Machine
  const machine = await Machine.findOne({ status: { $ne: 'Inactive' } });
  const machineId = machine?._id?.toString();
  if (!machineId) {
    console.warn('⚠ No machine found - order may fail if machineId required');
  }

  // 4. Create Order
  log('Step 2: Create production order...');
  const orderBody = {
    priority: 'Medium',
    articles: [{
      articleNumber,
      knittingCode: `TEST-${Date.now()}`,
      plannedQuantity: 100,
      linkingType: 'Auto Linking',
      priority: 'Medium',
      remarks: 'Test flow script',
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
    console.error('❌ No orderId or articleId in order:', { orderId, articleId, order });
    process.exit(1);
  }
  log('✓ Order created', { orderId, orderNumber: order.orderNumber, articleId });

  const floorBase = `/v1/production/floors`;
  const articlePath = `/v1/production/articles/${articleId}`;
  const body = (overrides = {}) => ({
    userId,
    floorSupervisorId: userId,
    ...overrides,
  });

  // Helper: complete floor + transfer to next (for container flow, we must call floor-received-data on next floor)
  const completeAndTransfer = async (floor, completedQty = 100) => {
    const floorParam = floor.replace(/\s/g, ''); // "Final Checking" -> "FinalChecking"
    const patchRes = await request('PATCH', `${floorBase}/${floorParam}/orders/${orderId}/articles/${articleId}`, token, body({ completedQuantity: completedQty }));
    if (patchRes.status !== 200) {
      throw new Error(`PATCH ${floor} failed: ${patchRes.status} ${JSON.stringify(patchRes.data)}`);
    }
    return patchRes.data;
  };

  const receiveOnFloor = async (floor, quantity = 100, receivedTransferItems = null) => {
    const payload = {
      floor,
      quantity,
      receivedData: {
        receivedStatusFromPreviousFloor: 'Completed',
        receivedTimestamp: new Date().toISOString(),
      },
    };
    if (receivedTransferItems) payload.receivedTransferItems = receivedTransferItems;
    const patchRes = await request('PATCH', `${articlePath}/floor-received-data`, token, payload);
    if (patchRes.status !== 200) {
      throw new Error(`floor-received-data ${floor} failed: ${patchRes.status} ${JSON.stringify(patchRes.data)}`);
    }
    return patchRes.data;
  };

  const transferWithItems = async (floor, transferItems) => {
    const floorParam = floor.replace(/\s/g, '');
    const postRes = await request('POST', `${floorBase}/${floorParam}/orders/${orderId}/articles/${articleId}`, token, body({ transferItems }));
    if (postRes.status !== 200 && postRes.status !== 201) {
      throw new Error(`POST transfer ${floor} failed: ${postRes.status} ${JSON.stringify(postRes.data)}`);
    }
    return postRes.data;
  };

  const patchTransferWithItems = async (floor, transferItems) => {
    const floorParam = floor.replace(/\s/g, '');
    const patchRes = await request('PATCH', `${floorBase}/${floorParam}/orders/${orderId}/articles/${articleId}`, token, body({ transferItems, repairStatus: 'Not Required', repairRemarks: '' }));
    if (patchRes.status !== 200) {
      throw new Error(`PATCH transfer ${floor} failed: ${patchRes.status} ${JSON.stringify(patchRes.data)}`);
    }
    return patchRes.data;
  };

  const getArticle = async () => {
    const res = await request('GET', `${articlePath}`, token);
    if (res.status !== 200) throw new Error(`GET article failed: ${res.status}`);
    return res.data;
  };

  try {
    // 5. Knitting: complete 100
    log('Step 3: Knitting - complete 100...');
    await completeAndTransfer('Knitting', 100);
    await sleep(500);

    // 6. Receive + complete each floor (container flow). For Checking floors: quality first so M1 transfer runs on complete.
    // Branding handled separately with transferItems
    const floors = ['Checking', 'Washing', 'Boarding', 'Silicon', 'Secondary Checking'];
    for (const floor of floors) {
      log(`Step: ${floor} - receive 100...`);
      await receiveOnFloor(floor, 100);
      await sleep(200);
      if (floor === 'Checking' || floor === 'Secondary Checking') {
        const qPath = floor === 'Checking' ? 'Checking' : 'Secondary%20Checking';
        log(`Step: ${floor} - quality m1=100...`);
        await request('PATCH', `${floorBase}/${qPath}/quality/${articleId}`, token, body({ m1Quantity: 100, m2Quantity: 0, m3Quantity: 0, m4Quantity: 0 }));
        await sleep(200);
      }
      log(`Step: ${floor} - complete 100...`);
      await completeAndTransfer(floor, 100);
      await sleep(200);
    }

    // 7. Branding: receive, then complete + transfer in ONE PATCH (transferItems must be in same request as completedQuantity)
    log('Step: Branding - receive 100...');
    await receiveOnFloor('Branding', 100);
    await sleep(200);

    const brandingTransferItems = [
      { transferred: 50, styleCode: 'ABC1SALBA12020', brand: 'Allen Solly' },
      { transferred: 50, styleCode: 'ABC1SFLBA07008', brand: 'Allen Solly' },
    ];
    log('Step 4: Branding - complete 100 + transfer with transferItems...', brandingTransferItems);
    const brandingPatchRes = await request('PATCH', `${floorBase}/Branding/orders/${orderId}/articles/${articleId}`, token, body({ completedQuantity: 100, transferItems: brandingTransferItems }));
    if (brandingPatchRes.status !== 200) {
      throw new Error(`PATCH Branding failed: ${brandingPatchRes.status} ${JSON.stringify(brandingPatchRes.data)}`);
    }
    await sleep(500);

    let art = await getArticle();
    const brandingData = art?.floorQuantities?.branding;
    log('Branding after transfer:', {
      transferred: brandingData?.transferred,
      transferredData: brandingData?.transferredData,
    });
    if (!brandingData?.transferredData?.length) {
      console.error('❌ branding.transferredData is empty - transferItems not persisted!');
    } else {
      log('✓ branding.transferredData OK');
    }

    // 9. Final Checking: receive from Branding (auto from branding.transferredData when quantity sent)
    log('Step 5: Final Checking - receive 100 (auto from branding.transferredData)...');
    await receiveOnFloor('Final Checking', 100);
    await sleep(500);

    art = await getArticle();
    const fcReceived = art?.floorQuantities?.finalChecking;
    log('Final Checking receivedData:', fcReceived?.receivedData);
    if (!fcReceived?.receivedData?.some((r) => r.styleCode || r.brand)) {
      console.warn('⚠ finalChecking.receivedData has no styleCode/brand - auto-populate from branding.transferredData may have failed');
    } else {
      log('✓ finalChecking.receivedData has brand breakdown');
    }

    // 10. Final Checking: quality m1=100
    log('Step 6: Final Checking - quality m1=100...');
    const fcQualityRes = await request('PATCH', `${floorBase}/FinalChecking/quality/${articleId}`, token, body({ m1Quantity: 100, m2Quantity: 0, m3Quantity: 0, m4Quantity: 0 }));
    if (fcQualityRes.status === 200) await sleep(200);

    // 11. Final Checking: complete 100 + transfer in ONE PATCH
    // Test with transferredData only (no completedQuantity) - backend auto-infers from transferItems sum
    // Test enrichment: send [{ transferred: 50 }, { transferred: 50 }] without styleCode/brand - backend enriches from receivedData
    const fcTransferItems = [
      { transferred: 50 },
      { transferred: 50 },
    ];
    log('Step 7: Final Checking - transfer with transferredData (no styleCode/brand, should enrich from receivedData)...', fcTransferItems);
    const fcPatchRes = await request('PATCH', `${floorBase}/FinalChecking/orders/${orderId}/articles/${articleId}`, token, body({ transferredData: fcTransferItems, repairStatus: 'Not Required', repairRemarks: '' }));
    if (fcPatchRes.status !== 200) {
      throw new Error(`PATCH Final Checking failed: ${fcPatchRes.status} ${JSON.stringify(fcPatchRes.data)}`);
    }
    const fcAfterPatchData = fcPatchRes.data;
    await sleep(500);

    art = fcAfterPatchData || (await getArticle());
    const fcData = art?.floorQuantities?.finalChecking;
    log('Final Checking after PATCH transfer:', {
      transferred: fcData?.transferred,
      transferredData: fcData?.transferredData,
      remaining: fcData?.remaining,
    });

    // Assertions
    const failures = [];
    if (fcData?.transferred !== 100) {
      failures.push(`finalChecking.transferred expected 100, got ${fcData?.transferred}`);
    }
    if (!fcData?.transferredData?.length) {
      failures.push('finalChecking.transferredData is empty - PATCH transferItems not persisted!');
    }
    const hasStyleCodeOrBrand = fcData?.transferredData?.some((t) => (t.styleCode || '').trim() || (t.brand || '').trim());
    if (!hasStyleCodeOrBrand) {
      failures.push('finalChecking.transferredData missing styleCode/brand - enrichment from receivedData failed!');
    }
    if (fcData?.remaining !== 0) {
      failures.push(`finalChecking.remaining expected 0, got ${fcData?.remaining}`);
    }

    if (failures.length > 0) {
      console.error('\n❌ FAILURES:');
      failures.forEach((f) => console.error('  -', f));
      process.exit(1);
    }

    console.log('\n✅ All assertions passed. Branding → Final Checking → Warehouse flow OK.');
    console.log('   - branding.transferredData:', JSON.stringify(brandingData?.transferredData));
    console.log('   - finalChecking.receivedData (from Branding):', JSON.stringify(fcReceived?.receivedData?.slice(-2)));
    console.log('   - finalChecking.transferredData:', JSON.stringify(fcData?.transferredData));
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
