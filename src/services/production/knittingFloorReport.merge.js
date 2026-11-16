/**
 * Pure merge helpers for knitting floor date-range report rows.
 */

/**
 * @param {string} orderId
 * @param {string} articleId
 * @param {string} machineId
 * @returns {string}
 */
export const bucketKey = (orderId, articleId, machineId) =>
  `${String(orderId)}|${String(articleId)}|${String(machineId ?? '')}`;

/**
 * Merges knitting output and M4 aggregates into bucket maps.
 * @param {Array<{ _id: { orderId: string, articleId: string, machineId?: string }, knittingOutput?: number, machineCode?: string }>} knitAgg
 * @param {Array<{ _id: { orderId: string, articleId: string, machineId?: string }, m4Qty?: number, machineCode?: string }>} m4Agg
 * @returns {Map<string, { orderId: string, articleId: string, machineId: string, knittingOutput: number, m4Qty: number, machineCode: string }>}
 */
export const mergeKnittingReportBuckets = (knitAgg, m4Agg) => {
  const buckets = new Map();

  const ensure = (id) => {
    const orderId = String(id.orderId ?? '');
    const articleId = String(id.articleId ?? '');
    const machineId = String(id.machineId ?? '');
    const key = bucketKey(orderId, articleId, machineId);
    let row = buckets.get(key);
    if (!row) {
      row = {
        orderId,
        articleId,
        machineId,
        knittingOutput: 0,
        m4Qty: 0,
        machineCode: '',
      };
      buckets.set(key, row);
    }
    return row;
  };

  for (const doc of knitAgg ?? []) {
    const row = ensure(doc._id ?? {});
    row.knittingOutput += Number(doc.knittingOutput ?? 0);
    const code = String(doc.machineCode ?? '').trim();
    if (code && !row.machineCode) row.machineCode = code;
  }

  for (const doc of m4Agg ?? []) {
    const row = ensure(doc._id ?? {});
    row.m4Qty += Number(doc.m4Qty ?? 0);
    const code = String(doc.machineCode ?? '').trim();
    if (code && !row.machineCode) row.machineCode = code;
  }

  return buckets;
};

/**
 * Filters and sorts merged buckets for API output.
 * @param {Map<string, { orderId: string, articleId: string, machineId: string, knittingOutput: number, m4Qty: number, machineCode: string, orderNumber?: string, articleNumber?: string, plannedQuantity?: number }>} buckets
 * @returns {Array<object>}
 */
export const finalizeKnittingReportRows = (buckets) => {
  const rows = [...buckets.values()].filter(
    (r) => (r.knittingOutput ?? 0) > 0 || (r.m4Qty ?? 0) > 0
  );

  rows.sort((a, b) => {
    const on = String(a.orderNumber ?? '').localeCompare(String(b.orderNumber ?? ''), undefined, {
      numeric: true,
    });
    if (on !== 0) return on;
    const an = String(a.articleNumber ?? '').localeCompare(String(b.articleNumber ?? ''), undefined, {
      numeric: true,
    });
    if (an !== 0) return an;
    return String(a.machineCode ?? '—').localeCompare(String(b.machineCode ?? '—'), undefined, {
      numeric: true,
    });
  });

  return rows;
};

/**
 * Case-insensitive substring match on order, article, or machine display fields.
 * @param {Array<object>} rows
 * @param {string} search
 * @returns {Array<object>}
 */
export const filterKnittingReportRows = (rows, search) => {
  const term = String(search ?? '').trim().toLowerCase();
  if (!term) return rows ?? [];
  return (rows ?? []).filter((r) => {
    const haystack = [
      r.orderNumber,
      r.articleNumber,
      r.machineCode,
    ]
      .map((v) => String(v ?? '').toLowerCase())
      .join('\0');
    return haystack.includes(term);
  });
};

export const computeKnittingReportColumnTotals = (rows) => {
  const seenArticles = new Set();
  let plannedQuantity = 0;
  let knittingOutput = 0;
  let m4Qty = 0;

  for (const r of rows ?? []) {
    knittingOutput += Number(r.knittingOutput ?? 0);
    m4Qty += Number(r.m4Qty ?? 0);
    const articleKey = `${String(r.orderId ?? '')}|${String(r.articleId ?? '')}`;
    if (!seenArticles.has(articleKey)) {
      seenArticles.add(articleKey);
      plannedQuantity += Number(r.plannedQuantity ?? 0);
    }
  }

  return { plannedQuantity, knittingOutput, m4Qty };
};