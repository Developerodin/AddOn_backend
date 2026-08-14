import mongoose from 'mongoose';
import Product from '../../models/product.model.js';
import ProductAttribute from '../../models/productAttribute.model.js';
import StyleCode from '../../models/styleCode.model.js';
import StyleCodePairs from '../../models/styleCodePairs.model.js';
import { buildProductAttributeValueLookup } from './warehouseOrderCatalogEnrich.js';

/**
 * Read a product-attribute map as a plain object.
 * @param {Map<string, string>|Record<string, string>|null|undefined} productAttributes
 * @returns {Record<string, string>}
 */
function toAttrObject(productAttributes) {
  if (!productAttributes) return {};
  if (productAttributes instanceof Map) return Object.fromEntries(productAttributes);
  if (typeof productAttributes === 'object') return productAttributes;
  return {};
}

/**
 * Normalize a style-code ref (ObjectId, string, or populated doc) to an id string.
 * @param {unknown} ref
 * @returns {string}
 */
function styleCodeRefId(ref) {
  if (!ref) return '';
  if (typeof ref === 'object') return String(ref._id || ref.id || '');
  return String(ref);
}

/**
 * Resolve a display value from product attributes by matching attribute names or ids.
 * @param {Record<string, string>} attrs
 * @param {Record<string, string>} valueLookup
 * @param {Map<string, string>} attrNameById
 * @param {RegExp} keyRegex
 * @returns {string}
 */
function attrDisplayValue(attrs, valueLookup, attrNameById, keyRegex) {
  const key = Object.keys(attrs).find((k) => {
    const name = attrNameById.get(String(k).trim()) || String(k).trim();
    return keyRegex.test(name);
  });
  if (!key) return '';
  const raw = String(attrs[key] ?? '').trim();
  if (!raw) return '';
  return String(valueLookup[raw] || raw).trim();
}

/**
 * Legal-metrology product name from catalogue Product + Type attributes.
 * @param {{ productAttr?: string, categoryName?: string, productType?: string, productName?: string }} parts
 * @returns {string}
 */
export function formatStatutoryProductName({
  productAttr,
  categoryName,
  productType,
  productName,
} = {}) {
  const product = String(productAttr || '').trim();
  const category = String(categoryName || '').trim();
  const type = String(productType || '').trim();
  const name = String(productName || '').trim();
  const head = product || category;
  if (head && type && !head.includes('(')) return `${head}(${type})`;
  return product || name || (head && type ? `${head}(${type})` : '') || category || type;
}

/**
 * Pair count for a multi-pack SKU.
 * @param {number|string|undefined|null} pack
 * @returns {number}
 */
export function normalizePairCount(pack) {
  const n = Number(pack);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(24, Math.floor(n));
}

/**
 * Turn catalogue pack text into Legal Metrology net quantity.
 * @param {string|number|undefined|null} pack
 * @param {number} [pairCount=1]
 * @returns {string}
 */
export function formatPackToNetQuantity(pack, pairCount = 1) {
  const raw = String(pack || '').trim();
  if (raw && /pair/i.test(raw) && /\d+\s*N/i.test(raw)) return raw;

  const packMatch = raw.match(/(\d+)\s*-?\s*packs?/i);
  if (packMatch) {
    const n = Number(packMatch[1]);
    return `${String(n).padStart(2, '0')} Pair (${n * 2}N)`;
  }
  const pairMatch = raw.match(/(\d+)\s*pairs?/i);
  if (pairMatch) {
    const n = Number(pairMatch[1]);
    return `${String(n).padStart(2, '0')} Pair (${n * 2}N)`;
  }

  const n = normalizePairCount(pairCount);
  return `${String(n).padStart(2, '0')} Pair (${n * 2}N)`;
}

/**
 * Resolve catalogue fields needed on 50×70mm MRP stickers, keyed by styleCode.
 * @param {Array<{ styleCode?: string, skuCode?: string, styleCodeId?: string }>} items
 * @returns {Promise<Map<string, {
 *   eanCode: string,
 *   mrp: number,
 *   brand: string,
 *   pack: string,
 *   colour: string,
 *   productName: string,
 *   productType: string,
 *   pairCount: number,
 *   netQuantity: string,
 *   footLength: string,
 * }>>}
 */
