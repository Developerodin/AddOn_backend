/**
 * Helpers for styleCode / brand quantity aggregation on vendor production flows.
 * Used to validate final checking receive vs branding sends and to split dispatch confirm.
 */

import httpStatus from 'http-status';
import ApiError from './ApiError.js';

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

const BRANDING_TYPES = new Set(['Heat Transfer', 'Embroidery']);

/**
 * Normalize branding type from a line or flow fallback.
 * @param {string|undefined|null} brandingType
 * @param {string|undefined|null} [flowFallback]
 * @returns {'Heat Transfer'|'Embroidery'|''}
 */
export function normalizeVendorBrandingType(brandingType, flowFallback) {
  const bt = String(brandingType ?? '').trim();
  if (BRANDING_TYPES.has(bt)) return bt;
  const fb = String(flowFallback ?? '').trim();
  if (BRANDING_TYPES.has(fb)) return fb;
  return '';
}

/**
 * Merge key for branding floor lines — style + brand + brandingType so the same brand can split HT vs Embroidery.
 * @param {string} styleCode
 * @param {string} brand
 * @param {string|undefined|null} brandingType
 * @returns {string}
 */
export function vendorBrandingLineKey(styleCode, brand, brandingType) {
  const bt = normalizeVendorBrandingType(brandingType);
  const base = vendorStyleKey(styleCode, brand);
  return bt ? `${base}${SEP}${bt}` : base;
}

/**
 * Sum `transferred` per branding line key (style + brand + brandingType).
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string, brandingType?: string }>} rows
 * @returns {Map<string, number>}
 */
export function aggregateBrandingTransferredByLineKey(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const t = Number(r?.transferred ?? 0);
    if (!Number.isFinite(t) || t <= 0) continue;
    const k = vendorBrandingLineKey(r?.styleCode, r?.brand, r?.brandingType);
    map.set(k, (map.get(k) || 0) + t);
  }
  return map;
}

/**
 * Resolve a single branding type from delta rows (must be homogeneous for one staging batch).
 * @param {Array<{ transferred?: number, brandingType?: string }>} rows
 * @param {string|undefined|null} [flowFallback]
 * @returns {'Heat Transfer'|'Embroidery'}
 */
export function resolveHomogeneousBrandingTypeFromRows(rows, flowFallback) {
  const types = new Set();
  for (const r of rows || []) {
    const qty = Math.max(0, Number(r?.transferred ?? 0));
    if (qty <= 0) continue;
    const bt = normalizeVendorBrandingType(r?.brandingType, flowFallback);
    if (!bt) {
      throw new Error('MISSING_BRANDING_TYPE');
    }
    types.add(bt);
  }
  if (types.size === 0) {
    const fb = normalizeVendorBrandingType(null, flowFallback);
    if (fb) return fb;
    throw new Error('MISSING_BRANDING_TYPE');
  }
  if (types.size > 1) {
    throw new Error('MIXED_BRANDING_TYPE');
  }
  return [...types][0];
}

/**
 * Infer brandingType for one legacy branding `transferredData` line.
 * @param {Object} row
 * @param {Array<Object>} allRows
 * @param {string|undefined|null} [flowBrandingTypeFallback]
 * @returns {'Heat Transfer'|'Embroidery'}
 */
export function inferBrandingTransferredRowType(row, allRows, flowBrandingTypeFallback) {
  const bt = normalizeVendorBrandingType(row?.brandingType, flowBrandingTypeFallback);
  if (bt) return bt;

  const k = vendorStyleKey(row?.styleCode, row?.brand);
  const hasEmbroiderySibling = (allRows || []).some((r) => {
    if (r === row) return false;
    if (vendorStyleKey(r?.styleCode, r?.brand) !== k) return false;
    return normalizeVendorBrandingType(r?.brandingType) === 'Embroidery';
  });
  if (hasEmbroiderySibling) return 'Heat Transfer';

  return normalizeVendorBrandingType(null, flowBrandingTypeFallback) || 'Heat Transfer';
}

/**
 * Stamp missing `brandingType` on branding floor `transferredData` rows.
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string, brandingType?: string, _id?: unknown }>|undefined} rows
 * @param {string|undefined|null} [flowBrandingTypeFallback]
 * @returns {Array<{ transferred: number, styleCode: string, brand: string, brandingType?: string, _id?: unknown }>}
 */
