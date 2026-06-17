/**
 * Brand-only quantity helpers for factory production floor transfers.
 */

/**
 * Normalizes brand for map keys (trim + lowercase).
 * @param {string|null|undefined} brand
 * @returns {string}
 */
export function brandKey(brand) {
  return String(brand ?? '').trim().toLowerCase();
}

/**
 * Whether two transfer rows match on brand (styleCode ignored when either side is blank).
 * @param {{ styleCode?: string, brand?: string }} a
 * @param {{ styleCode?: string, brand?: string }} b
 * @returns {boolean}
 */
export function rowsMatchByBrand(a, b) {
  const brandA = brandKey(a?.brand);
  const brandB = brandKey(b?.brand);
  if (!brandA || !brandB) return false;
  return brandA === brandB;
}

/**
 * Sum transferred qty grouped by brand (ignores styleCode).
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} rows
 * @returns {Map<string, number>} key = normalized brand, value = qty
 */
export function aggregateByBrand(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const qty = Number(r?.transferred ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const key = brandKey(r?.brand);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + qty);
  }
  return map;
}

/**
 * Merge incoming brand-keyed transfer rows into existing (styleCode stored as empty).
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string, _id?: unknown }>} existingRows
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} incomingRows
 * @returns {Array<{ transferred: number, styleCode: string, brand: string, _id?: unknown }>}
 */
export function mergeTransferredDataByBrand(existingRows, incomingRows) {
  const existing = Array.isArray(existingRows) ? existingRows : [];
  const incoming = Array.isArray(incomingRows) ? incomingRows : [];

  const cloneRow = (r) => {
    const o = typeof r?.toObject === 'function' ? r.toObject() : { ...r };
    const base = {
      styleCode: '',
      brand: String(o.brand ?? '').trim(),
      transferred: Math.max(0, Number(o.transferred ?? 0)),
    };
    if (o._id != null) base._id = o._id;
    return base;
  };

  const collapsed = new Map();
  for (const row of existing.map(cloneRow)) {
    const key = brandKey(row.brand);
    if (!key) continue;
    collapsed.set(key, {
      ...row,
      brand: row.brand,
      styleCode: '',
      transferred: (collapsed.get(key)?.transferred ?? 0) + row.transferred,
    });
  }

  for (const inc of incoming) {
    const qty = Math.max(0, Number(inc?.transferred ?? 0));
    if (qty <= 0) continue;
    const brand = String(inc?.brand ?? '').trim();
    const key = brandKey(brand);
    if (!key) continue;
    const prev = collapsed.get(key);
    if (prev) {
      collapsed.set(key, { ...prev, transferred: prev.transferred + qty });
    } else {
      collapsed.set(key, { styleCode: '', brand, transferred: qty });
    }
  }

  return Array.from(collapsed.values());
}

/**
 * Subtract brand-keyed transfer rows from existing transferredData (inverse of merge).
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string, _id?: unknown }>} existingRows
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} rowsToSubtract
 * @returns {Array<{ transferred: number, styleCode: string, brand: string, _id?: unknown }>}
 */
export function subtractTransferredDataByBrand(existingRows, rowsToSubtract) {
  const existing = Array.isArray(existingRows) ? existingRows : [];
  const incoming = Array.isArray(rowsToSubtract) ? rowsToSubtract : [];

  const cloneRow = (r) => {
    const o = typeof r?.toObject === 'function' ? r.toObject() : { ...r };
    const base = {
      styleCode: '',
      brand: String(o.brand ?? '').trim(),
      transferred: Math.max(0, Number(o.transferred ?? 0)),
    };
    if (o._id != null) base._id = o._id;
    return base;
  };

  const collapsed = new Map();
  for (const row of existing.map(cloneRow)) {
    const key = brandKey(row.brand);
    if (!key) continue;
    collapsed.set(key, {
      ...row,
      brand: row.brand,
      styleCode: '',
      transferred: (collapsed.get(key)?.transferred ?? 0) + row.transferred,
    });
  }

  for (const dec of incoming) {
    const qty = Math.max(0, Number(dec?.transferred ?? 0));
    if (qty <= 0) continue;
    const brand = String(dec?.brand ?? '').trim();
    const key = brandKey(brand);
    if (!key) continue;
    const prev = collapsed.get(key);
    if (!prev) continue;
    const nextQty = Math.max(0, prev.transferred - qty);
    if (nextQty <= 0) {
      collapsed.delete(key);
    } else {
      collapsed.set(key, { ...prev, transferred: nextQty });
    }
  }

  return Array.from(collapsed.values());
}

