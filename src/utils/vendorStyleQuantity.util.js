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

const EMPTY_STYLE_KEY = vendorStyleKey('', '');

/**
 * Merge PATCH `transferredData` into stored rows (vendor branding / final checking).
 * - **Keyed** (`styleCode` / `brand` not both blank after trim): add `transferred` onto the first
 *   matching line, or append a new line if that style key is new.
 * - **Unkeyed** (both blank): always **append** a new line (unattributed partial qty), same as before.
 *
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string, _id?: unknown }>} existingRows
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} incomingRows
 * @returns {Array<{ transferred: number, styleCode: string, brand: string, _id?: unknown }>}
 */
export function mergeTransferredDataByStyleKey(existingRows, incomingRows) {
  const existing = Array.isArray(existingRows) ? existingRows : [];
  const incoming = Array.isArray(incomingRows) ? incomingRows : [];

  const cloneRow = (r) => {
    const o = typeof r?.toObject === 'function' ? r.toObject() : { ...r };
    const base = {
      styleCode: String(o.styleCode ?? ''),
      brand: String(o.brand ?? ''),
      transferred: Math.max(0, Number(o.transferred ?? 0)),
    };
    if (o._id != null) {
      base._id = o._id;
    }
    return base;
  };

  const result = existing.map(cloneRow);

  for (const inc of incoming) {
    const qty = Math.max(0, Number(inc?.transferred ?? 0));
    if (qty <= 0) continue;

    const incKey = vendorStyleKey(inc?.styleCode, inc?.brand);
    const isKeyed = incKey !== EMPTY_STYLE_KEY;

    if (isKeyed) {
      const idx = result.findIndex((row) => vendorStyleKey(row.styleCode, row.brand) === incKey);
      if (idx >= 0) {
        result[idx] = {
          ...result[idx],
          transferred: Math.max(0, Number(result[idx].transferred ?? 0)) + qty,
        };
      } else {
        result.push({
          styleCode: String(inc?.styleCode ?? ''),
          brand: String(inc?.brand ?? ''),
          transferred: qty,
        });
      }
    } else {
      result.push({
        styleCode: '',
        brand: '',
        transferred: qty,
      });
    }
  }

  return result;
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
