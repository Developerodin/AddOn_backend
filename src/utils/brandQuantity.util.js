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
 * M2→M1 merge requires brand allocation when cascade hits Final Checking on a branded article.
 * @param {Object} article - Mongoose article with getFloorOrder()
 * @param {string[]} cascadeFloors
 * @returns {Promise<boolean>}
 */
export async function articleRequiresBrandOnM2Merge(article, cascadeFloors) {
  if (!Array.isArray(cascadeFloors) || !cascadeFloors.includes(FINAL_CHECKING_LABEL)) {
    return false;
  }
  const floorOrder = await article.getFloorOrder();
  if (!articleHasBrandingInProcess(floorOrder)) return false;
  return finalCheckingHasBrandReceivedData(article);
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
 * Validate brand split for M2→M1 merge on Final Checking.
 * @param {Array<{ transferred?: number, brand?: string }>} transferItems
 * @param {number} quantity
 * @param {Array<{ transferred?: number, brand?: string }>} receivedData
 * @param {Array<{ transferred?: number, brand?: string }>} transferredData
 * @returns {{ valid: boolean, error?: string, normalizedItems: Array<{ transferred: number, styleCode: string, brand: string }> }}
 */
export function validateM2MergeTransferItems(transferItems, quantity, receivedData, transferredData) {
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
