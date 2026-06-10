import mongoose from 'mongoose';

/** @type {boolean | null} */
let cachedSupportsTransactions = null;

/**
 * Standalone MongoDB instances do not support multi-document transactions.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isTransactionUnsupportedError(err) {
  const code = err && typeof err === 'object' && 'code' in err ? /** @type {any} */ (err).code : undefined;
  const msg = String(
    err && typeof err === 'object' && 'message' in err ? /** @type {any} */ (err).message : err
  );
  return code === 20 || /replica set|mongos|transaction numbers/i.test(msg);
}

/**
 * Detects whether the active Mongo deployment supports multi-document transactions.
 * Standalone / MMAP hosts return false — sessions must not be started there.
 *
 * @returns {Promise<boolean>}
 */
export async function mongoSupportsTransactions() {
  if (cachedSupportsTransactions !== null) return cachedSupportsTransactions;
  try {
    if (mongoose.connection.readyState !== 1) {
      cachedSupportsTransactions = false;
      return false;
    }
    const hello = await mongoose.connection.db.admin().command({ isMaster: 1 });
    cachedSupportsTransactions = Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    cachedSupportsTransactions = false;
  }
  return cachedSupportsTransactions;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isRetryWritesUnsupportedError(err) {
  const msg = String(
    err && typeof err === 'object' && 'message' in err ? /** @type {any} */ (err).message : err
  );
  return /retryable writes|retryWrites=false/i.test(msg);
}

/**
 * Errors that should fall back to non-session writes on standalone MongoDB.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isMongoStandaloneFallbackError(err) {
  return isTransactionUnsupportedError(err) || isRetryWritesUnsupportedError(err);
}

/**
 * Runs a mutation callback inside a Mongo transaction when supported; otherwise runs once without a session.
 *
 * @param {(session: import('mongoose').ClientSession | null) => Promise<void>} applyFn
 * @param {string} [logLabel]
 * @returns {Promise<void>}
 */
export async function runWithOptionalMongoTransaction(applyFn, logLabel = 'mongo') {
  const useTxn = await mongoSupportsTransactions();
  if (!useTxn) {
    await applyFn(null);
    return;
  }

  let mongoSession = null;
  try {
    mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();
    try {
      await applyFn(mongoSession);
      await mongoSession.commitTransaction();
    } catch (inner) {
      await mongoSession.abortTransaction().catch(() => {});
      throw inner;
    }
  } catch (err) {
    if (isMongoStandaloneFallbackError(err)) {
      // eslint-disable-next-line no-console
      console.warn(`[${logLabel}] Mongo session/txn unavailable; running without transaction`);
      await applyFn(null);
    } else {
      throw err;
    }
  } finally {
    if (mongoSession) await mongoSession.endSession().catch(() => {});
  }
}
