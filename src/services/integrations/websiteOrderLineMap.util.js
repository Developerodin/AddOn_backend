/**
 * Option value by name (case-insensitive partial match).
 * @param {Array<{ name?: string, value?: string }>} options
 * @param {string} nameHint
 * @returns {string}
 */
const optionValue = (options, nameHint) => {
  if (!Array.isArray(options)) return '';
  const hint = nameHint.toLowerCase();
  const match = options.find((o) => String(o?.name || '').toLowerCase().includes(hint));
  return String(match?.value || '').trim();
};

/**
 * Map website product rows onto warehouse single-pair and multi-pair lines.
 * Single match wins. Otherwise the model is a multi-pair when it equals
 * StyleCodePairs.pairStyleCode — a short code (PFR3) or the slash-joined
 * member codes stored as the pair code.
 * @param {Array<object>} products
 * @param {Map<string, { _id: unknown, styleCode?: string, pack?: string }>} singleByCode
 * @param {Map<string, { _id: unknown, pairStyleCode?: string, pack?: number|string, eanCode?: string }>} pairByCode
 * @returns {{ singlePair: object[], multiPair: object[], syncErrors: object[] }}
 */
export const mapWebsiteProductsToLines = (products, singleByCode, pairByCode) => {
  const singlePair = [];
  const multiPair = [];
  const syncErrors = [];

  for (const product of products || []) {
    const model = String(product?.model || '').trim();
    if (!model) {
      syncErrors.push({ model: '', reason: 'missing_model' });
      continue;
    }

    const quantity = Math.max(1, Number(product.quantity) || 1);
    const packOpt = optionValue(product.options, 'pack');
    const colour = optionValue(product.options, 'color') || optionValue(product.options, 'colour');
    const styleDoc = singleByCode.get(model);

    if (styleDoc) {
      singlePair.push({
        styleCodeId: styleDoc._id,
        styleCode: styleDoc.styleCode || model,
        pack: packOpt || styleDoc.pack || '',
        colour,
        quantity,
      });
      continue;
    }

    const pairDoc = pairByCode.get(model);
    if (pairDoc) {
      const packFromPair = pairDoc.pack != null && pairDoc.pack !== '' ? String(pairDoc.pack) : '';
      multiPair.push({
        styleCodeMultiPairId: pairDoc._id,
        styleCode: pairDoc.pairStyleCode || model,
        pack: packOpt || packFromPair,
        colour,
        eanCode: pairDoc.eanCode || '',
        quantity,
      });
      continue;
    }

    syncErrors.push({ model, reason: 'style_code_not_found', quantity });
  }

  return { singlePair, multiPair, syncErrors };
};