export function enrichBrandingTransferredDataRows(rows, flowBrandingTypeFallback) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((r) => {
    const o = typeof r?.toObject === 'function' ? r.toObject() : { ...r };
    const existing = normalizeVendorBrandingType(o.brandingType);
    const inferred = existing || inferBrandingTransferredRowType(o, list, flowBrandingTypeFallback);
    const base = {
      styleCode: String(o.styleCode ?? ''),
      brand: String(o.brand ?? ''),
      transferred: Math.max(0, Number(o.transferred ?? 0)),
    };
    if (inferred) base.brandingType = inferred;
    if (o._id != null) base._id = o._id;
    return base;
  });
}

/**
 * Merge branding PATCH `transferredData` by style + brand + brandingType (supports split types for same brand).
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string, brandingType?: string, _id?: unknown }>} existingRows
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string, brandingType?: string }>} incomingRows
 * @param {string|undefined|null} [flowBrandingTypeFallback]
 * @returns {Array<{ transferred: number, styleCode: string, brand: string, brandingType?: string, _id?: unknown }>}
 */
export function mergeBrandingTransferredDataByLineKey(
  existingRows,
  incomingRows,
  flowBrandingTypeFallback
) {
  const existing = Array.isArray(existingRows) ? existingRows : [];
  const incoming = Array.isArray(incomingRows) ? incomingRows : [];

  const cloneRow = (r) => {
    const o = typeof r?.toObject === 'function' ? r.toObject() : { ...r };
    const base = {
      styleCode: String(o.styleCode ?? ''),
      brand: String(o.brand ?? ''),
      transferred: Math.max(0, Number(o.transferred ?? 0)),
    };
    const bt = normalizeVendorBrandingType(o.brandingType);
    if (bt) base.brandingType = bt;
    if (o._id != null) base._id = o._id;
    return base;
  };

  let result = enrichBrandingTransferredDataRows(existing.map(cloneRow), flowBrandingTypeFallback);

  for (const inc of incoming) {
    const qty = Math.max(0, Number(inc?.transferred ?? 0));
    if (qty <= 0) continue;

    const incBt = inferBrandingTransferredRowType(inc, [...result, ...incoming], flowBrandingTypeFallback);
    const incKey = vendorBrandingLineKey(inc?.styleCode, inc?.brand, incBt);
    const isKeyed = incKey !== EMPTY_STYLE_KEY;

    if (isKeyed) {
      const idx = result.findIndex(
        (row) => vendorBrandingLineKey(row.styleCode, row.brand, row.brandingType) === incKey
      );
      if (idx >= 0) {
        result[idx] = {
          ...result[idx],
          transferred: Math.max(0, Number(result[idx].transferred ?? 0)) + qty,
        };
      } else {
        const row = {
          styleCode: String(inc?.styleCode ?? ''),
          brand: String(inc?.brand ?? ''),
          transferred: qty,
          brandingType: incBt,
        };
        result.push(row);
      }
    } else {
      const row = { styleCode: '', brand: '', transferred: qty };
      if (incBt) row.brandingType = incBt;
      result.push(row);
    }
  }

  return enrichBrandingTransferredDataRows(result, flowBrandingTypeFallback);
}

/**
 * Filter branding outbound lines eligible as receive cap for a destination floor.
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string, brandingType?: string }>} rows
 * @param {'reBoarding'|'finalChecking'} destFloorKey
 * @param {string|undefined|null} [flowBrandingTypeFallback]
 * @returns {Array<{ transferred: number, styleCode: string, brand: string, brandingType?: string }>}
 */
export function filterBrandingOutboundForDestination(rows, destFloorKey, flowBrandingTypeFallback) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((row) => {
    const bt = normalizeVendorBrandingType(row?.brandingType, flowBrandingTypeFallback) || 'Heat Transfer';
    if (destFloorKey === 'reBoarding') return bt === 'Embroidery';
    if (destFloorKey === 'finalChecking') return bt === 'Heat Transfer';
    return true;
  });
}

/**
 * Sum finalChecking `receivedData` already credited from one upstream floor (HT vs Embroidery).
 * Legacy rows without `brandingType` count toward branding (HT) only when HT outbound exists for that style key.
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string, brandingType?: string }>|undefined} receivedData
 * @param {'branding'|'reBoarding'} sourceFloorKey
 * @param {Map<string, number>} htBrandingOutboundToFc - branding HT lines sent toward final checking
 * @returns {Map<string, number>}
 */
