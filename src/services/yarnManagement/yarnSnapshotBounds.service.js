import { YarnDailyClosingSnapshot } from '../../models/index.js';

/**
 * Calendar add for YYYY-MM-DD keys (UTC date math; matches stored snapshotDate strings).
 * @param {string} isoDate
 * @param {number} deltaDays
 * @returns {string}
 */
const addCalendarDays = (isoDate, deltaDays) => {
  const parts = String(isoDate).split('-').map(Number);
  if (parts.length < 3) return isoDate;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
};

/**
 * Widest (start_date, end_date) with (start−1) and end_date both present as snapshotDate keys.
 * @param {Set<string>} dateSet
 * @returns {{ start_date: string, end_date: string } | null}
 */
const buildWidestValidReportRange = (dateSet) => {
  const sorted = [...dateSet].sort();
  if (!sorted.length) return null;
  const eMax = sorted[sorted.length - 1];
  const validStarts = sorted.map((d) => addCalendarDays(d, 1)).filter((s) => s <= eMax);
  if (!validStarts.length) return null;
  validStarts.sort();
  return { start_date: validStarts[0], end_date: eMax };
};

/**
 * HTML date-input bounds: any (S,E) with S−1 ∈ dateSet, E ∈ dateSet, S ≤ E.
 * @param {Set<string>} dateSet
 * @returns {{ startMin: string | null, startMax: string | null, endMin: string | null, endMax: string | null }}
 */
const computeDatePickerBounds = (dateSet) => {
  const sorted = [...dateSet].sort();
  let minStart = null;
  let maxStart = null;
  let minEnd = null;
  let maxEnd = null;

  for (const E of sorted) {
    for (const d of sorted) {
      const S = addCalendarDays(d, 1);
      if (S > E) continue;
      if (!dateSet.has(d) || !dateSet.has(E)) continue;
      minStart = minStart === null || S < minStart ? S : minStart;
      maxStart = maxStart === null || S > maxStart ? S : maxStart;
      minEnd = minEnd === null || E < minEnd ? E : minEnd;
      maxEnd = maxEnd === null || E > maxEnd ? E : maxEnd;
    }
  }

  if (minStart === null) {
    return { startMin: null, startMax: null, endMin: null, endMax: null };
  }

  return {
    startMin: minStart,
    startMax: maxEnd,
    endMin: minEnd,
    endMax: maxEnd,
  };
};

/**
 * Metadata for Yarn Report date pickers: snapshot coverage and valid query bounds.
 *
 * @returns {Promise<{
 *   earliestSnapshotDate: string | null,
 *   latestSnapshotDate: string | null,
 *   distinctSnapshotDates: number,
 *   totalSnapshotRows: number,
 *   widestValidReportRange: { start_date: string, end_date: string } | null,
 *   datePicker: { startMin: string | null, startMax: string | null, endMin: string | null, endMax: string | null },
 *   yarnReportHelp: string
 * }>}
 */
export const getYarnReportSnapshotBounds = async () => {
  const perDate = await YarnDailyClosingSnapshot.aggregate([
    {
      $group: {
        _id: '$snapshotDate',
        rowCount: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const distinctDates = perDate.map((r) => r._id).filter(Boolean);
  const dateSet = new Set(distinctDates);
  const totalSnapshotRows = perDate.reduce((acc, r) => acc + r.rowCount, 0);
  const earliestSnapshotDate = distinctDates[0] ?? null;
  const latestSnapshotDate = distinctDates[distinctDates.length - 1] ?? null;

  const widestValidReportRange = buildWidestValidReportRange(dateSet);
  const datePicker = computeDatePickerBounds(dateSet);

  return {
    earliestSnapshotDate,
    latestSnapshotDate,
    distinctSnapshotDates: distinctDates.length,
    totalSnapshotRows,
    widestValidReportRange,
    datePicker,
    yarnReportHelp:
      'The report needs closing snapshots for the calendar day before Start Date and for End Date (YYYY-MM-DD keys in YarnDailyClosingSnapshot).',
  };
};
