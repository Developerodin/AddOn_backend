import { z } from 'zod';
import Product from '../../models/product.model.js';
import StyleCode from '../../models/styleCode.model.js';
import WarehouseInventory from '../../models/whms/warehouseInventory.model.js';
import { getWarehouseInventoryByStyleCode } from '../../services/whms/warehouseInventory.service.js';
import { serializeWarehouseInventory } from '../../utils/warehouseInventorySerializer.js';
import {
  classifyProductNameMatches,
  isNaEan,
  warehouseLookupKey,
  WAREHOUSE_MATCH_LIMIT,
} from './matchWarehouseStock.js';
import { integerQty } from './warehouseOrderLabels.js';

export const GET_WAREHOUSE_STOCK = 'getWarehouseStock';

export const NAV_PATH = 'Warehouse Management.Stock';

/**
 * Case-insensitive exact match. Metacharacters in the lookup key are escaped.
 * @param {string} value
 * @returns {RegExp}
 */
function exactRegex(value) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Screen row for one style code. Null when the stock screen has no row.
 * Numbers come from getWarehouseInventoryByStyleCode + serializeWarehouseInventory.
 * @param {string} styleCode
 * @returns {Promise<object|null>}
 */
async function readStock(styleCode) {
  const doc = await getWarehouseInventoryByStyleCode(styleCode);
  return serializeWarehouseInventory(doc);
}

/**
 * Active style master, or the stock row's styleCode when the master is missing.
 * @param {string} key
 * @returns {Promise<{ styleCode: string, pack: string }|null>}
 */
async function findStyleByCode(key) {
  const master = await StyleCode.findOne({ styleCode: exactRegex(key) }).select('styleCode pack').lean();
  if (master) return { styleCode: String(master.styleCode), pack: master.pack ? String(master.pack) : '' };
  const stock = await WarehouseInventory.findOne({ styleCode: exactRegex(key) }).select('styleCode').lean();
  if (!stock) return null;
  return { styleCode: String(stock.styleCode), pack: '' };
}

/**
 * Pack the stock screen shows, otherwise the style master pack.
 * @param {object|null} screen
 * @param {string} masterPack
 * @returns {string}
 */
function packLabel(screen, masterPack) {
  const fromScreen = screen && screen.styleCodeMaster ? screen.styleCodeMaster.pack : undefined;
  if (fromScreen != null && String(fromScreen).trim()) return String(fromScreen);
  return masterPack ? String(masterPack) : '';
}

/**
 * Product the stock screen shows for this row (`itemId`). Null when the row has none.
 * @param {object|null} screen
 * @returns {{ factoryCode: string, name: string }|null}
 */
function screenProduct(screen) {
  if (!screen || !screen.product) return null;
  return {
    factoryCode: screen.product.factoryCode ? String(screen.product.factoryCode) : '',
    name: screen.product.name ? String(screen.product.name) : '',
  };
}

/**
 * One style. Missing stock is zeros. Quantities are integers from the serializer.
 * @param {{ styleCode: string, pack?: string }} master
 * @returns {Promise<{ styleCode: string, pack: string, total: number, blocked: number, available: number }>}
 */
async function presentStyleNumbers(master) {
  const screen = await readStock(master.styleCode);
  const quantities = screen && screen.quantities ? screen.quantities : {};
  return {
    styleCode: String((screen && screen.styleCode) || master.styleCode),
    pack: packLabel(screen, master.pack || ''),
    total: integerQty(quantities.total),
    blocked: integerQty(quantities.blocked),
    available: integerQty(quantities.available),
  };
}

/**
 * Direct style-code or single-EAN hit. The product is the one on the stock row.
 * @param {{ styleCode: string, pack?: string }} master
 * @returns {Promise<object>}
 */
async function presentStyleQuery(master) {
  const screen = await readStock(master.styleCode);
  const quantities = screen && screen.quantities ? screen.quantities : {};
  return {
    queryKind: 'style',
    unit: 'pack-labelled',
    styleCode: String((screen && screen.styleCode) || master.styleCode),
    pack: packLabel(screen, master.pack || ''),
    total: integerQty(quantities.total),
    blocked: integerQty(quantities.blocked),
    available: integerQty(quantities.available),
    product: screenProduct(screen),
  };
}

