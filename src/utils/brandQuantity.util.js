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
