import httpStatus from 'http-status';
import { Article, ArticleLog } from '../../models/production/index.js';
import ApiError from '../../utils/ApiError.js';
import { ALL_FLOOR_KEYS, getFloorKeyFromName } from '../../utils/floorLabelMap.js';

const TIMEZONE = 'Asia/Kolkata';
const CACHE_TTL_MS = 60 * 1000;
const LEGACY_DATE_KEY = '1970-01-01';
const TRANSFER_ACTION_RE = /^(M1 )?Transferred from /;
const REVERT_ACTION = 'Transfer Reverted';
const REVERT_FLOOR_RE = /units on (.+?) \(/;

const cache = new Map();

/**
 * Floor columns for the date × pending-qty matrix (Linking labeled Rosso / Linking).
 */
export const BACKLOG_FLOOR_COLUMNS = [
  { key: 'knitting', label: 'Knitting' },
  { key: 'linking', label: 'Rosso / Linking' },
  { key: 'checking', label: 'Checking' },
  { key: 'washing', label: 'Washing' },
  { key: 'boarding', label: 'Boarding' },
  { key: 'silicon', label: 'Silicon' },
  { key: 'secondaryChecking', label: 'Secondary Checking' },
  { key: 'branding', label: 'Branding' },
  { key: 'reBoarding', label: 'Re-Boarding' },
  { key: 'finalChecking', label: 'Final Checking' },
  { key: 'dispatch', label: 'Ready For Dispatch' },
  { key: 'warehouse', label: 'Warehouse' },
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
 * Pads a 1–2 digit number to two characters.
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
  new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(date);

/**
 * Instant of IST midnight for a calendar day.
 * @param {number} year
 * @param {number} month 1–12
 * @param {number} day
 * @returns {Date}
 */
const istMidnightUtc = (year, month, day) =>
  new Date(`${year}-${pad2(month)}-${pad2(day)}T00:00:00+05:30`);

/**
 * Exclusive upper bound: first IST instant of the next month.
 * @param {number} year
 * @param {number} month 1–12
 * @returns {Date}
 */
const istNextMonthStart = (year, month) => {
  if (month === 12) return istMidnightUtc(year + 1, 1, 1);
  return istMidnightUtc(year, month + 1, 1);
};

/**
 * Calendar YYYY-MM-DD keys for every day in the IST month.
 * @param {number} year
 * @param {number} month 1–12
 * @returns {string[]}
 */
const getMonthDateKeys = (year, month) => {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const keys = [];
  for (let day = 1; day <= lastDay; day += 1) {
    keys.push(`${year}-${pad2(month)}-${pad2(day)}`);
  }
  return keys;
};

/**
 * Current year/month in Asia/Kolkata.
 * @returns {{ year: number, month: number, todayKey: string }}
 */
const getIstNow = () => {
  const todayKey = toIstDateKey(new Date());
  const [yearStr, monthStr] = todayKey.split('-');
  return { year: Number(yearStr), month: Number(monthStr), todayKey };
};

/**
 * Resolves a log floor name or key to a floorQuantities key.
 * @param {unknown} floorName
 * @returns {string|null}
 */
const resolveFloorKey = (floorName) => {
  if (floorName == null || floorName === '') return null;
  const name = String(floorName).trim();
  if (ALL_FLOOR_KEYS.includes(name)) return name;
  return getFloorKeyFromName(name);
};

/**
 * Adds qty to a floor/date delta map (inbound positive, outbound negative).
 * @param {Map<string, Map<string, number>>} deltas
 * @param {string} floorKey
 * @param {string} dateKey
 * @param {number} qty
 */
const addDelta = (deltas, floorKey, dateKey, qty) => {
  if (!floorKey || !dateKey || !qty) return;
  let byDate = deltas.get(floorKey);
  if (!byDate) {
    byDate = new Map();
    deltas.set(floorKey, byDate);
  }
  byDate.set(dateKey, (byDate.get(dateKey) || 0) + qty);
};

/**
 * Attributes receivedData lines onto inbound deltas; leftover received uses earliest ts.
 * @param {Map<string, Map<string, number>>} deltas
 * @param {string} floorKey
 * @param {Record<string, unknown>} floorData
 * @param {Date|string|undefined} createdAt
 */
const addReceivedInbound = (deltas, floorKey, floorData, createdAt) => {
  const received = toNumber(floorData?.received);
  const entries = Array.isArray(floorData?.receivedData) ? floorData.receivedData : [];
  let attributed = 0;
  let earliestKey = null;

  for (const entry of entries) {
    const qty = toNumber(entry?.transferred);
    const ts = entry?.receivedTimestamp ? new Date(entry.receivedTimestamp) : null;
    const validTs = ts && !Number.isNaN(ts.getTime());
    const dateKey = validTs ? toIstDateKey(ts) : null;
    if (dateKey && (earliestKey == null || dateKey < earliestKey)) earliestKey = dateKey;
    if (qty > 0 && dateKey) {
      addDelta(deltas, floorKey, dateKey, qty);
      attributed += qty;
    }
  }

  const remainder = received - attributed;
  if (remainder > 0) {
    const fallback =
      earliestKey ||
      (createdAt ? toIstDateKey(new Date(createdAt)) : LEGACY_DATE_KEY);
    addDelta(deltas, floorKey, fallback, remainder);
  }
};

/**
 * Applies a transfer / revert log as an outbound (or inbound-on-revert) delta.
 * @param {Map<string, Map<string, number>>} deltas
 * @param {Record<string, unknown>} log
 */
const applyTransferLog = (deltas, log) => {
  const action = String(log.action || '');
  const qty = toNumber(log.quantity);
  if (qty <= 0) return;

  const isRevert = action === REVERT_ACTION;
  const isTransfer = TRANSFER_ACTION_RE.test(action);
  if (!isRevert && !isTransfer) return;

  const ts = log.timestamp || log.date;
  if (!ts) return;
  const dateObj = new Date(ts);
  if (Number.isNaN(dateObj.getTime())) return;
  const dateKey = toIstDateKey(dateObj);

  let floorName = log.fromFloor;
  if (isRevert && (floorName == null || floorName === '')) {
    const match = String(log.remarks || '').match(REVERT_FLOOR_RE);
    floorName = match ? match[1].trim() : null;
  }

  const floorKey = resolveFloorKey(floorName);
  if (!floorKey) return;

  addDelta(deltas, floorKey, dateKey, isRevert ? qty : -qty);
};

/**
 * Live pending = received − transferred (qty still on the floor).
 * @param {Record<string, unknown>|undefined} floorData
 * @returns {number}
 */
const liveFloorPending = (floorData) =>
  Math.max(0, toNumber(floorData?.received) - toNumber(floorData?.transferred));

/**
 * Prefix-sums floor deltas into EOD pending per date key.
 * @param {Map<string, number>} byDate
 * @param {string[]} dateKeys
 * @param {string} monthStartKey
 * @returns {Record<string, number>}
 */
const prefixSumFloor = (byDate, dateKeys, monthStartKey) => {
  let running = 0;
  if (byDate) {
    for (const [dateKey, qty] of byDate.entries()) {
      if (dateKey < monthStartKey) running += qty;
    }
  }
  const out = {};
  for (const dateKey of dateKeys) {
    running += byDate?.get(dateKey) || 0;
    out[dateKey] = Math.max(0, running);
  }
  return out;
};

/**
 * Builds live pending sums per floor (received − transferred).
 * @param {Array<Record<string, unknown>>} articles
 * @returns {Record<string, number>}
 */
const sumLiveFloorPending = (articles) => {
  const floor = {};
  for (const key of ALL_FLOOR_KEYS) floor[key] = 0;
  for (const article of articles) {
    const fq = article.floorQuantities || {};
    for (const key of ALL_FLOOR_KEYS) {
      floor[key] += liveFloorPending(fq[key]);
    }
  }
  return floor;
};

/**
 * Validates year/month and returns normalized integers.
 * @param {{ year?: unknown, month?: unknown }} query
 * @returns {{ year: number, month: number, todayKey: string, dateKeys: string[], monthStartKey: string, monthEndExclusive: Date }}
 */
const resolvePeriod = (query) => {
  const now = getIstNow();
  const year = query.year == null || query.year === '' ? now.year : Number(query.year);
  const month = query.month == null || query.month === '' ? now.month : Number(query.month);
  if (!Number.isInteger(year) || year < 2020 || year > now.year + 1) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'year must be an integer between 2020 and next year');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'month must be an integer from 1 to 12');
  }
  const dateKeys = getMonthDateKeys(year, month);
  return {
    year,
    month,
    todayKey: now.todayKey,
    dateKeys,
    monthStartKey: dateKeys[0],
    monthEndExclusive: istNextMonthStart(year, month),
  };
};

