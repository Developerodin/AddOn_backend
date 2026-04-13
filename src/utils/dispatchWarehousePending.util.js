/**
 * How much of each previous-floor `transferredData` row is already consumed by
 * the receiving floor's `receivedData`, using the same (styleCode, brand) matching as
 * `updateArticleFloorReceivedData` (container accept path).
 *
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} dispatchTransferredData
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} warehouseReceivedData
 * @returns {number[]} consumed amount per dispatch row index
 */
export const computeConsumedPerDispatchRow = (dispatchTransferredData, warehouseReceivedData) => {
  const prevTransferredData = Array.isArray(dispatchTransferredData) ? dispatchTransferredData : [];
  const consumedPerEntry = new Array(prevTransferredData.length).fill(0);

  for (const rd of warehouseReceivedData || []) {
    const rdStyle = (rd.styleCode || '').trim();
    const rdBrand = (rd.brand || '').trim();
    let rdRemaining = rd.transferred || 0;
    if (rdRemaining <= 0 || (!rdStyle && !rdBrand)) continue;
    for (let j = 0; j < prevTransferredData.length; j += 1) {
      if (rdRemaining <= 0) break;
      const td = prevTransferredData[j];
      if ((td.styleCode || '').trim() === rdStyle && (td.brand || '').trim() === rdBrand) {
        const available = (td.transferred || 0) - consumedPerEntry[j];
        const take = Math.min(available, rdRemaining);
        if (take > 0) {
          consumedPerEntry[j] += take;
          rdRemaining -= take;
        }
      }
    }
  }

  return consumedPerEntry;
};

/**
 * Dispatch lines not yet matched to warehouse inward (container accept), same rules as server netting.
 *
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} dispatchTransferredData
 * @param {Array<{ transferred?: number, styleCode?: string, brand?: string }>} warehouseReceivedData
 * @returns {Array<{ transferred: number, styleCode: string, brand: string }>}
 */
export const getPendingDispatchTransferredData = (dispatchTransferredData, warehouseReceivedData) => {
  const prevTransferredData = Array.isArray(dispatchTransferredData) ? dispatchTransferredData : [];
  const consumed = computeConsumedPerDispatchRow(prevTransferredData, warehouseReceivedData);
  const out = [];
  for (let j = 0; j < prevTransferredData.length; j += 1) {
    const td = prevTransferredData[j];
    const pending = Math.max(0, (td.transferred || 0) - consumed[j]);
    if (pending > 0) {
      out.push({
        transferred: pending,
        styleCode: td.styleCode || '',
        brand: td.brand || '',
      });
    }
  }
  return out;
};

/**
 * Sum of pending qty from {@link getPendingDispatchTransferredData}.
 */
export const sumPendingDispatchTransferred = (dispatchTransferredData, warehouseReceivedData) => {
  const rows = getPendingDispatchTransferredData(dispatchTransferredData, warehouseReceivedData);
  return rows.reduce((s, r) => s + (r.transferred || 0), 0);
};
