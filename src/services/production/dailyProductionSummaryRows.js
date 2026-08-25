import { ProductionFloor } from '../../models/production/enums.js';

/**
 * Row definitions for the Daily Production Summary report.
 *
 * Three row kinds:
 * - `floor`  — production = quantity transferred OUT of `floor` on that IST date
 *              (sourced from article_logs transfer deltas, downstream transfers only).
 *              Used for non-QC floors, which have no quality split.
 * - `m1`     — production = M1 (good quality) booked on `sourceFloor` on that IST date
 *              (sourced from article_logs 'M1 Quantity Updated' deltas). Used for the QC
 *              floors, where M1 is the real output. On a QC floor the M1 row plus its
 *              M2/M3/M4 rows sum to everything inspected on that floor that day.
 * - `defect` — quantity booked into the M2/M3/M4 ledger from `sourceFloor` on that IST date
 *              (sourced from m2_logs / m3_logs / m4_logs ENTRY deltas)
 *
 * Rows flagged `extra: true` are omitted unless the caller passes `includeExtraRows`.
 * Only Re-Boarding is gated, because it is absent from most production flows.
 */

/** Row kind: production derived from outbound floor transfers. */
export const ROW_KIND_FLOOR = 'floor';

/** Row kind: production derived from M1 (good quality) booked on a QC floor. */
export const ROW_KIND_M1 = 'm1';

/** Row kind: production derived from an M2/M3/M4 defect ledger. */
export const ROW_KIND_DEFECT = 'defect';

/** Defect ledger categories, matching the m2_logs / m3_logs / m4_logs collections. */
export const DEFECT_CATEGORY = {
  M2: 'M2',
  M3: 'M3',
  M4: 'M4',
};

/**
 * Ordered row definitions, top to bottom, exactly as they appear in the report.
 * @type {Array<{ key: string, label: string, kind: string, floor?: string, category?: string, sourceFloor?: string, extra?: boolean }>}
 */
export const DAILY_PRODUCTION_SUMMARY_ROWS = [
  { key: 'knitting', label: 'Knitting', kind: ROW_KIND_FLOOR, floor: ProductionFloor.KNITTING },
  {
    key: 'knittingM4',
    label: 'Knitting M4',
    kind: ROW_KIND_DEFECT,
    category: DEFECT_CATEGORY.M4,
    sourceFloor: ProductionFloor.KNITTING,
  },

  { key: 'linking', label: 'Rosso', kind: ROW_KIND_FLOOR, floor: ProductionFloor.LINKING },

  {
    key: 'checking',
    label: 'Checking',
    kind: ROW_KIND_M1,
    sourceFloor: ProductionFloor.CHECKING,
  },
  {
    key: 'checkingM2',
    label: 'M2',
    kind: ROW_KIND_DEFECT,
    category: DEFECT_CATEGORY.M2,
    sourceFloor: ProductionFloor.CHECKING,
  },
  {
    key: 'checkingM3',
    label: 'M3',
    kind: ROW_KIND_DEFECT,
    category: DEFECT_CATEGORY.M3,
    sourceFloor: ProductionFloor.CHECKING,
  },
  {
    key: 'checkingM4',
    label: 'M4',
    kind: ROW_KIND_DEFECT,
    category: DEFECT_CATEGORY.M4,
    sourceFloor: ProductionFloor.CHECKING,
  },

  { key: 'washing', label: 'Washing', kind: ROW_KIND_FLOOR, floor: ProductionFloor.WASHING },
  { key: 'boarding', label: 'Boarding', kind: ROW_KIND_FLOOR, floor: ProductionFloor.BOARDING },
  { key: 'silicon', label: 'Silicon', kind: ROW_KIND_FLOOR, floor: ProductionFloor.SILICON },

  {
    key: 'secondaryChecking',
    label: 'Secondary Checking',
    kind: ROW_KIND_M1,
    sourceFloor: ProductionFloor.SECONDARY_CHECKING,
  },
  {
    key: 'secondaryCheckingM2',
    label: 'M2',
    kind: ROW_KIND_DEFECT,
    category: DEFECT_CATEGORY.M2,
    sourceFloor: ProductionFloor.SECONDARY_CHECKING,
  },
  {
    key: 'secondaryCheckingM3',
    label: 'M3',
    kind: ROW_KIND_DEFECT,
    category: DEFECT_CATEGORY.M3,
    sourceFloor: ProductionFloor.SECONDARY_CHECKING,
  },
  {
    key: 'secondaryCheckingM4',
    label: 'M4',
    kind: ROW_KIND_DEFECT,
    category: DEFECT_CATEGORY.M4,
    sourceFloor: ProductionFloor.SECONDARY_CHECKING,
  },

  { key: 'branding', label: 'Branding', kind: ROW_KIND_FLOOR, floor: ProductionFloor.BRANDING },
  {
    key: 'reBoarding',
    label: 'Re-Boarding',
    kind: ROW_KIND_FLOOR,
    floor: ProductionFloor.RE_BOARDING,
    extra: true,
  },

  {
    key: 'finalChecking',
    label: 'Final Checking',
    kind: ROW_KIND_M1,
    sourceFloor: ProductionFloor.FINAL_CHECKING,
  },
  {
    key: 'finalCheckingM2',
    label: 'M2',
    kind: ROW_KIND_DEFECT,
    category: DEFECT_CATEGORY.M2,
    sourceFloor: ProductionFloor.FINAL_CHECKING,
  },
  {
    key: 'finalCheckingM3',
    label: 'M3',
    kind: ROW_KIND_DEFECT,
    category: DEFECT_CATEGORY.M3,
    sourceFloor: ProductionFloor.FINAL_CHECKING,
  },
  {
    key: 'finalCheckingM4',
    label: 'M4',
    kind: ROW_KIND_DEFECT,
    category: DEFECT_CATEGORY.M4,
    sourceFloor: ProductionFloor.FINAL_CHECKING,
  },

  // "Ready For Dispatch" = transferred OUT of the Dispatch floor (into Warehouse).
  // Deliberately not "out of Final Checking", which is already the Final Checking row.
  {
    key: 'dispatch',
    label: 'Ready For Dispatch',
    kind: ROW_KIND_FLOOR,
    floor: ProductionFloor.DISPATCH,
  },
];

/**
 * Resolves the visible row definitions for a request.
 * @param {boolean} [includeExtraRows=false] Include the Re-Boarding row.
 * @returns {Array<object>} Ordered row definitions.
 */
export const getVisibleRows = (includeExtraRows = false) =>
  includeExtraRows
    ? DAILY_PRODUCTION_SUMMARY_ROWS
    : DAILY_PRODUCTION_SUMMARY_ROWS.filter((row) => !row.extra);