/**
 * Build per-brand budget from receivedData minus transferredData.
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} receivedData
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} transferredData
 * @returns {Map<string, { brand: string, remaining: number }>}
 */
export function buildBrandBudgetFromReceived(receivedData, transferredData) {
  const received = aggregateByBrand(receivedData);
  const transferred = aggregateByBrand(transferredData);
  const budget = new Map();
  for (const [key, qty] of received.entries()) {
    const displayBrand = (receivedData || []).find((r) => brandKey(r?.brand) === key)?.brand;
    const remaining = Math.max(0, qty - (transferred.get(key) || 0));
    budget.set(key, { brand: String(displayBrand ?? key).trim(), remaining });
  }
  return budget;
}

const FINAL_CHECKING_LABEL = 'Final Checking';

/**
 * Extract brand from a styleCodes entry (populated StyleCode doc or plain object).
 * @param {unknown} sc
 * @returns {string}
 */
function brandFromStyleCodeEntry(sc) {
  if (sc == null || typeof sc !== 'object') return '';
  const o = /** @type {{ brand?: string }} */ (sc);
  return String(o.brand ?? '').trim();
}

/**
 * Unique display brand names from product styleCodes entries.
 * @param {Array<{ brand?: string, styleCode?: unknown }>|undefined|null} styleCodes
 * @returns {string[]}
 */
export function extractBrandsFromProductStyleCodes(styleCodes) {
  const seen = new Set();
  const brands = [];
  for (const sc of styleCodes || []) {
    const brand = brandFromStyleCodeEntry(sc);
    if (!brand) continue;
    const key = brandKey(brand);
    if (seen.has(key)) continue;
    seen.add(key);
    brands.push(brand);
  }
  return brands;
}

/**
 * Whether Final Checking receivedData has brand breakdown rows.
 * @param {Object} article
 * @returns {boolean}
 */
export function finalCheckingHasBrandReceivedData(article) {
  const receivedData = article?.floorQuantities?.finalChecking?.receivedData;
  if (!Array.isArray(receivedData)) return false;
  return receivedData.some(
    (r) => (Number(r?.transferred ?? 0) > 0) && brandKey(r?.brand)
  );
}

/**
 * Whether article process includes a branding floor.
 * @param {string[]} floorOrder
 * @returns {boolean}
 */
export function articleHasBrandingInProcess(floorOrder) {
  if (!Array.isArray(floorOrder)) return false;
  return floorOrder.includes('Branding') || floorOrder.includes('Re-Boarding');
}

/**
 * Resolve M2→M1 merge brand requirements (floor budget vs product catalog fallback).
 * @param {Object} article
 * @param {string[]} cascadeFloors
 * @param {string[]} floorOrder - from article.getFloorOrder()
 * @param {Array<{ brand?: string }>|undefined|null} productStyleCodes
 * @returns {{
 *   required: boolean,
 *   budgetMode: 'none'|'floor'|'product',
 *   multiBrand: boolean,
 *   autoAssignBrand: string|null,
 *   productBrands: string[],
 *   receivedData: Array,
 *   transferredData: Array,
 * }}
 */
