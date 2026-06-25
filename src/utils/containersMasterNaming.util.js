/**
 * Parse a container name ending with a numeric suffix (e.g. "Container 1100", "Bag-5").
 * @param {string} name
 * @returns {{ prefix: string, separator: string, number: number } | null}
 */
export function parseContainerNameWithNumber(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;

  const withSep = trimmed.match(/^(.+?)([\s_-]+)(\d+)$/);
  if (withSep) {
    return {
      prefix: withSep[1].trim(),
      separator: withSep[2],
      number: parseInt(withSep[3], 10),
    };
  }

  const tight = trimmed.match(/^(.+?)(\d+)$/);
  if (tight) {
    return {
      prefix: tight[1].trim(),
      separator: ' ',
      number: parseInt(tight[2], 10),
    };
  }

  return null;
}

/**
 * Build a display label for a naming pattern.
 * @param {string} prefix
 * @param {string} separator
 * @returns {string}
 */
export function formatNamingPatternLabel(prefix, separator) {
  const sep = separator || ' ';
  return `${prefix}${sep}{n}`;
}

/**
 * Detect naming patterns from stored container names (most common prefix first).
 * @param {Array<{ containerName?: string, type?: string, tearWeight?: number }>} docs
 * @returns {Array<{ id: string, label: string, prefix: string, separator: string, nextNumber: number, count: number, suggestedType: string | null, suggestedTearWeight: number | null }>}
 */
export function buildContainerNamingPatterns(docs) {
  /** @type {Map<string, { prefix: string, separator: string, maxNumber: number, count: number, types: Set<string>, tearWeights: number[] }>} */
  const byKey = new Map();

  for (const doc of docs) {
    const parsed = parseContainerNameWithNumber(doc.containerName);
    if (!parsed || !Number.isFinite(parsed.number)) continue;

    const key = `${parsed.prefix.toLowerCase()}::${parsed.separator}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        prefix: parsed.prefix,
        separator: parsed.separator,
        maxNumber: 0,
        count: 0,
        types: new Set(),
        tearWeights: [],
      });
    }

    const entry = byKey.get(key);
    entry.maxNumber = Math.max(entry.maxNumber, parsed.number);
    entry.count += 1;
    if (doc.type) entry.types.add(doc.type);
    if (typeof doc.tearWeight === 'number' && Number.isFinite(doc.tearWeight)) {
      entry.tearWeights.push(doc.tearWeight);
    }
  }

  const patterns = Array.from(byKey.entries())
    .map(([id, entry]) => {
      const suggestedType = entry.types.size === 1 ? [...entry.types][0] : null;
      const suggestedTearWeight =
        entry.tearWeights.length > 0
          ? entry.tearWeights.reduce((sum, w) => sum + w, 0) / entry.tearWeights.length
          : null;

      return {
        id,
        label: formatNamingPatternLabel(entry.prefix, entry.separator),
        prefix: entry.prefix,
        separator: entry.separator,
        nextNumber: entry.maxNumber + 1,
        count: entry.count,
        suggestedType,
        suggestedTearWeight:
          suggestedTearWeight != null ? Math.round(suggestedTearWeight * 1000) / 1000 : null,
      };
    })
    .sort((a, b) => b.count - a.count);

  return patterns;
}

/**
 * Resolve naming pattern by id or return default fallback.
 * @param {Array<{ id: string, prefix: string, separator: string, nextNumber: number }>} patterns
 * @param {string | undefined} namePatternId
 * @param {number} existingCount
 * @returns {{ prefix: string, separator: string, nextNumber: number, label: string }}
 */
export function resolveContainerNamingPattern(patterns, namePatternId, existingCount) {
  const selected = namePatternId
    ? patterns.find((p) => p.id === namePatternId)
    : patterns[0];

  if (selected) {
    return {
      prefix: selected.prefix,
      separator: selected.separator,
      nextNumber: selected.nextNumber,
      label: formatNamingPatternLabel(selected.prefix, selected.separator),
    };
  }

  return {
    prefix: 'Container',
    separator: ' ',
    nextNumber: existingCount + 1,
    label: 'Container {n}',
  };
}

/**
 * Format a container name from pattern parts.
 * @param {string} prefix
 * @param {string} separator
 * @param {number} number
 * @returns {string}
 */
export function formatContainerName(prefix, separator, number) {
  return `${prefix}${separator || ' '}${number}`;
}
