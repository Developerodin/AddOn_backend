import Redis from 'ioredis';
import config from '../config/config.js';
import logger from '../config/logger.js';

/**
 * Optional Redis connection for read caching.
 *
 * The whole module is fail-open: when `REDIS_URL` is absent, unreachable or
 * misbehaving, {@link getRedis} returns `null` and every caller falls back to
 * Mongo. Nothing here throws on boot and the connection URL is never logged.
 */

/** @type {import('ioredis').Redis|null} */
let client = null;

/** Set once we decide this process should stop trying to use Redis. */
let disabled = false;

/** Guards the one-time "cache disabled" log line. */
let disabledLogged = false;

/** Connection attempts before the client gives up for good. */
const MAX_CONNECT_ATTEMPTS = 5;

/**
 * Stop using Redis for the rest of this process and log the reason once.
 * @param {string} reason - Short, secret-free explanation.
 * @returns {void}
 */
export const disableRedis = (reason) => {
  disabled = true;
  if (!disabledLogged) {
    disabledLogged = true;
    logger.warn(`[cache] Redis disabled, serving reads straight from Mongo: ${reason}`);
  }
  if (client) {
    const stale = client;
    client = null;
    try {
      stale.disconnect();
    } catch (err) {
      logger.debug(`[cache] Redis disconnect threw: ${err && err.message}`);
    }
  }
};

/**
 * Build the ioredis client. Never called when `config.redis.url` is empty.
 * @returns {import('ioredis').Redis}
 */
const createClient = () => {
  const redis = new Redis(config.redis.url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    keepAlive: 10000,
    retryStrategy: (attempt) => (attempt > MAX_CONNECT_ATTEMPTS ? null : Math.min(attempt * 200, 2000)),
  });

  redis.on('connect', () => {
    logger.info('[cache] Redis connected, production read cache is active');
  });

  redis.on('error', (err) => {
    // ioredis crashes the process on unhandled 'error' events, so always absorb it here.
    logger.warn(`[cache] Redis error: ${err && err.message}`);
  });

  redis.on('end', () => {
    disableRedis('connection closed after exhausting retries');
  });

  redis.connect().catch((err) => {
    logger.warn(`[cache] Redis initial connect failed: ${err && err.message}`);
  });

  return redis;
};

/**
 * Lazily created shared Redis client.
 * @returns {import('ioredis').Redis|null} `null` when caching is unavailable.
 */
export const getRedis = () => {
  if (disabled) return null;
  if (!config.redis.url) {
    disabled = true;
    return null;
  }
  if (!client) {
    try {
      client = createClient();
    } catch (err) {
      disableRedis(`client could not be created: ${err && err.message}`);
      return null;
    }
  }
  return client;
};

/**
 * Whether commands can be issued right now (connection is up).
 * @returns {boolean}
 */
export const isRedisReady = () => {
  const redis = getRedis();
  return Boolean(redis && redis.status === 'ready');
};

/**
 * Close the shared client, used by tests and graceful shutdown.
 * @returns {Promise<void>}
 */
export const closeRedis = async () => {
  if (!client) return;
  const stale = client;
  client = null;
  try {
    await stale.quit();
  } catch (err) {
    logger.debug(`[cache] Redis quit threw: ${err && err.message}`);
  }
};
