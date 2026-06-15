/**
 * Whether secondary checking is ready for GRN: all boxes scanned, fully classified.
 * @param {Object|null|undefined} sc - `floorQuantities.secondaryChecking`
 * @returns {boolean}
 */
export function isScReadyForGrn(sc) {
  const received = Number(sc?.received || 0);
  if (received <= 0) return false;
  const pendingFromBoxes = Number(sc?.pendingFromBoxes ?? 0);
  if (pendingFromBoxes > 0) return false;
  const m1 = Number(sc?.m1Quantity || 0);
  const m2 = Number(sc?.m2Quantity || 0);
  const m3 = Number(sc?.m3Quantity || 0);
  const m4 = Number(sc?.m4Quantity || 0);
  const remaining = Number(sc?.remaining ?? received - m1 - m2 - m3 - m4);
  return remaining === 0 && m1 + m2 + m3 + m4 === received;
}
