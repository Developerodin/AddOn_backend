import { ArticleLog, M2Log, M3Log, M4Log } from '../../models/production/index.js';
import { LogAction, M2LogType, M3LogType, M4LogType } from '../../models/production/enums.js';
import { ALL_FLOOR_NAMES } from '../../utils/floorLabelMap.js';
import { IST_TIMEZONE, resolveIstMonthPeriod } from '../../utils/istPeriod.util.js';
import {
  DEFECT_CATEGORY,
  ROW_KIND_DEFECT,
  ROW_KIND_FLOOR,
  ROW_KIND_M1,
  getVisibleRows,
} from './dailyProductionSummaryRows.js';

/**
 * Daily Production Summary report.
 *
 * Production for an IST calendar date depends on the floor type:
 * - QC floors (Checking, Secondary Checking, Final Checking) report M1, the good-quality
 *   quantity booked that day, so the M1 row plus its M2/M3/M4 rows account for everything
 *   inspected on that floor that day.
 * - All other floors report the quantity transferred OUT that day, since they have no
 *   quality split.
 *
 * Every source stores per-event deltas (not running totals), so a plain per-day sum is
 * correct. All bucketing uses the event `timestamp` converted to Asia/Kolkata.
 */

const CACHE_TTL_MS = 60 * 1000;

const cache = new Map();

/** The 12 `Transferred to <Floor>` LogAction values written by createTransferLog. */
const TRANSFER_ACTIONS = Object.values(LogAction).filter((action) =>
  action.startsWith('Transferred to ')
);

/** Defect ledger models keyed by category, all sharing the same log shape. */
const DEFECT_LEDGERS = [
  { category: DEFECT_CATEGORY.M2, model: M2Log, entryType: M2LogType.ENTRY },
  { category: DEFECT_CATEGORY.M3, model: M3Log, entryType: M3LogType.ENTRY },
  { category: DEFECT_CATEGORY.M4, model: M4Log, entryType: M4LogType.ENTRY },
];

/**
 * Coerces a value to a finite number, defaulting to 0.
 * @param {unknown} value
 * @returns {number}
 */
const toNumber = (value) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * `$dateToString` expression bucketing an event timestamp into an IST calendar date.
 * @param {string} field Field path, e.g. '$timestamp'.
 * @returns {object}
 */
const istDateExpr = (field) => ({
  $dateToString: { format: '%Y-%m-%d', date: field, timezone: IST_TIMEZONE },
});

/**
 * Adds a quantity into a nested series map.
 * @param {Map<string, Map<string, number>>} series
 * @param {string} groupKey
 * @param {string} dateKey
 * @param {number} qty
 */
const addToSeries = (series, groupKey, dateKey, qty) => {
  if (!groupKey || !dateKey || !qty) return;
  let byDate = series.get(groupKey);
  if (!byDate) {
    byDate = new Map();
    series.set(groupKey, byDate);
  }
  byDate.set(dateKey, (byDate.get(dateKey) || 0) + qty);
};

/**
 * Aggregates outbound floor transfers into a floor-by-date quantity series.
 *
 * Grouping keeps `toFloor` so upstream movements can be dropped: M2 repair sends use the
 * same transfer log shape but point backwards (see transferM2ForRepair), and counting
 * them would inflate the QC floor rows.
 *
 * @param {{ monthStart: Date, monthEndExclusive: Date }} period
 * @returns {Promise<{ series: Map<string, Map<string, number>>, repairExcludedQty: number, unknownFloorQty: number, countedQty: number }>}
 */
const buildTransferSeries = async (period) => {
  const groups = await ArticleLog.aggregate([
    {
      $match: {
        timestamp: { $gte: period.monthStart, $lt: period.monthEndExclusive },
        action: { $in: TRANSFER_ACTIONS },
        quantity: { $gt: 0 },
        fromFloor: { $nin: [null, ''] },
      },
    },
    {
      $group: {
        _id: {
          date: istDateExpr('$timestamp'),
          fromFloor: '$fromFloor',
          toFloor: '$toFloor',
        },
        qty: { $sum: '$quantity' },
      },
    },
  ]);

  const series = new Map();
  let repairExcludedQty = 0;
  let unknownFloorQty = 0;
  let countedQty = 0;

  for (const group of groups) {
    const { date, fromFloor, toFloor } = group._id;
    const qty = toNumber(group.qty);
    if (qty <= 0) continue;

    const fromIndex = ALL_FLOOR_NAMES.indexOf(fromFloor);
    const toIndex = ALL_FLOOR_NAMES.indexOf(toFloor);

    if (fromIndex === -1 || toIndex === -1) {
      unknownFloorQty += qty;
      continue;
    }
    if (toIndex <= fromIndex) {
      repairExcludedQty += qty;
      continue;
    }

    addToSeries(series, fromFloor, date, qty);
    countedQty += qty;
  }

  return { series, repairExcludedQty, unknownFloorQty, countedQty };
};

