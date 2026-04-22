#!/usr/bin/env node

/**
 * Backfill LT YarnBox.boxWeight using ST cones via the running backend API.
 *
 * This avoids MongoDB connection string issues in standalone scripts because the server
 * already has a working DB connection.
 *
 * Calls:
 *   POST /v1/yarn-management/yarn-boxes/backfill-lt-weight-from-st-cones
 *
 * Usage:
 *   node src/scripts/backfill-lt-boxweight-from-st-cones-via-api.js --dry-run
 *   node src/scripts/backfill-lt-boxweight-from-st-cones-via-api.js --limit=2000
 *   node src/scripts/backfill-lt-boxweight-from-st-cones-via-api.js --only-box=BOX-... --dry-run --api=http://localhost:8000
 */

/**
 * @param {string[]} argv
 * @returns {{ apiBaseUrl: string, dryRun: boolean, limit?: number, onlyBoxId?: string }}
 */
function parseArgs(argv) {
  /** @type {{ apiBaseUrl: string, dryRun: boolean, limit?: number, onlyBoxId?: string }} */
  const out = {
    apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:8000',
    dryRun: false,
  };

  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    if (a.startsWith('--api=')) out.apiBaseUrl = String(a.slice('--api='.length)).trim();
    if (a.startsWith('--limit=')) out.limit = Number(a.slice('--limit='.length));
    if (a.startsWith('--only-box=')) out.onlyBoxId = String(a.slice('--only-box='.length)).trim();
  }

  return out;
}

/**
 * @returns {Promise<typeof fetch>}
 */
async function getFetch() {
  if (typeof fetch === 'function') return fetch;
  const mod = await import('node-fetch');
  return mod.default;
}

async function main() {
  const { apiBaseUrl, dryRun, limit, onlyBoxId } = parseArgs(process.argv.slice(2));
  const doFetch = await getFetch();

  const url = `${apiBaseUrl.replace(/\/+$/, '')}/v1/yarn-management/yarn-boxes/backfill-lt-weight-from-st-cones`;

  const body = {
    dryRun,
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
    ...(onlyBoxId ? { onlyBoxId } : {}),
  };

  try {
    console.log(`API: ${apiBaseUrl}`);
    console.log(JSON.stringify(body, null, 2));

    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

    console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    console.error(err?.message || String(err));
    process.exitCode = 1;
  }
}

main();