export function resolveM2MergeBrandContext(article, cascadeFloors, floorOrder, productStyleCodes) {
  const empty = {
    required: false,
    budgetMode: 'none',
    multiBrand: false,
    autoAssignBrand: null,
    productBrands: [],
    receivedData: [],
    transferredData: [],
  };

  if (!Array.isArray(cascadeFloors) || !cascadeFloors.includes(FINAL_CHECKING_LABEL)) {
    return empty;
  }
  if (!articleHasBrandingInProcess(floorOrder)) {
    return empty;
  }

  const productBrands = extractBrandsFromProductStyleCodes(productStyleCodes);
  if (productBrands.length === 0) {
    return empty;
  }

  const fcData = article?.floorQuantities?.finalChecking;
  const receivedData = fcData?.receivedData || [];
  const transferredData = fcData?.transferredData || [];
  const hasFloorBrandData = finalCheckingHasBrandReceivedData(article);
  const multiBrand = productBrands.length > 1;
  const autoAssignBrand = productBrands.length === 1 ? productBrands[0] : null;

  return {
    required: true,
    budgetMode: hasFloorBrandData ? 'floor' : 'product',
    multiBrand,
    autoAssignBrand,
    productBrands,
    receivedData,
    transferredData,
  };
}

/**
 * M2→M1 merge requires brand allocation when cascade hits Final Checking on a branded article.
 * @param {Object} article - Mongoose article with getFloorOrder()
 * @param {string[]} cascadeFloors
 * @param {Array<{ brand?: string }>|undefined|null} [productStyleCodes]
 * @returns {Promise<boolean>}
 */
export async function articleRequiresBrandOnM2Merge(article, cascadeFloors, productStyleCodes = null) {
  const floorOrder = await article.getFloorOrder();
  const ctx = resolveM2MergeBrandContext(article, cascadeFloors, floorOrder, productStyleCodes);
  return ctx.required;
}

/**
 * Build auto-assign transfer items for single-brand M2 merge.
 * @param {number} quantity
 * @param {string} brand
 * @returns {Array<{ transferred: number, styleCode: string, brand: string }>}
 */
export function buildSingleBrandM2MergeItems(quantity, brand) {
  const b = String(brand ?? '').trim();
  if (!b || !quantity || quantity <= 0) return [];
  return [{ transferred: quantity, styleCode: '', brand: b }];
}

/**
 * Normalize transfer items for M2 merge (brand-only lines).
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} transferItems
 * @returns {Array<{ transferred: number, styleCode: string, brand: string }>}
 */
export function normalizeM2MergeTransferItems(transferItems) {
  return (transferItems || [])
    .map((item) => ({
      transferred: Math.max(0, Number(item?.transferred ?? 0)),
      styleCode: '',
      brand: String(item?.brand ?? '').trim(),
    }))
    .filter((item) => item.transferred > 0 && item.brand);
}

/**
 * Validate brand split for M2→M1 merge (floor budget or product catalog fallback).
 * @param {Array<{ transferred?: number, brand?: string }>} transferItems
 * @param {number} quantity
 * @param {Object} brandContext - from resolveM2MergeBrandContext
 * @returns {{ valid: boolean, error?: string, normalizedItems: Array<{ transferred: number, styleCode: string, brand: string }> }}
 */
export function validateM2MergeBrandSplit(transferItems, quantity, brandContext) {
  const {
    budgetMode = 'none',
    productBrands = [],
    receivedData = [],
    transferredData = [],
  } = brandContext || {};

  if (budgetMode === 'floor') {
    // Cascade merge adds M1 downstream — brand labels the repair pool, not FC receive remaining.
    return validateM2MergeTransferItems(transferItems, quantity, receivedData, transferredData, {
      skipBrandBudgetCap: true,
    });
  }

  if (budgetMode === 'product') {
    const normalizedItems = normalizeM2MergeTransferItems(transferItems);
    if (normalizedItems.length === 0) {
      return {
        valid: false,
        error: 'transferItems with brand and quantity are required for this merge',
        normalizedItems,
      };
    }

    const sum = normalizedItems.reduce((s, i) => s + i.transferred, 0);
    if (Math.abs(sum - quantity) > 0.001) {
      return {
        valid: false,
        error: `transferItems sum (${sum}) must equal merge quantity (${quantity})`,
        normalizedItems,
      };
    }

    const allowed = new Set(productBrands.map((b) => brandKey(b)));
    for (const item of normalizedItems) {
      const key = brandKey(item.brand);
      if (!allowed.has(key)) {
        return {
          valid: false,
          error: `Brand "${item.brand}" is not in the product catalog for this article`,
          normalizedItems,
        };
      }
    }

    return { valid: true, normalizedItems };
  }

  return {
    valid: false,
    error: 'Brand allocation is not configured for this merge',
    normalizedItems: [],
  };
}

