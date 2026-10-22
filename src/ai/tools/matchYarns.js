/** How many name matches are listed before the result becomes TOO_MANY. */
export const YARN_MATCH_LIMIT = 10;

/** Spaces, hyphens, and slashes are token breaks. "2/40s" yields "2" and "40s". */
const TOKEN_SPLIT = /[\s\-/]+/;

/**
 * Dropped before matching. "cotton 40s black yarn ka stock" is "cotton 40s black".
 * @type {Set<string>}
 */
const YARN_STOPWORDS = new Set([
  'yarn',
  'yarns',
  'stock',
  'kg',
  'live',
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
  'do',
  'we',
  'have',
  'of',
  'the',
]);

/**
 * Lowercase tokens. Order does not matter. Empty pieces and stopwords are dropped.
 * @param {string} value
 * @returns {string[]}
 */
export function yarnTokens(value) {
  return String(value || '')
    .toLowerCase()
    .split(TOKEN_SPLIT)
    .map((token) => token.trim())
    .filter((token) => token && !YARN_STOPWORDS.has(token));
}

/**
 * True when every query token appears in the yarn name. "40s" hits "2/40s".
 * @param {string} query
 * @param {string} yarnName
 * @returns {boolean}
 */
export function yarnNameMatches(query, yarnName) {
  const needed = yarnTokens(query);
  if (needed.length === 0) return false;
  const have = new Set(yarnTokens(yarnName));
  return needed.every((token) => have.has(token));
}

/**
 * Count label, the segment before the first hyphen. Keeps slashes: "2/40s", "110/70".
 * @param {string} yarnName
 * @returns {string}
 */
export function countToken(yarnName) {
  const name = String(yarnName || '').trim();
  const dash = name.indexOf('-');
  return (dash === -1 ? name : name.slice(0, dash)).trim();
}

/**
 * Colour label, the segment between the first and second hyphen.
 * @param {string} yarnName
 * @returns {string}
 */
export function colourToken(yarnName) {
  const parts = String(yarnName || '')
    .split('-')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[1] || '';
}

/**
 * Distinct non-empty labels, sorted, capped at 10.
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueCapped(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, YARN_MATCH_LIMIT);
}

/**
 * Classifies active-yarn name matches. One hit, 2–10, more than 10, or none.
 * @param {string} query
 * @param {{ yarnCatalogId: string, yarnName: string }[]} yarns
 * @returns {{ match: { yarnCatalogId: string, yarnName: string } } | { error: 'NOT_FOUND' } | { error: 'AMBIGUOUS', matches: { yarnCatalogId: string, yarnName: string }[] } | { error: 'TOO_MANY', count: number, counts: string[], colours: string[] }}
 */
export function classifyYarnMatches(query, yarns) {
  const matches = yarns
    .filter((yarn) => yarn && yarnNameMatches(query, yarn.yarnName))
    .sort((left, right) => String(left.yarnName).localeCompare(String(right.yarnName)));
  if (matches.length === 0) return { error: 'NOT_FOUND' };
  if (matches.length === 1) return { match: matches[0] };
  if (matches.length <= YARN_MATCH_LIMIT) return { error: 'AMBIGUOUS', matches };
  return {
    error: 'TOO_MANY',
    count: matches.length,
    counts: uniqueCapped(matches.map((yarn) => countToken(yarn.yarnName))),
    colours: uniqueCapped(matches.map((yarn) => colourToken(yarn.yarnName))),
  };
}
