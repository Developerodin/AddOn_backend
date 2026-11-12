/* eslint-disable no-param-reassign -- marks schemas and wraps session commit/abort on purpose */
import mongoose from 'mongoose';
import logger from '../../config/logger.js';
import { isApplyPilotEnabled, isInsideSyncApply } from './syncPilotCapture.js';
import { emitDocumentsRemoved, emitDocumentsUpserted, idsFromBulkResult, planBulkCapture } from './syncDocumentCapture.js';
import { isCapturableModelName } from './syncDocumentTypes.js';

/**
 * Registrar for `documentUpserted`. Import it before any business model is compiled (first import in app.js, or
 * first import in a script). It wraps `mongoose.model` so every capturable schema compiled after this module loads
 * gets post-save, post-insertMany, post-updateOne, post-findOneAndUpdate and post-updateMany hooks.
 *
 * After the write, when SYNC_APPLY_PILOT is on and the call is not inside runAsSyncApply, the affected rows are read
 * back and one outbox event per row is written. Inside a transaction the capture waits for commitTransaction and is
 * dropped on abort. Hooks never fail the caller's write.
 *
 * bulkWrite, deleteOne, deleteMany, findOneAndDelete and document remove are captured too.
 * Model.collection.* writes are not seen. The apply path uses those on purpose so a received row is not sent back.
 */

const HOOKED = Symbol.for('addon.sync.documentHooks');
const PATCHED = Symbol.for('addon.sync.modelPatched');
const QUERY_IDS = Symbol('syncDocIds');
const QUERY_ACTIVE = Symbol('syncDocActive');
const SESSION_PENDING = Symbol('syncDocPending');
/** updateMany captures at most this many rows per call. */
const MAX_UPDATE_MANY_IDS = 5000;

/**
 * True when this write should be captured now (pilot on, not a sync apply).
 * @returns {boolean}
 */
const shouldCapture = () => isApplyPilotEnabled() && !isInsideSyncApply();

/**
 * @param {unknown} session mongoose/driver ClientSession or undefined
 * @returns {boolean}
 */
const inTransaction = (session) =>
  Boolean(session && typeof session.inTransaction === 'function' && session.inTransaction());

/**
 * Run the deferred captures queued on a session after its transaction committed.
 * @param {Record<symbol, any>} session
 * @returns {Promise<void>}
 */
const flushSession = async (session) => {
  const pending = session[SESSION_PENDING] || [];
  session[SESSION_PENDING] = [];
  for (const { Model, ids, kind } of pending) {
    // eslint-disable-next-line no-await-in-loop
    if (kind === 'remove') await emitDocumentsRemoved(Model, ids);
    // eslint-disable-next-line no-await-in-loop
    else await emitDocumentsUpserted(Model, ids);
  }
};

/**
 * Wrap commitTransaction / abortTransaction on one session instance (once) so queued captures run only after a
 * successful commit and are dropped on abort. Supports promise and callback styles.
 * @param {Record<string|symbol, any>} session
 */
const patchSession = (session) => {
  if (session[SESSION_PENDING]) return;
  session[SESSION_PENDING] = [];
  const commit = session.commitTransaction;
  const abort = session.abortTransaction;
  session.commitTransaction = function commitThenCapture(...args) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const p = Promise.resolve(commit.apply(this, args)).then(async (r) => {
      try {
        await flushSession(session);
      } catch (err) {
        logger.warn(`[sync] documentUpserted post-commit capture failed: ${err && err.message}`);
      }
      return r;
    });
    if (!cb) return p;
    p.then((r) => cb(null, r), cb);
    return undefined;
  };
  session.abortTransaction = function abortAndDrop(...args) {
    session[SESSION_PENDING] = [];
    return abort.apply(this, args);
  };
};

/**
 * Capture now, or after commit when the write ran inside a transaction. Never throws.
 * @param {import('mongoose').Model} Model
 * @param {Array<unknown>} ids
 * @param {unknown} session
 * @param {'upsert'|'remove'} [kind]
 * @returns {Promise<void>}
 */
const schedule = async (Model, ids, session, kind = 'upsert') => {
  if (!Model || !ids || !ids.length) return;
  try {
    if (inTransaction(session)) {
      patchSession(session);
      session[SESSION_PENDING].push({ Model, ids, kind });
      return;
    }
    if (kind === 'remove') await emitDocumentsRemoved(Model, ids);
    else await emitDocumentsUpserted(Model, ids);
  } catch (err) {
    logger.warn(`[sync] document ${kind} capture failed for ${Model.modelName}: ${err && err.message}`);
  }
};

/**
 * Session attached to a query, if any.
 * @param {import('mongoose').Query} query
 * @returns {unknown}
 */