/**
 * Aggregates M1 (good quality) bookings into a QC-floor-by-date quantity series.
 *
 * Reads the `M1 Quantity Updated` article log, whose `quantity` is already the delta
 * applied by that event. Negative deltas (corrections and reverts) are kept so a day that
 * walks back an over-booking nets out correctly.
 *
 * @param {{ monthStart: Date, monthEndExclusive: Date }} period
 * @returns {Promise<Map<string, Map<string, number>>>}
 */
const buildM1Series = async (period) => {
  const groups = await ArticleLog.aggregate([
    {
      $match: {
        timestamp: { $gte: period.monthStart, $lt: period.monthEndExclusive },
        action: LogAction.M1_QUANTITY_UPDATED,
        fromFloor: { $nin: [null, ''] },
      },
    },
    {
      $group: {
        _id: { date: istDateExpr('$timestamp'), floor: '$fromFloor' },
        qty: { $sum: '$quantity' },
      },
    },
  ]);

  const series = new Map();
  for (const group of groups) {
    addToSeries(series, group._id.floor, group._id.date, toNumber(group.qty));
  }
  return series;
};

/**
 * Aggregates one defect ledger's ENTRY events into a sourceFloor-by-date quantity series.
 * @param {import('mongoose').Model} model M2Log, M3Log or M4Log.
 * @param {string} entryType The ledger's ENTRY type value.
 * @param {{ monthStart: Date, monthEndExclusive: Date }} period
 * @returns {Promise<Map<string, Map<string, number>>>}
 */
const buildDefectSeries = async (model, entryType, period) => {
  const groups = await model.aggregate([
    {
      $match: {
        type: entryType,
        quantity: { $gt: 0 },
        timestamp: { $gte: period.monthStart, $lt: period.monthEndExclusive },
        sourceFloor: { $nin: [null, ''] },
      },
    },
    {
      $group: {
        _id: { date: istDateExpr('$timestamp'), sourceFloor: '$sourceFloor' },
        qty: { $sum: '$quantity' },
      },
    },
  ]);

  const series = new Map();
  for (const group of groups) {
    addToSeries(series, group._id.sourceFloor, group._id.date, toNumber(group.qty));
  }
  return series;
};

/**
 * Resolves the per-date series backing a single report row.
 * @param {object} row Row definition.
 * @param {{ transferSeries: Map<string, Map<string, number>>, m1Series: Map<string, Map<string, number>>, defectSeries: Map<string, Map<string, Map<string, number>>> }} sources
 * @returns {Map<string, number>|undefined}
 */
const resolveRowSeries = (row, { transferSeries, m1Series, defectSeries }) => {
  if (row.kind === ROW_KIND_FLOOR) {
    return transferSeries.get(row.floor);
  }
  if (row.kind === ROW_KIND_M1) {
    return m1Series.get(row.sourceFloor);
  }
  if (row.kind === ROW_KIND_DEFECT) {
    return defectSeries.get(row.category)?.get(row.sourceFloor);
  }
  return undefined;
};

/**
 * Builds report rows plus per-date and grand totals.
 * Future dates are null (not zero) so the UI can leave them blank.
 * @param {Array<object>} rowDefs
 * @param {{ dateKeys: string[], todayKey: string }} period
 * @param {{ transferSeries: Map, m1Series: Map, defectSeries: Map }} sources
 * @returns {{ rows: Array<object>, columnTotals: Record<string, number|null>, grandTotal: number }}
 */
const buildRows = (rowDefs, period, sources) => {
  const columnTotals = {};
  for (const dateKey of period.dateKeys) {
    columnTotals[dateKey] = dateKey > period.todayKey ? null : 0;
  }

  let grandTotal = 0;

  const rows = rowDefs.map((row) => {
    const series = resolveRowSeries(row, sources);
    const values = {};
    let total = 0;

    for (const dateKey of period.dateKeys) {
      if (dateKey > period.todayKey) {
        values[dateKey] = null;
        continue;
      }
      const qty = Math.round(toNumber(series?.get(dateKey)));
      values[dateKey] = qty;
      total += qty;
      columnTotals[dateKey] += qty;
    }

    grandTotal += total;

    return {
      key: row.key,
      label: row.label,
      kind: row.kind,
      floor: row.floor ?? null,
      category: row.category ?? null,
      sourceFloor: row.sourceFloor ?? null,
      values,
      total,
    };
  });

  return { rows, columnTotals, grandTotal };
};