/**
 * Validate brand split for M2→M1 merge on Final Checking (floor receivedData budget).
 * @param {Array<{ transferred?: number, brand?: string }>} transferItems
 * @param {number} quantity
 * @param {Array<{ transferred?: number, brand?: string }>} receivedData
 * @param {Array<{ transferred?: number, brand?: string }>} transferredData
 * @param {{ skipBrandBudgetCap?: boolean }} [options]
 * @returns {{ valid: boolean, error?: string, normalizedItems: Array<{ transferred: number, styleCode: string, brand: string }> }}
 */
export function validateM2MergeTransferItems(transferItems, quantity, receivedData, transferredData, options = {}) {
  const normalizedItems = normalizeM2MergeTransferItems(transferItems);
  if (normalizedItems.length === 0) {
    return { valid: false, error: 'transferItems with brand and quantity are required for this merge', normalizedItems };
  }

  const sum = normalizedItems.reduce((s, i) => s + i.transferred, 0);
  if (Math.abs(sum - quantity) > 0.001) {
    return {
      valid: false,
      error: `transferItems sum (${sum}) must equal merge quantity (${quantity})`,
      normalizedItems,
    };
  }

  const receivedBrands = aggregateByBrand(receivedData);
  for (const item of normalizedItems) {
    const key = brandKey(item.brand);
    if (!receivedBrands.has(key)) {
      return {
        valid: false,
        error: `Brand "${item.brand}" is not in Final Checking received breakdown`,
        normalizedItems,
      };
    }
  }

  if (!options.skipBrandBudgetCap) {
    const budget = buildBrandBudgetFromReceived(receivedData, transferredData);
    const byBrand = aggregateByBrand(normalizedItems);
    for (const [key, qty] of byBrand.entries()) {
      const entry = budget.get(key);
      const remaining = entry?.remaining ?? 0;
      if (qty > remaining + 0.001) {
        const display = entry?.brand ?? key;
        return {
          valid: false,
          error: `Brand "${display}" exceeds remaining (${remaining})`,
          normalizedItems,
        };
      }
    }
  }

  return { valid: true, normalizedItems };
}

/**
 * Format brand lines for M2 merge audit remarks.
 * @param {Array<{ transferred?: number, brand?: string }>} items
 * @returns {string}
 */
export function formatM2MergeBrandRemarks(items) {
  const collapsed = normalizeM2MergeTransferItems(items);
  if (collapsed.length === 0) return '';
  return collapsed.map((i) => `${i.transferred}·${i.brand}`).join('; ');
}

const BRANDING_CASCADE_FLOORS = ['Branding', 'Re-Boarding'];

/**
 * Resolve styleCode string from a styleCodes catalog entry.
 * @param {unknown} sc
 * @returns {string}
 */
function styleCodeFromProductEntry(sc) {
  if (sc == null || typeof sc !== 'object') return '';
  const o = /** @type {{ styleCode?: string }} */ (sc);
  return String(o.styleCode ?? '').trim();
}

/**
 * Look up styleCode for a brand from floor receivedData or product catalog.
 * @param {string} brand
 * @param {Array<{ styleCode?: string, brand?: string }>} receivedData
 * @param {Array<{ brand?: string, styleCode?: string }>|undefined|null} productStyleCodes
 * @returns {string}
 */