const querySession = (query) => {
  const opts = typeof query.getOptions === 'function' ? query.getOptions() : query.options;
  return opts ? opts.session : undefined;
};

/**
 * `_id`s of rows matching the query filter, read in the query's session.
 * @param {import('mongoose').Query} query
 * @param {number} limit
 * @returns {Promise<Array<unknown>>}
 */
const findMatchingIds = async (query, limit) => {
  const filter = typeof query.getFilter === 'function' ? query.getFilter() : query.getQuery();
  let q = query.model.find(filter).select('_id').limit(limit).lean();
  const sort = query.options && query.options.sort;
  if (sort) q = q.sort(sort);
  const session = querySession(query);
  if (session) q = q.session(session);
  const rows = await q;
  return rows.map((r) => r._id);
};

/**
 * Pre hook factory: remember which rows the update targets (the filter may stop matching after the update).
 * @param {number} limit
 * @returns {Function}
 */
const preCollectIds = (limit) =>
  async function collectIds() {
    this[QUERY_ACTIVE] = false;
    if (!shouldCapture()) return;
    this[QUERY_ACTIVE] = true;
    try {
      this[QUERY_IDS] = await findMatchingIds(this, limit);
      if (limit === MAX_UPDATE_MANY_IDS && this[QUERY_IDS].length >= limit) {
        logger.warn(`[sync] ${this.model.modelName}.updateMany touches >= ${limit} rows; only the first ${limit} are captured`);
      }
    } catch (err) {
      this[QUERY_IDS] = [];
      logger.warn(`[sync] documentUpserted pre-read failed for ${this.model.modelName}: ${err && err.message}`);
    }
  };

/**
 * Upserted `_id` from a driver update result (mongoose 5 shapes and newer).
 * @param {any} res
 * @returns {unknown|null}
 */
const upsertedIdOf = (res) => {
  if (!res) return null;
  if (Array.isArray(res.upserted) && res.upserted[0]) return res.upserted[0]._id;
  if (res.upsertedId) return res.upsertedId._id || res.upsertedId;
  if (res.lastErrorObject && res.lastErrorObject.upserted) return res.lastErrorObject.upserted;
  return null;
};

/**
 * Post hook shared by updateOne / updateMany / findOneAndUpdate. Uses the pre-collected ids, the returned doc, or the
 * upserted id; for an upsert with nothing else known it re-reads by filter.
 * @param {import('mongoose').Query} query
 * @param {any} res hook result (doc, raw result, or write result)
 * @returns {Promise<void>}
 */
const afterQueryWrite = async (query, res) => {
  if (!query[QUERY_ACTIVE]) return;
  const ids = [...(query[QUERY_IDS] || [])];
  const doc = res && res.value !== undefined && res.lastErrorObject ? res.value : res;
  if (doc && doc._id != null) ids.push(doc._id);
  const upserted = upsertedIdOf(res);
  if (upserted != null) ids.push(upserted);
  if (!ids.length && query.options && query.options.upsert) {
    try {
      ids.push(...(await findMatchingIds(query, 1)));
    } catch (err) {
      logger.warn(`[sync] documentUpserted upsert re-read failed for ${query.model.modelName}: ${err && err.message}`);
    }
  }
  await schedule(query.model, ids, querySession(query));
};

/**
 * True for an embedded (sub)document, which is never captured on its own.
 * @param {any} doc
 * @returns {boolean}
 */
const isSubdocument = (doc) => typeof doc.ownerDocument === 'function' && doc.ownerDocument() !== doc;

/**
 * Attach the capture hooks to one schema (idempotent). Model name is read at run time, so a schema shared by two
 * models captures under the right name.
 * @param {import('mongoose').Schema} schema
 */