/**
 * Human-readable warnings about data the report knowingly excludes or cannot see.
 *
 * The "no logs at all" warnings matter most: transfer and M1 history both live in
 * article_logs, which is written only from the moment those code paths ran. A month that
 * predates them reads as all-zero, which is indistinguishable from genuinely idle floors
 * unless the report says so explicitly.
 *
 * @param {{ transferMeta: { repairExcludedQty: number, unknownFloorQty: number, countedQty: number }, rows: Array<object>, includeExtraRows: boolean }} params
 * @returns {string[]}
 */
const buildWarnings = ({ transferMeta, rows, includeExtraRows }) => {
  const warnings = [];
  const { repairExcludedQty, unknownFloorQty, countedQty } = transferMeta;

  if (countedQty === 0) {
    warnings.push(
      'No floor transfer logs exist for this month, so every non-QC floor row reads zero. This is missing history in article_logs, not idle floors.'
    );
  }

  // A QC floor with defects but no M1 was demonstrably working that month, so its blank M1
  // row is missing history rather than a floor that passed nothing. Reported per floor
  // because floors were not all onboarded to M1 logging at the same time.
  const defectTotalByFloor = new Map();
  for (const row of rows) {
    if (row.kind !== ROW_KIND_DEFECT || !row.sourceFloor) continue;
    defectTotalByFloor.set(
      row.sourceFloor,
      (defectTotalByFloor.get(row.sourceFloor) || 0) + row.total
    );
  }

  const m1GapFloors = rows
    .filter(
      (row) =>
        row.kind === ROW_KIND_M1 &&
        row.total === 0 &&
        (defectTotalByFloor.get(row.sourceFloor) || 0) > 0
    )
    .map((row) => row.label);

  if (m1GapFloors.length > 0) {
    warnings.push(
      `${m1GapFloors.join(', ')} booked M2/M3/M4 this month but no M1, so ${m1GapFloors.length > 1 ? 'those rows read' : 'that row reads'} zero. M1 logging was added recently and only captures work booked from now on; earlier good-quality output cannot be reconstructed.`
    );
  }

  if (repairExcludedQty > 0) {
    warnings.push(
      `Excluded ${repairExcludedQty.toLocaleString('en-IN')} pairs of upstream (M2 repair) transfers, which are not forward production.`
    );
  }
  if (unknownFloorQty > 0) {
    warnings.push(
      `Skipped ${unknownFloorQty.toLocaleString('en-IN')} pairs on transfer logs with an unrecognised floor name.`
    );
  }
  if (!includeExtraRows) {
    warnings.push('The Re-Boarding row is hidden. Pass includeExtraRows=true to show it.');
  }

  return warnings;
};

/**
 * Builds the Daily Production Summary matrix for an IST month.
 * @param {{ year?: number|string, month?: number|string, includeExtraRows?: boolean }} [query]
 * @returns {Promise<object>} Rows by floor/defect bucket, columns by IST calendar date.
 */
export const getDailyProductionSummary = async (query = {}) => {
  const period = resolveIstMonthPeriod(query);
  const includeExtraRows = query.includeExtraRows === true || query.includeExtraRows === 'true';

  const cacheKey = `daily-production-summary-v2:${period.year}:${period.month}:${includeExtraRows}`;
  const cached = cache.get(cacheKey);
  const nowMs = Date.now();
  if (cached && nowMs - cached.timestamp < CACHE_TTL_MS) {
    return { ...cached.data, cached: true, cacheAgeMs: nowMs - cached.timestamp };
  }

  const [transferResult, m1Series, ...defectResults] = await Promise.all([
    buildTransferSeries(period),
    buildM1Series(period),
    ...DEFECT_LEDGERS.map(({ model, entryType }) => buildDefectSeries(model, entryType, period)),
  ]);

  const defectSeries = new Map(
    DEFECT_LEDGERS.map(({ category }, index) => [category, defectResults[index]])
  );

  const rowDefs = getVisibleRows(includeExtraRows);
  const { rows, columnTotals, grandTotal } = buildRows(rowDefs, period, {
    transferSeries: transferResult.series,
    m1Series,
    defectSeries,
  });

  const result = {
    year: period.year,
    month: period.month,
    timezone: IST_TIMEZONE,
    dates: period.dateKeys,
    todayKey: period.todayKey,
    includeExtraRows,
    rows,
    columnTotals,
    grandTotal,
    warnings: buildWarnings({ transferMeta: transferResult, rows, includeExtraRows }),
  };

  cache.set(cacheKey, { data: result, timestamp: nowMs });
  return { ...result, cached: false, cacheAgeMs: 0 };
};