/**
 * @param {object[]} products
 * @returns {{ error: 'AMBIGUOUS', candidates: { factoryCode: string, name: string }[] } | { error: 'TOO_MANY', count: number }}
 */
function ambiguousProducts(products) {
  const sorted = [...products].sort((left, right) => {
    const byCode = String(left.factoryCode || '').localeCompare(String(right.factoryCode || ''));
    if (byCode !== 0) return byCode;
    return String(left.name || '').localeCompare(String(right.name || ''));
  });
  if (sorted.length > WAREHOUSE_MATCH_LIMIT) return { error: 'TOO_MANY', count: sorted.length };
  return {
    error: 'AMBIGUOUS',
    candidates: sorted.map((product) => ({
      factoryCode: String(product.factoryCode || ''),
      name: String(product.name || ''),
    })),
  };
}

/**
 * Duplicate EAN. One candidate per style and owning product. styleCode keeps them apart.
 * @param {object[]} styles
 * @returns {Promise<object>}
 */
async function ambiguousEan(styles) {
  const ids = styles.map((style) => style._id); // eslint-disable-line no-underscore-dangle
  const products = await Product.find({ status: 'active', styleCodes: { $in: ids } })
    .select('factoryCode name styleCodes')
    .lean();
  const candidates = styles.flatMap((style) => {
    const owners = products.filter((product) =>
      (product.styleCodes || []).some((id) => String(id) === String(style._id)) // eslint-disable-line no-underscore-dangle
    );
    const styleCode = String(style.styleCode);
    if (owners.length === 0) return [{ factoryCode: '', name: '', styleCode }];
    return owners.map((product) => ({
      factoryCode: String(product.factoryCode || ''),
      name: String(product.name || ''),
      styleCode,
    }));
  });
  if (candidates.length > WAREHOUSE_MATCH_LIMIT) return { error: 'TOO_MANY', count: candidates.length };
  if (candidates.length === 0) return { error: 'NOT_FOUND' };
  return { error: 'AMBIGUOUS', candidates };
}

/**
 * Sum only when every style is exclusive to this product and every pack is the same.
 * Shared wins over mixed when both are true.
 * @param {object[]} styles
 * @param {boolean} shared
 * @returns {{ productTotal: object|null, totalReason: null|'SHARED_STYLE'|'MIXED_PACK' }}
 */
function productTotalFor(styles, shared) {
  if (shared) return { productTotal: null, totalReason: 'SHARED_STYLE' };
  const packs = new Set(styles.map((style) => style.pack));
  if (styles.length === 0 || packs.size !== 1) {
    return { productTotal: null, totalReason: styles.length === 0 ? null : 'MIXED_PACK' };
  }
  const sum = (key) => styles.reduce((total, style) => total + integerQty(style[key]), 0);
  return {
    productTotal: {
      total: sum('total'),
      blocked: sum('blocked'),
      available: sum('available'),
      pack: styles[0].pack,
    },
    totalReason: null,
  };
}

/**
 * Product payload. Styles with no stock row are zeros. productTotal is null when it would lie.
 * @param {import('mongoose').Types.ObjectId|string} productId
 * @returns {Promise<object>}
 */
async function presentProduct(productId) {
  const product = await Product.findOne({ _id: productId, status: 'active' })
    .select('factoryCode name styleCodes')
    .lean();
  if (!product) return { error: 'NOT_FOUND' };
  const styleIds = (product.styleCodes || []).filter(Boolean);
  const masters = styleIds.length
    ? await StyleCode.find({ _id: { $in: styleIds } })
        .select('styleCode pack')
        .lean()
    : [];
  const byId = new Map(masters.map((row) => [String(row._id), row])); // eslint-disable-line no-underscore-dangle
  const ordered = styleIds.map((id) => byId.get(String(id))).filter(Boolean);
  const styles = await Promise.all(
    ordered.map((master) => presentStyleNumbers({ styleCode: master.styleCode, pack: master.pack || '' }))
  );
  const sharedCount = styleIds.length
    ? await Product.countDocuments({
        status: 'active',
        _id: { $ne: product._id }, // eslint-disable-line no-underscore-dangle
        styleCodes: { $in: styleIds },
      })
    : 0;
  const shared = sharedCount > 0;
  return {
    queryKind: 'product',
    product: {
      factoryCode: String(product.factoryCode || ''),
      name: String(product.name || ''),
    },
    unit: 'pack-labelled',
    styles,
    ...productTotalFor(styles, shared),
  };
}

