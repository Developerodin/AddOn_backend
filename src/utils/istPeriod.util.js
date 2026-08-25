import httpStatus from 'http-status';
import ApiError from './ApiError.js';

/**
 * IST (Asia/Kolkata) calendar-period helpers for date-bucketed production reports.
 *
 * MongoDB stores every Date as a UTC instant. Factory reporting runs on IST calendar
 * days, so all bucketing must convert explicitly — never rely on server-local time or
 * on `ArticleLog.date`, which is truncated to a UTC day and lands IST evenings on the
 * previous date.
 */

export const IST_TIMEZONE = 'Asia/Kolkata';

/**
 * Pads a 1-2 digit number to two characters.
 * @param {number} n
 * @returns {string}
 */
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Formats a Date as YYYY-MM-DD in Asia/Kolkata.
 * @param {Date} date
 * @returns {string}
 */
export const toIstDateKey = (date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: IST_TIMEZONE }).format(date);

/**
 * UTC instant of IST midnight for a calendar day.
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day
 * @returns {Date}
 */
export const istMidnightUtc = (year, month, day) =>
  new Date(`${year}-${pad2(month)}-${pad2(day)}T00:00:00+05:30`);

/**
 * Exclusive upper bound: first IST instant of the next month.
 * @param {number} year
 * @param {number} month 1-12
 * @returns {Date}
 */
export const istNextMonthStart = (year, month) =>
  month === 12 ? istMidnightUtc(year + 1, 1, 1) : istMidnightUtc(year, month + 1, 1);

/**
 * Calendar YYYY-MM-DD keys for every day in the IST month.
 * @param {number} year
 * @param {number} month 1-12
 * @returns {string[]}
 */
export const getIstMonthDateKeys = (year, month) => {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const keys = [];
  for (let day = 1; day <= lastDay; day += 1) {
    keys.push(`${year}-${pad2(month)}-${pad2(day)}`);
  }
  return keys;
};

/**
 * Current year/month/day key in Asia/Kolkata.
 * @returns {{ year: number, month: number, todayKey: string }}
 */
export const getIstNow = () => {
  const todayKey = toIstDateKey(new Date());
  const [yearStr, monthStr] = todayKey.split('-');
  return { year: Number(yearStr), month: Number(monthStr), todayKey };
};

/**
 * Validates a year/month query and resolves the IST month window and its date keys.
 * Defaults to the current IST month when either value is absent.
 * @param {{ year?: unknown, month?: unknown }} [query]
 * @returns {{ year: number, month: number, todayKey: string, dateKeys: string[], monthStart: Date, monthEndExclusive: Date }}
 * @throws {ApiError} When year or month is out of range.
 */
export const resolveIstMonthPeriod = (query = {}) => {
  const now = getIstNow();
  const year = query.year == null || query.year === '' ? now.year : Number(query.year);
  const month = query.month == null || query.month === '' ? now.month : Number(query.month);

  if (!Number.isInteger(year) || year < 2020 || year > now.year + 1) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'year must be an integer between 2020 and next year');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'month must be an integer from 1 to 12');
  }

  return {
    year,
    month,
    todayKey: now.todayKey,
    dateKeys: getIstMonthDateKeys(year, month),
    monthStart: istMidnightUtc(year, month, 1),
    monthEndExclusive: istNextMonthStart(year, month),
  };
};
