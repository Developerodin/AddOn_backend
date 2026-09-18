/**
 * Pick a finite tearweight from a supplier yarnDetails row.
 * @param {{ tearweight?: number|null }} detail
 * @returns {number|null}
 */
function finiteTearweight(detail) {
  const tw = Number(detail?.tearweight);
  return Number.isFinite(tw) ? tw : null;
}

/**
 * Resolves per-cone tearweight from supplier yarnDetails.
 * Exact yarnName first; yarnCatalogId next (catalog labels often differ from supplier labels).
 *
 * @param {Array<{ yarnName?: string, yarnCatalogId?: *, tearweight?: number }>} yarnDetails
 * @param {string} requestedYarnName - Box/cone/PO yarn name
 * @param {string[]} [catalogIdsForName] - YarnCatalog `_id`s whose yarnName matched the request
 * @returns {number|null}
 */
export function resolveSupplierYarnTearweight(yarnDetails, requestedYarnName, catalogIdsForName = []) {
  const requested = String(requestedYarnName || '').trim();
  if (!requested) return null;
  const details = Array.isArray(yarnDetails) ? yarnDetails : [];
  const catalogIdSet = new Set((catalogIdsForName || []).map((id) => String(id)).filter(Boolean));

  const exact = details.find((d) => String(d.yarnName || '').trim() === requested);
  const exactTw = finiteTearweight(exact);
  if (exactTw != null) return exactTw;

  const byCatalog = details.find((d) => d.yarnCatalogId && catalogIdSet.has(String(d.yarnCatalogId)));
  return finiteTearweight(byCatalog);
}
