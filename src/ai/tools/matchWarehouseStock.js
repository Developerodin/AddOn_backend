/** How many product name matches are listed before the result becomes TOO_MANY. */
export const WAREHOUSE_MATCH_LIMIT = 10;

/** Same breaks as yarn: spaces, hyphens, and slashes. */
const TOKEN_SPLIT = /[\s\-/]+/;

/**
 * Dropped before matching. "A906 ka warehouse stock" is "a906".
 * Hyphens stay in the lookup key so a style code is still one exact string.
 * @type {Set<string>}
 */
const STOCK_STOPWORDS = new Set([
  'warehouse',
  'whms',
  'stock',
  'stocks',
  'inventory',
  'pack',
  'packs',
  'pair',
  'pairs',
  'piece',
  'pieces',
  'available',
  'total',
  'blocked',
  'quantity',
  'qty',
  'style',
  'code',
  'ean',
  'factory',
  'product',
  'item',
  'kitna',
  'kitni',
  'kitne',
  'ka',
  'ki',
  'ke',
  'hai',
  'hain',
  'how',
  'much',
  'many',
  'what',
  'is',
  'the',
  'of',
  'do',
  'we',
  'have',
  'in',
  'for',
  'please',
  'show',
  'me',
  'kya',
  'batao',
  'bata',
]);

/**
 * Lowercase phrase with stopwords removed. Whitespace only, so "SC-100" stays intact.
 * @param {string} value
 * @returns {string}
 */
export function warehouseLookupKey(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token && !STOCK_STOPWORDS.has(token))
    .join(' ');
}

/**
 * Name tokens. Stopwords are already gone. Then split on space, hyphen, and slash.
 * @param {string} value
 * @returns {string[]}
 */
export function warehouseNameTokens(value) {
  return warehouseLookupKey(value)
    .split(TOKEN_SPLIT)
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * True when every query token appears in the product name.
 * @param {string} query
 * @param {string} productName
 * @returns {boolean}
 */
export function productNameMatches(query, productName) {
  const needed = warehouseNameTokens(query);
  if (needed.length === 0) return false;
  const have = new Set(warehouseNameTokens(productName));
  return needed.every((token) => have.has(token));
}

/**
 * EAN placeholder. "NA" and "N/A" never select a style.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isNaEan(value) {
  const letters = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return letters === 'na';
}

/**
 * Classifies active-product name matches. One hit, 2–10, more than 10, or none.
 * @param {string} query
 * @param {{ productId: string, factoryCode: string, name: string }[]} products
 * @returns {{ match: { productId: string, factoryCode: string, name: string } } | { error: 'NOT_FOUND' } | { error: 'AMBIGUOUS', matches: { productId: string, factoryCode: string, name: string }[] } | { error: 'TOO_MANY', count: number }}
 */
export function classifyProductNameMatches(query, products) {
  const matches = products
    .filter((product) => product && productNameMatches(query, product.name))
    .sort((left, right) => {
      const byCode = String(left.factoryCode).localeCompare(String(right.factoryCode));
      if (byCode !== 0) return byCode;
      return String(left.name).localeCompare(String(right.name));
    });
  if (matches.length === 0) return { error: 'NOT_FOUND' };
  if (matches.length === 1) return { match: matches[0] };
  if (matches.length <= WAREHOUSE_MATCH_LIMIT) return { error: 'AMBIGUOUS', matches };
  return { error: 'TOO_MANY', count: matches.length };
}