export async function buildBarcodeCatalogByStyleCode(items) {
  const result = new Map();
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return result;

  const styleCodeIds = [
    ...new Set(list.map((item) => item.styleCodeId).filter(Boolean).map((id) => String(id))),
  ];
  const styleCodes = [
    ...new Set(list.map((item) => String(item.styleCode || '').trim()).filter(Boolean)),
  ];
  const skuCodes = [...new Set(list.map((item) => String(item.skuCode || '').trim()).filter(Boolean))];
  const pairKeys = [...new Set([...skuCodes, ...styleCodes])];

  const styleQuery = [];
  if (styleCodeIds.length) styleQuery.push({ _id: { $in: styleCodeIds } });
  if (styleCodes.length) styleQuery.push({ styleCode: { $in: styleCodes } });

  const [styleDocs, pairDocs, valueLookup, attributeDocs] = await Promise.all([
    styleQuery.length
      ? StyleCode.find({ $or: styleQuery }).select('styleCode eanCode mrp brand pack').lean()
      : [],
    pairKeys.length
      ? StyleCodePairs.find({ pairStyleCode: { $in: pairKeys } }).select('pairStyleCode pack').lean()
      : [],
    buildProductAttributeValueLookup(),
    ProductAttribute.find({}).select('name').lean(),
  ]);

  const attrNameById = new Map(
    attributeDocs.map((doc) => [String(doc._id), String(doc.name || '').trim()]),
  );
  const styleById = new Map(styleDocs.map((doc) => [String(doc._id), doc]));
  const styleByCode = new Map(
    styleDocs.map((doc) => [String(doc.styleCode || '').trim().toLowerCase(), doc]),
  );
  const resolvedIds = [...new Set(styleDocs.map((doc) => String(doc._id)))];
  const objectIds = resolvedIds
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const products =
    objectIds.length || resolvedIds.length
      ? await Product.find({
          $or: [
            ...(objectIds.length ? [{ styleCodes: { $in: objectIds } }] : []),
            ...(resolvedIds.length ? [{ styleCodes: { $in: resolvedIds } }] : []),
          ],
        })
          .select('styleCodes name attributes category')
          .populate('category', 'name')
          .lean()
      : [];

  const productByStyleId = new Map();
  for (const product of products) {
    const attrs = toAttrObject(product.attributes);
    const productAttr = attrDisplayValue(attrs, valueLookup, attrNameById, /^product$/i);
    const productType = attrDisplayValue(attrs, valueLookup, attrNameById, /^(product\s*)?type$/i);
    const packAttr = attrDisplayValue(attrs, valueLookup, attrNameById, /^pack$/i);
    const footLength = attrDisplayValue(attrs, valueLookup, attrNameById, /foot\s*length/i);
    const colour = attrDisplayValue(attrs, valueLookup, attrNameById, /^colou?r$/i);
    const categoryName =
      product.category && typeof product.category === 'object'
        ? String(product.category.name || '').trim()
        : '';
    const meta = {
      productName: formatStatutoryProductName({
        productAttr,
        categoryName,
        productType,
        productName: product.name,
      }),
      productType,
      pack: packAttr,
      footLength,
      colour,
    };
    for (const scRef of product.styleCodes || []) {
      const key = styleCodeRefId(scRef);
      if (key && !productByStyleId.has(key)) productByStyleId.set(key, meta);
    }
  }

  const pairBySku = new Map(pairDocs.map((doc) => [String(doc.pairStyleCode || '').trim(), doc]));

  for (const item of list) {
    const code = String(item.styleCode || '').trim();
    if (!code || result.has(code)) continue;

    const styleDoc =
      (item.styleCodeId && styleById.get(String(item.styleCodeId))) ||
      styleByCode.get(code.toLowerCase());
    const productMeta =
      (styleDoc && productByStyleId.get(String(styleDoc._id))) || undefined;
    const pairDoc = pairBySku.get(code);
    const pairCount = pairDoc ? normalizePairCount(pairDoc.pack) : 1;
    const pack = String(productMeta?.pack || '').trim();

    result.set(code, {
      eanCode: String(styleDoc?.eanCode || '').trim(),
      mrp: Number(styleDoc?.mrp || 0),
      brand: String(styleDoc?.brand || '').trim(),
      pack,
      colour: productMeta?.colour || '',
      productName: productMeta?.productName || '',
      productType: productMeta?.productType || '',
      pairCount,
      netQuantity: formatPackToNetQuantity(pack, pairCount),
      footLength: String(productMeta?.footLength || '').trim(),
    });
  }

  return result;
}
