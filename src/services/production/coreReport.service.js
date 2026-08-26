import Product from '../../models/product.model.js';
import {
  addCoreMetrics,
  attrValue,
  createEmptyCoreMetrics,
  escapeRegexLiteral,
  factoryKey,
  refId,
  toNumber,
  totalInhandOf,
} from './coreReportHelpers.js';
import {
  baseProductFilter,
  CORE_REPORT_PRODUCT_SELECT,
  loadBrandsByProduct,
  loadInwardPendingByFactory,
  loadProductionByFactory,
  loadVendorPoPending,
  loadWarehouseStockByProduct,
  styleIdsMatchingSearch,
} from './coreReportSources.js';

const ALLOWED_SORT_FIELDS = new Set(['factoryCode', 'vendorCode', 'name', 'createdAt']);

/**
 * Builds the Product filter: active items with a factory code, optional search.
 * @param {{ search?: string }} filter
 * @returns {Promise<Record<string, unknown>>}
 */
const buildProductFilter = async (filter = {}) => {
  const query = { ...baseProductFilter() };
  const search = typeof filter.search === 'string' ? filter.search.trim() : '';
  if (!search) return query;

  const regex = new RegExp(escapeRegexLiteral(search), 'i');
  const searchOr = [
    { name: regex },
    { factoryCode: regex },
    { vendorCode: regex },
    { internalCode: regex },
  ];
  const styleIds = await styleIdsMatchingSearch(regex);
  if (styleIds.length) searchOr.push({ styleCodes: { $in: styleIds } });
  return { $and: [query, { $or: searchOr }] };
};

/**
 * Resolves vendorCode with internalCode fallback.
 * @param {Record<string, unknown>} product
 * @returns {string}
 */
const vendorOrInternal = (product) =>
  String(product.vendorCode ?? '').trim() || String(product.internalCode ?? '').trim();

/**
 * Vendor pending map for one product, zero-filled for every dynamic column.
 * @param {string} productId
 * @param {Map<string, Map<string, number>>} pendingByProductVendor
 * @param {string[]} vendorColumns
 * @returns {Record<string, number>}
 */
const vendorPendingForProduct = (productId, pendingByProductVendor, vendorColumns) => {
  const byVendor = pendingByProductVendor.get(productId);
  /** @type {Record<string, number>} */
  const out = {};
  for (const vendor of vendorColumns) {
    out[vendor] = toNumber(byVendor?.get(vendor));
  }
  return out;
};

/**
 * Sorted vendor names that have pending qty on any product in the filtered set.
 * @param {string[]} productIds
 * @param {Map<string, Map<string, number>>} pendingByProductVendor
 * @returns {string[]}
 */