export function aggregateFinalCheckingReceivedForSourceCap(receivedData, sourceFloorKey, htBrandingOutboundToFc) {
  const htOutbound = htBrandingOutboundToFc || new Map();
  const map = new Map();
  for (const r of receivedData || []) {
    const qty = Number(r?.transferred ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const k = vendorStyleKey(r?.styleCode, r?.brand);
    const bt = normalizeVendorBrandingType(r?.brandingType);

    if (sourceFloorKey === 'reBoarding') {
      if (bt === 'Heat Transfer') continue;
      if (bt === 'Embroidery') {
        map.set(k, (map.get(k) || 0) + qty);
      }
      continue;
    }

    if (bt === 'Embroidery') continue;
    if (bt === 'Heat Transfer' || (!bt && htOutbound.has(k))) {
      map.set(k, (map.get(k) || 0) + qty);
    }
  }
  return map;
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
 * Collapse `transferredData` lines to one row per style+brand (drops per-channel brandingType).
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string, brandingType?: string, _id?: unknown }>} rows
 * @returns {Array<{ transferred: number, styleCode: string, brand: string, _id?: unknown }>}
 */
export function consolidateTransferredDataByStyleKey(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const map = new Map();
  const unkeyed = [];

  for (const r of list) {
    const o = typeof r?.toObject === 'function' ? r.toObject() : { ...r };
    const qty = Math.max(0, Number(o.transferred ?? 0));
    if (qty <= 0) continue;
    const key = vendorStyleKey(o.styleCode, o.brand);
    if (key === EMPTY_STYLE_KEY) {
      const row = {
        styleCode: String(o.styleCode ?? ''),
        brand: String(o.brand ?? ''),
        transferred: qty,
      };
      if (o._id != null) row._id = o._id;
      unkeyed.push(row);
      continue;
    }
    const prev = map.get(key);
    if (prev) {
      prev.transferred += qty;
      continue;
    }
    const row = {
      styleCode: String(o.styleCode ?? '').trim(),
      brand: String(o.brand ?? '').trim(),
      transferred: qty,
    };
    if (o._id != null) row._id = o._id;
    map.set(key, row);
  }

  return [...map.values(), ...unkeyed];
}

/**
 * Build HT (branding) and Embroidery (re-boarding) outbound maps toward final checking.
 * @param {Object} flow - Vendor production flow document
 * @returns {{ htOutbound: Map<string, number>, rbOutbound: Map<string, number> }}
 */
export function buildFinalCheckingOutboundMaps(flow) {
  const branding = flow?.floorQuantities?.branding || {};
  const reBoarding = flow?.floorQuantities?.reBoarding || {};
  const htRows = filterBrandingOutboundForDestination(
    branding.transferredData,
    'finalChecking',
    flow?.brandingType
  );
  return {
    htOutbound: aggregateTransferredByStyleKey(htRows),
    rbOutbound: aggregateTransferredByStyleKey(reBoarding.transferredData),
  };
}

/**
 * Stamp `brandingType` on legacy finalChecking `receivedData` lines using upstream outbound ledgers.
 * Matches receive-cap rules: legacy untagged lines count as HT when HT branding outbound exists.
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string, brandingType?: string }>|undefined} receivedData
 * @param {Map<string, number>} htOutboundMap - branding HT outbound per style key
 * @param {Map<string, number>} rbOutboundMap - re-boarding outbound per style key
 * @returns {Array<{ transferred: number, styleCode: string, brand: string, brandingType?: string }>}
 */
export function inferFinalCheckingReceivedDataBrandingTypes(receivedData, htOutboundMap, rbOutboundMap) {
  const htOutbound = htOutboundMap || new Map();
  const rbOutbound = rbOutboundMap || new Map();
  const htAssigned = new Map();
  const rbAssigned = new Map();

  for (const r of receivedData || []) {
    const bt = normalizeVendorBrandingType(r?.brandingType);
    if (!bt) continue;
    const k = vendorStyleKey(r?.styleCode, r?.brand);
    const qty = Math.max(0, Number(r?.transferred ?? 0));
    if (bt === 'Heat Transfer') htAssigned.set(k, (htAssigned.get(k) || 0) + qty);
    if (bt === 'Embroidery') rbAssigned.set(k, (rbAssigned.get(k) || 0) + qty);
  }

  return (receivedData || []).map((r) => {
    const bt = normalizeVendorBrandingType(r?.brandingType);
    if (bt) {
      return {
        transferred: Math.max(0, Number(r?.transferred ?? 0)),
        styleCode: String(r?.styleCode ?? ''),
        brand: String(r?.brand ?? ''),
        brandingType: bt,
      };
    }

    const k = vendorStyleKey(r?.styleCode, r?.brand);
    const qty = Math.max(0, Number(r?.transferred ?? 0));
    const htCap = htOutbound.get(k) || 0;
    const rbCap = rbOutbound.get(k) || 0;
    const htUsed = htAssigned.get(k) || 0;
    const rbUsed = rbAssigned.get(k) || 0;
    const htRemain = Math.max(0, htCap - htUsed);
    const rbRemain = Math.max(0, rbCap - rbUsed);

    const line = {
      transferred: qty,
      styleCode: String(r?.styleCode ?? ''),
      brand: String(r?.brand ?? ''),
    };

    let inferred = '';
    if (htRemain > 0 && htCap > 0 && (rbRemain <= 0 || htRemain >= qty || rbRemain < qty)) {
      inferred = 'Heat Transfer';
      htAssigned.set(k, htUsed + qty);
    } else if (rbRemain > 0 && rbCap > 0) {
      inferred = 'Embroidery';
      rbAssigned.set(k, rbUsed + qty);
    } else if (htCap > htUsed && htCap > 0) {
      inferred = 'Heat Transfer';
      htAssigned.set(k, htUsed + qty);
    }

    if (inferred) line.brandingType = inferred;
    return line;
  });
}

