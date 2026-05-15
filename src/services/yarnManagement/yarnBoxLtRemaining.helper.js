/**
 * LT remaining box weight must subtract both cones currently in short-term storage and cones
 * returned to the vendor. Vendor-returned cones are neither on the LT pallet nor in ST; omitting
 * them incorrectly increases `boxWeight` because `base - sum(ST)` treats every missing cone as still on LT.
 *
 * @param {{ initialBoxWeight?: number|null, boxWeight?: number|null }} box
 * @param {Array<{ coneWeight?: number }>} conesInST
 * @param {Array<{ coneWeight?: number }>} conesReturnedVendor
 * @returns {{ remaining: number, fullyTransferred: boolean, baseWeight: number }}
 */
export function computeLtRemainingBoxWeight(box, conesInST, conesReturnedVendor) {
  const totalConeWeightST = (conesInST || []).reduce((sum, c) => sum + (c.coneWeight || 0), 0);
  const totalReturned = (conesReturnedVendor || []).reduce((sum, c) => sum + (c.coneWeight || 0), 0);
  const initial = box.initialBoxWeight != null ? Number(box.initialBoxWeight) : 0;
  const boxWeightNow = Number(box.boxWeight ?? 0);
  const inferredBase =
    boxWeightNow >= totalConeWeightST ? boxWeightNow : boxWeightNow + totalConeWeightST;
  const baseWeight = initial > 0 ? initial : inferredBase;
  const remaining = Math.max(0, baseWeight - totalConeWeightST - totalReturned);
  const fullyTransferred = conesInST.length > 0 && remaining <= 0.001;
  return { remaining, fullyTransferred, baseWeight };
}