/**
 * @param {object} row
 * @returns {{ productId: string, factoryCode: string, name: string }}
 */
function asCandidate(row) {
  return {
    productId: String(row._id), // eslint-disable-line no-underscore-dangle
    factoryCode: String(row.factoryCode || ''),
    name: String(row.name || ''),
  };
}

/**
 * Name-token fallback after exact style, EAN, and factory code missed.
 * @param {string} key
 * @returns {Promise<object>}
 */
async function matchByName(key) {
  const rows = await Product.find({ status: 'active' }).select('factoryCode name').lean();
  const classified = classifyProductNameMatches(key, rows.map(asCandidate));
  if (classified.error === 'NOT_FOUND') return { error: 'NOT_FOUND' };
  if (classified.error === 'TOO_MANY') return { error: 'TOO_MANY', count: classified.count };
  if (classified.error === 'AMBIGUOUS') return ambiguousProducts(classified.matches);
  return presentProduct(classified.match.productId);
}

/**
 * Warehouse stock for a style code, EAN, factory code, or product name.
 * Match order: exact style code, exact EAN (one real code; NA never matches),
 * exact factory code (one active product), then name tokens.
 * @param {{ query?: string }} input
 * @returns {Promise<object>}
 */
export async function runGetWarehouseStock(input) {
  const key = warehouseLookupKey(input?.query);
  if (!key) return { error: 'NOT_FOUND' };

  const style = await findStyleByCode(key);
  if (style) return presentStyleQuery(style);

  if (!isNaEan(key)) {
    const eanStyles = await StyleCode.find({ eanCode: exactRegex(key) }).select('styleCode pack eanCode').lean();
    const real = eanStyles.filter((row) => !isNaEan(row.eanCode));
    if (real.length === 1) return presentStyleQuery(real[0]);
    if (real.length > 1) return ambiguousEan(real);
  }

  const byFactory = await Product.find({ status: 'active', factoryCode: exactRegex(key) })
    .select('factoryCode name')
    .lean();
  if (byFactory.length === 1) return presentProduct(byFactory[0]._id); // eslint-disable-line no-underscore-dangle
  if (byFactory.length > 1) return ambiguousProducts(byFactory);

  return matchByName(key);
}

/** Tool definition. Registered by `registerTools`. */
export const getWarehouseStockTool = {
  name: GET_WAREHOUSE_STOCK,
  description:
    'Read warehouse stock from the Stock screen. Not yarn stock (getYarnLiveStock) and not a production order. Pass query as the words the user used: a style code, an EAN, a factory code such as A906, or product name words. Stopwords are stripped in code. Tokens split on spaces, hyphens, and slashes. Match order is exact style code, then exact EAN, then exact factory code, then product name tokens. EAN "NA" never matches. An EAN on more than one style returns error AMBIGUOUS. A factory code on more than one active product returns error AMBIGUOUS. Name tokens: one product returns the product; 2 to 10 return error AMBIGUOUS and candidates (factoryCode, name); more than 10 return error TOO_MANY with count. Do not state a quantity for TOO_MANY. No match returns error NOT_FOUND. A style or single-EAN hit returns queryKind style, unit pack-labelled, styleCode, pack, total, blocked, available, and product (the product the stock screen shows). A product hit returns queryKind product, product (factoryCode, name), unit pack-labelled, styles (styleCode, pack, total, blocked, available; a style with no stock row is zeros), productTotal, and totalReason. productTotal is { total, blocked, available, pack } only when no style sits on another active product and every style has the same pack. Otherwise productTotal is null and totalReason is SHARED_STYLE or MIXED_PACK. Do not add the style rows yourself. Quantities are integers. available is total minus blocked. Damaged is not included. The pack string is the unit. Do not say pieces. Do not convert a pack into pairs or pieces.',
  type: 'READ',
  navPath: NAV_PATH,
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe('Style code, EAN, factory code, or product name words. Example: A906 or A906 ka warehouse stock'),
  }),
  run: runGetWarehouseStock,
};
