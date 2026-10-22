const DEVANAGARI_RE = /[\u0900-\u097F]/;

/**
 * Longer markers first so "hain" is not also counted as "hai", and "ke liye" stays one hit.
 * Two hits means Hinglish. One hit in an English sentence stays English.
 */
const MARKERS = [
  'ke liye',
  'ho chuke',
  'chahiye',
  'dikhao',
  'kitne',
  'kitna',
  'batao',
  'kaise',
  'kahan',
  'mujhe',
  'hain',
  'mein',
  'abhi',
  'nahi',
  'kisi',
  'kis',
  'kya',
  'hai',
  'bata',
  'pe',
];

/**
 * Word-boundary pattern. Spaces inside a phrase still count as one marker.
 * @param {string} marker
 * @returns {RegExp}
 */
function markerPattern(marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  return new RegExp(`\\b${escaped}\\b`, 'g');
}

/**
 * How many Hinglish markers are in the text. Each match is blanked before the next marker.
 * @param {string} text
 * @returns {number}
 */
function markerCount(text) {
  const counted = MARKERS.reduce(
    (state, marker) => {
      const pattern = markerPattern(marker);
      const hits = state.rest.match(pattern);
      if (!hits) return state;
      pattern.lastIndex = 0;
      return {
        count: state.count + hits.length,
        rest: state.rest.replace(pattern, ' '),
      };
    },
    { count: 0, rest: text.toLowerCase() }
  );
  return counted.count;
}

/**
 * 'hinglish' when the text has Devanagari or at least two Hinglish markers, otherwise 'english'.
 * @param {string} text
 * @returns {'hinglish'|'english'}
 */
export function detectLanguage(text) {
  const raw = String(text || '');
  if (DEVANAGARI_RE.test(raw)) return 'hinglish';
  if (markerCount(raw) >= 2) return 'hinglish';
  return 'english';
}

/**
 * One system-prompt line for this turn. Hinglish stays in Roman script.
 * @param {string} text Latest user message
 * @returns {string}
 */
export function languageInstruction(text) {
  if (detectLanguage(text) === 'hinglish') return 'Reply in Hinglish (Roman script).';
  return 'Reply in English.';
}
