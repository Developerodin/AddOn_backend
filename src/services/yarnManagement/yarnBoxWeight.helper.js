/**
 * YarnBox net/gross resolution — mirrors FE `boxWeightDisplay.ts`.
 *
 * Canonical: `boxWeight` is yarn net. Legacy LT rows stored carton gross in
 * both `boxWeight` and `grossWeight`; net is then gross − tare.
 */

/** Equality epsilon (kg) when comparing boxWeight to grossWeight. */
export const BOX_WEIGHT_EQ_EPS_KG = 0.0001;

/**
 * @typedef {Object} BoxWeightSource
 * @property {number|null} [boxWeight]
 * @property {number|null} [tearweight]
 * @property {number|null} [grossWeight]
 */

/**
 * Coerces a weight field to a finite number, or null when missing/invalid.
 * @param {unknown} value
 * @returns {number|null}
 */
function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Clamps an aggregation expression to >= 0 without `$max` arrays (Mongo 4.x).
 * @param {object} expr
 * @returns {object}
 */
function mongoNonNegative(expr) {
  return { $cond: [{ $gt: [expr, 0] }, expr, 0] };
}

/**
 * Resolves yarn net kg for a box.
 * - boxWeight ≈ grossWeight → legacy gross-in-boxWeight; net = gross − tare
 * - boxWeight < grossWeight → canonical net already in boxWeight
 * - no grossWeight → net = boxWeight − tare
 * @param {BoxWeightSource} [box]
 * @returns {number} Net kg (>= 0)
 */
export function resolveBoxNetWeightKg(box) {
  const bw = toFiniteNumber(box?.boxWeight);
  if (bw == null) return 0;
  const gw = toFiniteNumber(box?.grossWeight);
  const tw = toFiniteNumber(box?.tearweight) ?? 0;
  if (gw != null && gw > 0) {
    if (Math.abs(bw - gw) <= BOX_WEIGHT_EQ_EPS_KG) {
      return Math.max(0, gw - tw);
    }
    if (bw <= gw + BOX_WEIGHT_EQ_EPS_KG) {
      return Math.max(0, bw);
    }
  }
  return Math.max(0, bw - tw);
}

/**
 * Mongo expression equivalent of {@link resolveBoxNetWeightKg} for `$sum` / `$group`.
 * @returns {object}
 */
export function mongoBoxNetWeightExpr() {
  const eps = BOX_WEIGHT_EQ_EPS_KG;
  return {
    $let: {
      vars: {
        bw: { $ifNull: ['$boxWeight', 0] },
        gw: { $ifNull: ['$grossWeight', 0] },
        tw: { $ifNull: ['$tearweight', 0] },
      },
      in: {
        $cond: [
          { $gt: ['$$gw', 0] },
          {
            $cond: [
              { $lte: [{ $abs: { $subtract: ['$$bw', '$$gw'] } }, eps] },
              mongoNonNegative({ $subtract: ['$$gw', '$$tw'] }),
              {
                $cond: [
                  { $lte: ['$$bw', { $add: ['$$gw', eps] }] },
                  mongoNonNegative('$$bw'),
                  mongoNonNegative({ $subtract: ['$$bw', '$$tw'] }),
                ],
              },
            ],
          },
          mongoNonNegative({ $subtract: ['$$bw', '$$tw'] }),
        ],
      },
    },
  };
}