function styleCodeForBrand(brand, receivedData, productStyleCodes) {
  const key = brandKey(brand);
  const fromReceived = (receivedData || []).find(
    (r) => brandKey(r?.brand) === key && String(r?.styleCode ?? '').trim()
  );
  if (fromReceived) return String(fromReceived.styleCode).trim();

  for (const sc of productStyleCodes || []) {
    if (brandKey(brandFromStyleCodeEntry(sc)) === key) {
      return styleCodeFromProductEntry(sc);
    }
  }
  return '';
}

/**
 * Enrich M2 merge transfer items with styleCode from receivedData or product catalog.
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} transferItems
 * @param {Array<{ styleCode?: string, brand?: string }>} receivedData
 * @param {Array<{ brand?: string, styleCode?: string }>|undefined|null} productStyleCodes
 * @returns {Array<{ transferred: number, styleCode: string, brand: string }>}
 */
export function enrichM2MergeItemsWithStyleCode(transferItems, receivedData, productStyleCodes) {
  return (transferItems || []).map((item) => {
    const existing = String(item?.styleCode ?? '').trim();
    const styleCode = existing || styleCodeForBrand(item.brand, receivedData, productStyleCodes);
    return {
      transferred: Math.max(0, Number(item?.transferred ?? 0)),
      styleCode,
      brand: String(item?.brand ?? '').trim(),
    };
  });
}

/**
 * Apply styleCode to merged brand rows (mergeTransferredDataByBrand stores empty styleCode).
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} rows
 * @param {Array<{ styleCode?: string, brand?: string }>} receivedData
 * @param {Array<{ brand?: string, styleCode?: string }>|undefined|null} productStyleCodes
 * @returns {Array<{ transferred: number, styleCode: string, brand: string }>}
 */
function applyStyleCodesToMergedRows(rows, receivedData, productStyleCodes) {
  return (rows || []).map((row) => {
    const existing = String(row?.styleCode ?? '').trim();
    return {
      transferred: Math.max(0, Number(row?.transferred ?? 0)),
      brand: String(row?.brand ?? '').trim(),
      styleCode: existing || styleCodeForBrand(row.brand, receivedData, productStyleCodes),
    };
  });
}

/**
 * Mirror M2 merge brand split onto Branding / Re-Boarding when those floors are in the cascade.
 * Syncs transferredData and transferred scalar (without double-bumping when cascade already did).
 * @param {Object} article - Mongoose article with getFloorKey()
 * @param {string[]} cascadeFloors
 * @param {Array<{ transferred: number, styleCode: string, brand: string }>} normalizedTransferItems
 * @param {number} quantity
 * @param {Array<{ brand?: string, styleCode?: string }>|undefined|null} productStyleCodes
 */
export function applyM2MergeBrandingFloorTransferData(
  article,
  cascadeFloors,
  normalizedTransferItems,
  quantity,
  productStyleCodes
) {
  if (!article || !Array.isArray(cascadeFloors) || !normalizedTransferItems?.length) return;
  if (typeof article.getFloorKey !== 'function') return;

  for (const floorLabel of BRANDING_CASCADE_FLOORS) {
    if (!cascadeFloors.includes(floorLabel)) continue;

    const floorKey = article.getFloorKey(floorLabel);
    if (!floorKey) continue;

    if (!article.floorQuantities) {
      article.floorQuantities = {};
    }
    if (!article.floorQuantities[floorKey]) {
      article.floorQuantities[floorKey] = {};
    }

    const floorData = article.floorQuantities[floorKey];
    const receivedData = floorData.receivedData || [];
    const enrichedItems = enrichM2MergeItemsWithStyleCode(
      normalizedTransferItems,
      receivedData,
      productStyleCodes
    );

    floorData.transferredData = applyStyleCodesToMergedRows(
      mergeTransferredDataByBrand(floorData.transferredData, enrichedItems),
      receivedData,
      productStyleCodes
    );

    if ((floorData.transferred || 0) === 0) {
      floorData.transferred = quantity;
    }

    floorData.remaining = Math.max(0, (floorData.received || 0) - (floorData.transferred || 0));
    article.markModified(`floorQuantities.${floorKey}`);
  }
}
