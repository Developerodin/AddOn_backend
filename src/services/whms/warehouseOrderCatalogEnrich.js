import Product from '../../models/product.model.js';
import ProductAttribute from '../../models/productAttribute.model.js';

/**
 * Build a map of product-attribute option value id → display name.
 * @returns {Promise<Record<string, string>>}
 */
export const buildProductAttributeValueLookup = async () => {
  const categories = await ProductAttribute.find({}).select('optionValues').lean();
  const lookup = {};
  for (const cat of categories) {
    for (const val of cat.optionValues || []) {
      if (val._id) lookup[String(val._id)] = val.name || '';
    }
  }
  return lookup;
};

/**
 * Resolve Colour + Pattern strings from a product attributes map.
 * @param {Map<string, string>|Record<string, string>|null|undefined} productAttributes
 * @param {Record<string, string>} valueLookup
 * @returns {{ colour: string; pattern: string }}
 */
export const resolveColourPatternFromProductAttributes = (productAttributes, valueLookup) => {
  if (!productAttributes) return { colour: '', pattern: '' };

  const attrs =
    productAttributes instanceof Map
      ? Object.fromEntries(productAttributes)
      : productAttributes;

  if (!attrs || typeof attrs !== 'object') return { colour: '', pattern: '' };

  const colourKey = Object.keys(attrs).find((k) => /^colou?r$/i.test(k));
  const patternKey = Object.keys(attrs).find((k) => /^pattern$/i.test(k));

  const colourRaw = colourKey ? String(attrs[colourKey] ?? '') : '';
  const patternRaw = patternKey ? String(attrs[patternKey] ?? '') : '';

  return {
    colour: valueLookup[colourRaw] || colourRaw || '',
    pattern: valueLookup[patternRaw] || patternRaw || '',
  };
};

/**
 * For each style-code id, find a linked product and resolve catalogue colour/pattern.
 * When multiple products link to the same style code, the first match wins.
 * @param {string[]} styleCodeIds
 * @returns {Promise<Map<string, { colour: string; pattern: string }>>}
 */
export const buildArticleAttrsByStyleCodeId = async (styleCodeIds) => {
  const uniqueIds = [...new Set(styleCodeIds.map((id) => String(id)).filter(Boolean))];
  const result = new Map();
  if (!uniqueIds.length) return result;

  const [valueLookup, products] = await Promise.all([
    buildProductAttributeValueLookup(),
    Product.find({ styleCodes: { $in: uniqueIds } })
      .select('styleCodes attributes')
      .lean(),
  ]);

  for (const product of products) {
    const resolved = resolveColourPatternFromProductAttributes(product.attributes, valueLookup);
    for (const scId of product.styleCodes || []) {
      const key = String(scId);
      if (uniqueIds.includes(key) && !result.has(key)) {
        result.set(key, resolved);
      }
    }
  }

  return result;
};

/**
 * Pick Excel-provided value or fall back to catalogue default.
 * @param {string|undefined|null} excelValue
 * @param {string|undefined|null} catalogValue
 * @returns {string}
 */
export const coalesceLineField = (excelValue, catalogValue) => {
  const fromExcel = String(excelValue ?? '').trim();
  if (fromExcel) return fromExcel;
  return String(catalogValue ?? '').trim();
};
