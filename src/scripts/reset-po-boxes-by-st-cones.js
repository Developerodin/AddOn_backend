#!/usr/bin/env node

/**
 * Reset YarnBox weight to 0 for a PO when ST cones are already present.
 *
 * This script calls the running backend API:
 *   POST /v1/yarn-management/yarn-boxes/reset-by-st-cones
 *
 * Usage:
 *   node src/scripts/reset-po-boxes-by-st-cones.js --po=PO-2026-1144 --dry-run
 *   node src/scripts/reset-po-boxes-by-st-cones.js --po=PO-2026-1144
 *   node src/scripts/reset-po-boxes-by-st-cones.js --po=PO-2026-1144 --api=http://localhost:8000
 *
 * Notes:
 * - Does NOT require MongoDB access from the script process.
 * - Requires the backend server to be running.
 */

/**
 * Parse CLI args.
 * @param {string[]} argv
 * @returns {{ poNumber: string, apiBaseUrl: string, dryRun: boolean }}
 */
function parseArgs(argv) {
  const out = {
    poNumber: '',
    apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:8000',
    dryRun: false,
  };

  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    if (a.startsWith('--po=')) out.poNumber = String(a.slice('--po='.length)).trim();
    if (a.startsWith('--api=')) out.apiBaseUrl = String(a.slice('--api='.length)).trim();
  }

  return out;
}

/**
 * Get a fetch function (Node 18+ has global fetch; fallback to node-fetch).
 * @returns {Promise<typeof fetch>}
 */
async function getFetch() {
  if (typeof fetch === 'function') return fetch;
  const mod = await import('node-fetch');
  return mod.default;
}

/**
 * Call backend API to reset boxes for PO.
 * @param {Object} params
 * @param {string} params.apiBaseUrl
 * @param {string} params.poNumber
 * @param {boolean} params.dryRun
 * @returns {Promise<any>}
 */
async function resetByApi({ apiBaseUrl, poNumber, dryRun }) {
  const url = `${apiBaseUrl.replace(/\/+$/, '')}/v1/yarn-management/yarn-boxes/reset-by-st-cones`;
  const doFetch = await getFetch();

  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ poNumber, dryRun }),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const msg = json?.message || json?.error || `HTTP ${res.status}`;
    throw new Error(`API error: ${msg}`);
  }

  return json;
}

async function main() {
  const { poNumber, apiBaseUrl, dryRun } = parseArgs(process.argv.slice(2));

  if (!poNumber) {
    console.error('Missing required flag: --po=PO_NUMBER');
    process.exitCode = 1;
    return;
  }

  try {
    console.log(`API: ${apiBaseUrl}`);
    console.log(`PO: ${poNumber}`);
    console.log(`dryRun: ${dryRun}`);
    const result = await resetByApi({ apiBaseUrl, poNumber, dryRun });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err?.message || String(err));
    process.exitCode = 1;
  }
}

main();