/**
 * Loads articles created before the exclusive month end.
 * @param {Date} monthEndExclusive
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
const loadArticles = (monthEndExclusive) =>
  Article.find({ createdAt: { $lt: monthEndExclusive } })
    .select('createdAt plannedQuantity floorQuantities')
    .lean();

/**
 * Loads transfer and revert logs up to the exclusive month end.
 * @param {Date} monthEndExclusive
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
const loadTransferLogs = (monthEndExclusive) =>
  ArticleLog.find({
    timestamp: { $lt: monthEndExclusive },
    $or: [
      { action: { $regex: TRANSFER_ACTION_RE } },
      { action: REVERT_ACTION },
    ],
  })
    .select('timestamp date action quantity fromFloor remarks')
    .lean();

/**
 * Builds the date × floor backlog matrix for a year/month (IST).
 * Each cell is EOD pending (received − transferred); today uses live pending.
 * @param {{ year?: number|string, month?: number|string }} query
 * @returns {Promise<object>}
 */
export const getBacklogReport = async (query = {}) => {
  const period = resolvePeriod(query);
  const cacheKey = `backlog-v3:${period.year}:${period.month}`;
  const cached = cache.get(cacheKey);
  const nowMs = Date.now();
  if (cached && nowMs - cached.timestamp < CACHE_TTL_MS) {
    return { ...cached.data, cached: true, cacheAgeMs: nowMs - cached.timestamp };
  }

  const [articles, logs] = await Promise.all([
    loadArticles(period.monthEndExclusive),
    loadTransferLogs(period.monthEndExclusive),
  ]);

  const deltas = new Map();
  for (const article of articles) {
    const createdAt = article.createdAt;
    const knitQty = toNumber(article.plannedQuantity);
    if (knitQty > 0 && createdAt) {
      addDelta(deltas, 'knitting', toIstDateKey(new Date(createdAt)), knitQty);
    }
    const fq = article.floorQuantities || {};
    for (const floorKey of ALL_FLOOR_KEYS) {
      if (floorKey === 'knitting') continue;
      addReceivedInbound(deltas, floorKey, fq[floorKey], createdAt);
    }
  }
  for (const log of logs) {
    applyTransferLog(deltas, log);
  }

  const live = sumLiveFloorPending(articles);
  const floorSeries = {};
  for (const floorKey of ALL_FLOOR_KEYS) {
    floorSeries[floorKey] = prefixSumFloor(deltas.get(floorKey), period.dateKeys, period.monthStartKey);
  }

  const rows = period.dateKeys.map((dateKey) => {
    const isFuture = dateKey > period.todayKey;
    const isToday = dateKey === period.todayKey;
    const floors = {};
    let total = null;
    if (!isFuture) {
      total = 0;
      for (const col of BACKLOG_FLOOR_COLUMNS) {
        const qty = isToday ? live[col.key] : floorSeries[col.key][dateKey];
        const rounded = Math.round(qty);
        floors[col.key] = rounded;
        total += rounded;
      }
    } else {
      for (const col of BACKLOG_FLOOR_COLUMNS) floors[col.key] = null;
    }
    return { date: dateKey, isToday, isFuture, floors, total };
  });

  const lastPopulated =
    [...period.dateKeys].reverse().find((key) => key <= period.todayKey) || period.dateKeys[0];
  const asOfRow = rows.find((row) => row.date === lastPopulated);
  const asOfFloors = asOfRow?.floors || {};
  const asOfTotal = asOfRow?.total != null ? Math.round(asOfRow.total) : 0;

  const result = {
    year: period.year,
    month: period.month,
    timezone: TIMEZONE,
    dates: period.dateKeys,
    todayKey: period.todayKey,
    floors: BACKLOG_FLOOR_COLUMNS,
    rows,
    asOf: { date: lastPopulated, floors: asOfFloors, total: asOfTotal },
  };

  cache.set(cacheKey, { data: result, timestamp: nowMs });
  return { ...result, cached: false, cacheAgeMs: 0 };
};
