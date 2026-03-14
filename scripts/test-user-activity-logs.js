#!/usr/bin/env node
/**
 * Test script for User Activity Logs API
 *
 * Usage:
 *   1. Start server: npm run dev
 *   2. Run: npm run test:activity-logs
 *   Or: TEST_EMAIL=user@addon.in TEST_PASSWORD=xxx node scripts/test-user-activity-logs.js
 *
 * Requires: Server running, valid user credentials (default: supervisor@addon.in / password1)
 */
import 'dotenv/config';

const BASE_URL = process.env.API_URL || `http://localhost:${process.env.PORT || 8000}`;
const TEST_EMAIL = process.env.TEST_EMAIL || 'supervisor@addon.in';
const TEST_PASSWORD = process.env.TEST_PASSWORD || process.env.ADDON_TEST_PASSWORD || 'password1';

const log = (msg, data) => {
  console.log(`[${new Date().toISOString()}] ${msg}`, data !== undefined ? JSON.stringify(data, null, 2) : '');
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
  console.log('\n=== User Activity Logs API Test ===\n');
  log('Base URL', BASE_URL);
  log('Test user', TEST_EMAIL);

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
    console.error('   Use TEST_EMAIL and TEST_PASSWORD env vars for valid credentials');
    process.exit(1);
  }
  token = loginRes.data?.tokens?.access?.token || loginRes.data?.access?.token;
  userId = loginRes.data?.user?.id || loginRes.data?.user?._id;
  if (!token) {
    console.error('❌ No token in login response:', loginRes.data);
    process.exit(1);
  }
  log('✓ Login OK, userId', userId);

  // 2. Make API calls that should be logged
  const testCalls = [
    { method: 'GET', path: '/v1/users/me' },
    { method: 'GET', path: '/v1/yarn-management/yarn-transactions/yarn-issued' },
    { method: 'GET', path: '/v1/users?limit=5&page=1' },
  ];

  log('Step 2: Making API calls with token...');
  for (const call of testCalls) {
    const r = await request(call.method, call.path, token);
    log(`  ${call.method} ${call.path} -> ${r.status}`);
  }

  // 3. Wait for async log writes
  log('Step 3: Waiting 2s for async log writes...');
  await sleep(2000);

  // 4. Fetch activity logs (no date filter to get recent)
  log('Step 4: Fetching activity logs...');
  const logsRes = await request(
    'GET',
    `/v1/user-activity-logs/me?page=1&limit=20`,
    token
  );

  if (logsRes.status !== 200) {
    console.error('❌ Failed to fetch logs:', logsRes.status, logsRes.data);
    process.exit(1);
  }

  const { results = [], totalResults = 0 } = logsRes.data;
  log('Step 5: Results', { totalResults, count: results.length });

  if (totalResults === 0) {
    console.error('\n❌ NO LOGS CREATED - Activity logging is NOT working');
    console.error('   Possible causes:');
    console.error('   1. optionalAuth not setting req.user (JWT not decoded)');
    console.error('   2. userActivityLog middleware not running');
    console.error('   3. UserActivityLog.create failing silently');
    console.error('\n   Check server console for [userActivityLog] Skip or Failed messages');
    process.exit(1);
  }

  log('✓ Logs found', totalResults);
  results.slice(0, 5).forEach((l, i) => {
    console.log(`   ${i + 1}. ${l.method} ${l.path} ${l.statusCode} ${l.action} ${l.resource}`);
  });

  // 5. Test stats
  log('Step 6: Fetching stats...');
  const statsRes = await request('GET', '/v1/user-activity-logs/me/stats', token);
  if (statsRes.status === 200) {
    log('✓ Stats', statsRes.data?.totals);
  }

  console.log('\n=== All tests passed ===\n');
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
