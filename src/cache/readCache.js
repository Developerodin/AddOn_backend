import { getRedis, isRedisReady } from './redisClient.js';
import logger from '../config/logger.js';

/**
 * Read-through cache helpers.
 *
 * Every function here is fail-open: any Redis problem falls back to the loader
 * so API behaviour is identical to a deployment without Redis.
 */

/** In-process singleflight: collapses concurrent misses for the same key. */
/** @type {Map<string, Promise<unknown>>} */
const inflight = new Map();

/** How long a cross-process build lock is held before Redis expires it. */
const LOCK_TTL_MS = 5000;

/** SCAN page size used by {@link delByPrefix}. */
const SCAN_COUNT = 500;

/** Upper bound on SCAN rounds so an invalidation can never run unbounded. */
const MAX_SCAN_ROUNDS = 2000;

/**
 * Read a JSON value from Redis.
 * @param {import('ioredis').Redis} redis
 * @param {string} key
 * @returns {Promise<{ hit: boolean, value: unknown }>}
 */
const readJson = async (redis, key) => {
  const raw = await redis.get(key);
  if (raw == null) return { hit: false, value: undefined };
  return { hit: true, value: JSON.parse(raw) };
};

/**
 * Store a JSON value with a TTL. Failures are logged and swallowed.
 * @param {import('ioredis').Redis} redis
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {unknown} value
 * @returns {Promise<void>}
 */
const writeJson = async (redis, key, ttlSeconds, value) => {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn(`[cache] write failed for ${key}: ${err && err.message}`);
  }
};

/**
 * Run the loader under a short Redis lock so that, across processes, only one
 * worker hits Mongo for a cold key. Lock failure falls through to Mongo.
 * @param {import('ioredis').Redis} redis
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {() => Promise<unknown>} loader
 * @param {(value: unknown) => boolean} shouldCache
 * @returns {Promise<unknown>}
 */
const loadWithLock = async (redis, key, ttlSeconds, loader, shouldCache) => {
  const lockKey = `${key}:lock`;
  let holdsLock = false;
  try {
    holdsLock = (await redis.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX')) === 'OK';
  } catch (err) {
    logger.warn(`[cache] lock failed for ${key}: ${err && err.message}`);
  }

  if (!holdsLock) {
    // Another process is already building it: one cheap re-read, then Mongo.
    try {
      const retry = await readJson(redis, key);
      if (retry.hit) return retry.value;
    } catch (err) {
      logger.warn(`[cache] lock re-read failed for ${key}: ${err && err.message}`);
    }
    return loader();
  }

  try {
    const value = await loader();
    // Never cache nullish payloads: those are "not found" or a failed load.
    if (value !== undefined && value !== null && shouldCache(value)) {
      await writeJson(redis, key, ttlSeconds, value);
    }
    return value;
  } finally {
    try {
      await redis.del(lockKey);
    } catch (err) {
      logger.warn(`[cache] lock release failed for ${key}: ${err && err.message}`);
    }
  }
};

/**
 * Cache-aside read. Returns the cached JSON payload when warm, otherwise runs
 * `loader`, stores the result and returns it.
 *
 * Concurrent callers for the same key inside this process share one loader run;
 * across processes a `SET NX PX` lock collapses the rest.
 *
 * @param {object} params
 * @param {string} params.key - Fully qualified cache key.
 * @param {number} params.ttlSeconds - Expiry, used only as a safety net.
 * @param {() => Promise<unknown>} params.loader - Mongo-backed source of truth.
 * @param {(value: unknown) => boolean} [params.shouldCache] - Return false to
 *   serve a payload without storing it, e.g. when part of it degraded.
 * @returns {Promise<unknown>} Loader result, or its JSON round-trip on a hit.
 */
export const getOrSet = async ({ key, ttlSeconds, loader, shouldCache = () => true }) => {
  const redis = getRedis();
  if (!redis || !isRedisReady()) return loader();

  const pending = inflight.get(key);
  if (pending) return pending;

  const run = (async () => {
    try {
      const cached = await readJson(redis, key);
      if (cached.hit) return cached.value;
    } catch (err) {
      logger.warn(`[cache] read failed for ${key}: ${err && err.message}`);
      return loader();
    }
    return loadWithLock(redis, key, ttlSeconds, loader, shouldCache);
  })();

  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
};

/**
 * Delete every cached key under a prefix (invalidation after a write).
 * Uses SCAN + UNLINK so it is safe with other processes reading concurrently.
 * @param {string} prefix - Key prefix, e.g. `addon:prod:v1:orders:`.
 * @returns {Promise<number>} Number of keys removed (0 when Redis is off).
 */
export const delByPrefix = async (prefix) => {
  const redis = getRedis();
  if (!redis || !isRedisReady() || !prefix) return 0;

  let cursor = '0';
  let removed = 0;
  let rounds = 0;
  try {
    do {
      // SCAN is cursor-based, so each round depends on the previous one.
      /* eslint-disable no-await-in-loop */
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', SCAN_COUNT);
      cursor = next;
      if (keys.length > 0) {
        await redis.unlink(...keys);
        removed += keys.length;
      }
      /* eslint-enable no-await-in-loop */
      rounds += 1;
    } while (cursor !== '0' && rounds < MAX_SCAN_ROUNDS);
  } catch (err) {
    logger.warn(`[cache] invalidation failed for prefix ${prefix}: ${err && err.message}`);
    return removed;
  }
  return removed;
};

/**
 * Delete several prefixes in one call. Runs them together so invalidation adds
 * one round trip to a write instead of one per prefix.
 * @param {string[]} prefixes
 * @returns {Promise<number>} Total keys removed.
 */
export const delByPrefixes = async (prefixes = []) => {
  const removedPerPrefix = await Promise.all(prefixes.map((prefix) => delByPrefix(prefix)));
  return removedPerPrefix.reduce((total, count) => total + count, 0);
};