const vendorColumnsForProducts = (productIds, pendingByProductVendor) => {
  const names = new Set();
  for (const productId of productIds) {
    const byVendor = pendingByProductVendor.get(productId);
    if (!byVendor) continue;
    for (const [vendor, qty] of byVendor) {
      if (qty > 0) names.add(vendor);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
};

/**
 * Assembles one Core Report row from a product + lookup maps.
 * @param {Record<string, unknown>} product
 * @param {{
 *   brandsByProduct: Map<string, string>,
 *   sapByProduct: Map<string, number>,
 *   inwardByFactory: Map<string, number>,
 *   inTransitByProduct: Map<string, number>,
 *   pendingByProductVendor: Map<string, Map<string, number>>,
 *   wipByFactory: Map<string, number>,
 *   runningByFactory: Map<string, number>,
 *   planningByFactory: Map<string, number>,
 *   vendorColumns: string[]
 * }} maps
 * @returns {object}
 */
const toCoreReportRow = (product, maps) => {
  const productId = refId(product._id);
  const factory = String(product.factoryCode ?? '').trim();
  const key = factoryKey(factory);
  const sapStock = toNumber(maps.sapByProduct.get(productId));
  const inwardPending = toNumber(maps.inwardByFactory.get(key));
  const wip = toNumber(maps.wipByFactory.get(key));
  const metrics = {
    sapStock,
    inwardPending,
    inTransit: toNumber(maps.inTransitByProduct.get(productId)),
    wip,
    runningOnMachine: toNumber(maps.runningByFactory.get(key)),
    productionPlanning: toNumber(maps.planningByFactory.get(key)),
    totalInhand: totalInhandOf(sapStock, inwardPending, wip),
    vendorPending: vendorPendingForProduct(productId, maps.pendingByProductVendor, maps.vendorColumns),
  };
  return {
    productId,
    brand: maps.brandsByProduct.get(productId) || '',
    vendorCode: vendorOrInternal(product),
    factoryCode: factory,
    color: attrValue(product.attributes, ['Color', 'colour']),
    type: attrValue(product.attributes, ['Type']),
    design: String(product.name ?? '').trim(),
    ...metrics,
  };
};

/**
 * Paginated Core Report: item master + warehouse + vendor inward/PO + production.
 * @param {{ search?: string }} filter
 * @param {{ page?: number, limit?: number, sortBy?: string }} options
 * @returns {Promise<{
 *   results: object[],
 *   page: number,
 *   limit: number,
 *   totalPages: number,
 *   total: number,
 *   catalogTotal: number,
 *   vendorColumns: string[],
 *   totals: object,
 *   pageTotals: object
 * }>}
 */
export const getCoreReport = async (filter = {}, options = {}) => {
  const limit = Math.min(parseInt(String(options.limit), 10) || 10, 100);
  const page = parseInt(String(options.page), 10) || 1;
  const rawSort =
    typeof options.sortBy === 'string' && options.sortBy.trim()
      ? options.sortBy.trim().split(',')[0]
      : 'factoryCode:asc';
  const [sortField, sortDir] = rawSort.split(':');
  const safeSortBy = `${ALLOWED_SORT_FIELDS.has(sortField) ? sortField : 'factoryCode'}:${
    sortDir === 'desc' ? 'desc' : 'asc'
  }`;

  const productFilter = await buildProductFilter(filter);
  const paged = await Product.paginate(productFilter, {
    page,
    limit,
    sortBy: safeSortBy,
    select: CORE_REPORT_PRODUCT_SELECT,
    lean: true,
  });

  const pageProducts = paged.results || [];
  const allSlim = await Product.find(productFilter).select('_id factoryCode styleCodes').lean();
  const allProductIds = allSlim.map((p) => refId(p._id));

  const [sapByProduct, inwardByFactory, vendorPo, production, brandsByProduct] = await Promise.all([
    loadWarehouseStockByProduct(allSlim),
    loadInwardPendingByFactory(),
    loadVendorPoPending(),
    loadProductionByFactory(),
    loadBrandsByProduct(pageProducts),
  ]);

  const vendorColumns = vendorColumnsForProducts(allProductIds, vendorPo.pendingByProductVendor);
  const maps = {
    brandsByProduct,
    sapByProduct,
    inwardByFactory,
    inTransitByProduct: vendorPo.inTransitByProduct,
    pendingByProductVendor: vendorPo.pendingByProductVendor,
    wipByFactory: production.wipByFactory,
    runningByFactory: production.runningByFactory,
    planningByFactory: production.planningByFactory,
    vendorColumns,
  };

  const results = pageProducts.map((product) => toCoreReportRow(product, maps));

  const emptyTotals = () => {
    const acc = createEmptyCoreMetrics();
    for (const vendor of vendorColumns) acc.vendorPending[vendor] = 0;
    return acc;
  };

  const pageTotals = results.reduce((acc, row) => addCoreMetrics(acc, row, vendorColumns), emptyTotals());

  const totals = emptyTotals();
  const brandsForTotals = new Map();
  for (const product of allSlim) {
    const row = toCoreReportRow(product, { ...maps, brandsByProduct: brandsForTotals });
    addCoreMetrics(totals, row, vendorColumns);
  }

  const searchTerm = typeof filter.search === 'string' ? filter.search.trim() : '';
  const catalogTotal = searchTerm
    ? await Product.countDocuments(baseProductFilter())
    : paged.totalResults;

  return {
    results,
    page: paged.page,
    limit: paged.limit,
    totalPages: paged.totalPages,
    total: paged.totalResults,
    catalogTotal,
    vendorColumns,
    totals,
    pageTotals,
  };
};