export const attachDocumentSyncHooks = (schema) => {
  if (schema[HOOKED]) return;
  schema[HOOKED] = true;

  schema.post('save', function afterSave(doc, next) {
    const target = doc || this;
    if (!shouldCapture() || !target || isSubdocument(target) || !target.constructor || !target.constructor.modelName) {
      return next();
    }
    const session = typeof target.$session === 'function' ? target.$session() : undefined;
    return schedule(target.constructor, [target._id], session).then(() => next(), () => next());
  });

  schema.post('insertMany', function afterInsertMany(docs, next) {
    if (!shouldCapture() || !Array.isArray(docs) || !docs.length) return next();
    return schedule(this, docs.map((d) => d && d._id), undefined).then(() => next(), () => next());
  });

  schema.pre('updateOne', preCollectIds(1));
  schema.pre('findOneAndUpdate', preCollectIds(1));
  schema.pre('updateMany', preCollectIds(MAX_UPDATE_MANY_IDS));

  ['updateOne', 'findOneAndUpdate', 'updateMany'].forEach((op) => {
    schema.post(op, function afterUpdate(res, next) {
      return afterQueryWrite(this, res).then(() => next(), (err) => {
        logger.warn(`[sync] documentUpserted ${op} capture failed: ${err && err.message}`);
        next();
      });
    });
  });

  schema.post('remove', function afterRemove(doc, next) {
    const target = doc || this;
    if (!shouldCapture() || !target || isSubdocument(target) || !target.constructor) return next();
    const session = typeof target.$session === 'function' ? target.$session() : undefined;
    return schedule(target.constructor, [target._id], session, 'remove').then(() => next(), () => next());
  });

  ['deleteOne', 'deleteMany', 'findOneAndDelete'].forEach((op) => {
    const limit = op === 'deleteMany' ? MAX_UPDATE_MANY_IDS : 1;
    schema.pre(op, { document: false, query: true }, preCollectIds(limit));
    schema.post(op, { document: false, query: true }, function afterQueryDelete(_res, next) {
      if (!this[QUERY_ACTIVE]) return next();
      return schedule(this.model, this[QUERY_IDS] || [], querySession(this), 'remove').then(() => next(), (err) => {
        logger.warn(`[sync] documentRemoved ${op} capture failed: ${err && err.message}`);
        next();
      });
    });
  });
};

/**
 * `_id`s matching filters that do not name `_id` directly. Read before the write so an update that changes the
 * filter fields is still captured.
 * @param {import('mongoose').Model} Model
 * @param {object[]} filters
 * @param {unknown} session
 * @returns {Promise<unknown[]>}
 */
const idsForFilters = async (Model, filters, session) => {
  const ids = [];
  for (const filter of filters) {
    let query = Model.find(filter).select('_id').limit(MAX_UPDATE_MANY_IDS).lean();
    if (session) query = query.session(session);
    // eslint-disable-next-line no-await-in-loop
    const rows = await query;
    rows.forEach((row) => ids.push(row._id));
  }
  return ids;
};

/**
 * Mongoose 5 has no bulkWrite middleware. Wrap the static once so storage-slot, pick-list and yarn-box
 * bulk writes are captured. Callback-style calls are left alone.
 */
const patchBulkWrite = () => {
  const patched = Symbol.for('addon.sync.bulkPatched');
  if (mongoose[patched] || typeof mongoose.Model.bulkWrite !== 'function') return;
  mongoose[patched] = true;
  const originalBulkWrite = mongoose.Model.bulkWrite;
  mongoose.Model.bulkWrite = async function bulkWriteWithSync(ops, options, ...rest) {
    const callback = [options, ...rest].find((arg) => typeof arg === 'function');
    const capture = !callback && shouldCapture() && isCapturableModelName(this.modelName);
    if (!capture) return originalBulkWrite.call(this, ops, options, ...rest);
    const plan = planBulkCapture(ops);
    const session = options && options.session;
    let preUpsert = [];
    let preRemove = [];
    try {
      preUpsert = await idsForFilters(this, plan.upsertFilters, session);
      preRemove = await idsForFilters(this, plan.removeFilters, session);
    } catch (err) {
      logger.warn(`[sync] bulkWrite pre-read failed for ${this.modelName}: ${err && err.message}`);
    }
    const result = await originalBulkWrite.call(this, ops, options);
    try {
      await schedule(this, [...plan.upsertIds, ...preUpsert, ...idsFromBulkResult(result)], session, 'upsert');
      await schedule(this, [...plan.removeIds, ...preRemove], session, 'remove');
    } catch (err) {
      logger.warn(`[sync] bulkWrite capture failed for ${this.modelName}: ${err && err.message}`);
    }
    return result;
  };
};

/**
 * Wrap mongoose.model once. Schemas of capturable models get the hooks before mongoose compiles them.
 */
const installRegistrar = () => {
  if (mongoose[PATCHED]) return;
  mongoose[PATCHED] = true;
  patchBulkWrite();

  const already = mongoose.modelNames().filter(isCapturableModelName);
  if (already.length) {
    logger.warn(`[sync] registrar loaded after these models were compiled; they are not captured: ${already.join(', ')}`);
  }

  const originalModel = mongoose.model;
  mongoose.model = function modelWithSyncHooks(name, schema, ...rest) {
    let compiled = schema;
    if (typeof name === 'string' && schema && isCapturableModelName(name)) {
      if (!(schema instanceof mongoose.Schema) && typeof schema === 'object') compiled = new mongoose.Schema(schema);
      if (compiled instanceof mongoose.Schema) attachDocumentSyncHooks(compiled);
    }
    return originalModel.call(this, name, compiled, ...rest);
  };
};

installRegistrar();

export default installRegistrar;
