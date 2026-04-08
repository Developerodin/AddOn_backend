/**
 * Helpers for styleCode / brand quantity aggregation on vendor production flows.
 * Used to validate final checking receive vs branding sends and to split dispatch confirm.
 */

const SEP = '\u0001';

/** Stable key for matching lines across floors (avoids ambiguity if styleCode contains "|") */
export function vendorStyleKey(styleCode, brand) {
  return `${String(styleCode ?? '').trim()}${SEP}${String(brand ?? '').trim()}`;
}

/** Parse key from {@link vendorStyleKey} */
export function parseVendorStyleKey(k) {
  const s = String(k ?? '');
  const i = s.indexOf(SEP);
  if (i < 0) return { styleCode: s, brand: '' };
  return { styleCode: s.slice(0, i), brand: s.slice(i + SEP.length) };
}

/**
 * Sum `transferred` per style key from rows like `transferredData` / `receivedData` (branding shape).
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} rows
 * @returns {Map<string, number>}
 */
export function aggregateTransferredByStyleKey(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const t = Number(r?.transferred ?? 0);
    if (!Number.isFinite(t) || t <= 0) continue;
    const k = vendorStyleKey(r?.styleCode, r?.brand);
    map.set(k, (map.get(k) || 0) + t);
  }
  return map;
}

/**
 * Split integer `total` across `weights` (same length) proportionally; remainder distributed round-robin.
 * @param {number} total
 * @param {number[]} weights — non-negative, sum > 0
 * @returns {number[]}
 */
export function splitIntegerByWeights(total, weights) {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = weights.reduce((a, b) => a + Math.max(0, Number(b) || 0), 0);
  if (sumW <= 0) {
    const z = Array(n).fill(0);
    let d = Math.max(0, Math.floor(total));
    for (let i = 0; d > 0; i += 1) {
      z[i % n] += 1;
      d -= 1;
    }
    return z;
  }
  const w = weights.map((x) => Math.max(0, Number(x) || 0));
  const raw = w.map((wi) => Math.floor((total * wi) / sumW));
  let diff = Math.max(0, Math.floor(total)) - raw.reduce((a, b) => a + b, 0);
  let i = 0;
  while (diff > 0) {
    raw[i % n] += 1;
    diff -= 1;
    i += 1;
  }
  return raw;
}
