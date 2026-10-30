/**
 * Which PATCH `transferredData` rows become container `transferItems`.
 * Floors that merge a client delta into a cumulative ledger must stage the delta, not a prefix of the ledger.
 */

/** Floors that replace `transferredData` with a merged cumulative ledger (branding uses its own field). */
const MERGED_TRANSFERRED_DELTA_FLOORS = new Set(['reBoarding', 'finalChecking', 'dispatch']);

/**
 * Snapshot the client `transferredData` delta before the server replaces it with the merged ledger.
 * Branding keeps `_incomingBrandingDelta` so Heat Transfer vs Embroidery routing still reads the batch.
 * Re-boarding, final checking, and dispatch keep `_incomingTransferredDelta` for container line attribution.
 *
 * @param {string} floorKey
 * @param {{ transferredData?: unknown, _incomingBrandingDelta?: unknown[], _incomingTransferredDelta?: unknown[] }} bodyForPatch
 * @returns {void}
 */
export function preserveIncomingTransferredDelta(floorKey, bodyForPatch) {
  if (!bodyForPatch || !Array.isArray(bodyForPatch.transferredData)) return;

  if (floorKey === 'branding') {
    bodyForPatch._incomingBrandingDelta = [...bodyForPatch.transferredData];
    return;
  }

  if (MERGED_TRANSFERRED_DELTA_FLOORS.has(floorKey)) {
    bodyForPatch._incomingTransferredDelta = [...bodyForPatch.transferredData];
  }
}

/**
 * Rows to pass into receipt normalization when staging a container.
 * Branding prefers `_incomingBrandingDelta`. Other merged floors prefer `_incomingTransferredDelta`.
 * Floors that do not merge (secondary checking) fall through to `transferredData` on the patch body.
 *
 * @param {string} floorKey
 * @param {{ transferredData?: unknown, _incomingBrandingDelta?: unknown, _incomingTransferredDelta?: unknown }} [bodyForPatch]
 * @returns {unknown[]|undefined}
 */
export function resolveContainerTransferBreakdownSource(floorKey, bodyForPatch) {
  if (floorKey === 'branding' && Array.isArray(bodyForPatch?._incomingBrandingDelta)) {
    return bodyForPatch._incomingBrandingDelta;
  }
  if (Array.isArray(bodyForPatch?._incomingTransferredDelta)) {
    return bodyForPatch._incomingTransferredDelta;
  }
  return bodyForPatch?.transferredData;
}