/**
 * Enrich receivedData with inferred brandingType for channel caps and display.
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string, brandingType?: string }>|undefined} receivedData
 * @param {Object} flow
 * @returns {Array<{ transferred: number, styleCode: string, brand: string, brandingType?: string }>}
 */
export function enrichReceivedDataForFinalCheckingChannelCap(receivedData, flow) {
  if (!flow) return Array.isArray(receivedData) ? receivedData : [];
  const { htOutbound, rbOutbound } = buildFinalCheckingOutboundMaps(flow);
  return inferFinalCheckingReceivedDataBrandingTypes(receivedData, htOutbound, rbOutbound);
}

/**
 * Inbound received cap for one final-checking transferred line (per channel, or total for legacy).
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string, brandingType?: string }>|undefined} receivedData
 * @param {string} styleCode
 * @param {string} brand
 * @param {string|undefined|null} brandingType
 * @returns {number}
 */
function inboundCapForFinalCheckingLine(receivedData, styleCode, brand, brandingType) {
  const styleKey = vendorStyleKey(styleCode, brand);
  const bt = normalizeVendorBrandingType(brandingType);
  const list = Array.isArray(receivedData) ? receivedData : [];

  if (!bt) {
    let sum = 0;
    for (const r of list) {
      if (vendorStyleKey(r?.styleCode, r?.brand) !== styleKey) continue;
      const t = Number(r?.transferred ?? 0);
      if (Number.isFinite(t) && t > 0) sum += t;
    }
    return sum;
  }

  let sum = 0;
  for (const r of list) {
    if (vendorStyleKey(r?.styleCode, r?.brand) !== styleKey) continue;
    if (normalizeVendorBrandingType(r?.brandingType) !== bt) continue;
    const t = Number(r?.transferred ?? 0);
    if (Number.isFinite(t) && t > 0) sum += t;
  }
  return sum;
}

/**
 * Assert final checking `transferredData` (post-merge) does not exceed total inbound per style+brand.
 * HT and Embroidery inbound for the same brand are combined into one cap.
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string, brandingType?: string }>} transferredRows
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string, brandingType?: string }>|undefined} receivedData
 * @param {Object} [flow] - When provided, enriches legacy receivedData for inbound totals
 */
export function assertFinalCheckingTransferredWithinInboundChannelCap(transferredRows, receivedData, flow) {
  const lines = Array.isArray(transferredRows) ? transferredRows : [];
  const received = flow
    ? enrichReceivedDataForFinalCheckingChannelCap(receivedData, flow)
    : Array.isArray(receivedData)
      ? receivedData
      : [];
  if (!lines.length || !received.length) return;

  const totals = new Map();
  const sampleByKey = new Map();

  for (const r of lines) {
    const qty = Math.max(0, Number(r?.transferred ?? 0));
    if (qty <= 0) continue;
    const key = vendorStyleKey(r?.styleCode, r?.brand);
    totals.set(key, (totals.get(key) || 0) + qty);
    if (!sampleByKey.has(key)) sampleByKey.set(key, r);
  }

  for (const [key, qty] of totals) {
    const sample = sampleByKey.get(key) || {};
    const cap = inboundCapForFinalCheckingLine(received, sample.styleCode, sample.brand, null);
    if (qty > cap + 1e-6) {
      const label = sample.brand || key;
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Final checking M1 for ${label} (${qty}) exceeds total inbound received (${cap}).`
      );
    }
  }
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
