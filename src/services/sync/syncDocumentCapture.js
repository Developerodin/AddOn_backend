import logger from '../../config/logger.js';
import { writePilotOutboxEvent } from './syncPilotCapture.js';
import {
  DOCUMENT_REMOVED_EVENT_TYPE,
  DOCUMENT_UPSERTED_EVENT_TYPE,
  MAX_DOCUMENT_SNAPSHOT_BYTES,
} from './syncDocumentTypes.js';

/**
 * Publisher side of `documentUpserted`. Reads the committed row straight from the collection (no session, no
 * toJSON transform, no select:false projection), builds a JSON snapshot and writes one outbox event per row.
 * Never throws: every failure is logged with the model name and id.
 */

/** Keys dropped at any depth: version key and derived quantities (each site recomputes them). */
const DROPPED_KEYS = new Set(['__v', 'producedqty', 'remainingqty']);
const DATA_URI_RE = /^data:[^;,]*;base64,/i;
/** Rows read per `$in` query. */
const FETCH_CHUNK = 500;

/**
 * True for a string that holds an inline base64 blob.
 * @param {unknown} v
 * @returns {boolean}
 */
const isDataUri = (v) => typeof v === 'string' && DATA_URI_RE.test(v);

/**
 * Recursively drop `__v`, derived quantities, and any key or array element whose value is a `data:` base64 blob.
 * Input is already JSON-safe.
 * @param {any} v
 * @returns {any}
 */
const strip = (v) => {
  if (Array.isArray(v)) return v.filter((item) => !isDataUri(item)).map(strip);
  if (v && typeof v === 'object') {
    const out = {};
    Object.entries(v).forEach(([k, inner]) => {
      if (DROPPED_KEYS.has(k.toLowerCase()) || isDataUri(inner)) return;
      out[k] = strip(inner);
    });
    return out;
  }
  return v;
};

/**
 * JSON snapshot of a raw driver row: ObjectIds → hex strings, Dates → ISO strings, dropped keys removed.
 * @param {Record<string, any>} raw
 * @returns {Record<string, any>}
 */
export const buildDocumentSnapshot = (raw) => strip(JSON.parse(JSON.stringify(raw)));

/**
 * Write the outbox event for one raw row. Returns null when the row is skipped (too large, pilot off, no site id).
 * @param {import('mongoose').Model} Model
 * @param {Record<string, any>} raw row read from Model.collection
 * @returns {Promise<object|null>}
 */
const emitOne = async (Model, raw) => {
  const document = buildDocumentSnapshot(raw);
  const id = String(document._id);
  const bytes = Buffer.byteLength(JSON.stringify(document), 'utf8');
  if (bytes > MAX_DOCUMENT_SNAPSHOT_BYTES) {
    logger.warn(`[sync] documentUpserted skipped: ${Model.modelName} ${id} snapshot is ${bytes} bytes (limit ${MAX_DOCUMENT_SNAPSHOT_BYTES})`);
    return null;
  }
  return writePilotOutboxEvent({
    entityType: Model.modelName,
    eventType: DOCUMENT_UPSERTED_EVENT_TYPE,
    aggregateId: id,
    payload: { _id: id, modelName: Model.modelName, collectionName: Model.collection.collectionName, document },
  });
};

/**
 * Read the given rows (after commit, outside any session) and write one documentUpserted event per row found.
 * Rows deleted in the meantime are skipped. Never throws.
 * @param {import('mongoose').Model} Model
 * @param {Array<unknown>} ids `_id` values
 * @returns {Promise<number>} events written
 */
export const emitDocumentsUpserted = async (Model, ids) => {
  let written = 0;
  const unique = [...new Map((ids || []).filter((i) => i != null).map((i) => [String(i), i])).values()];
  for (let i = 0; i < unique.length; i += FETCH_CHUNK) {
    const chunk = unique.slice(i, i + FETCH_CHUNK);
    let rows = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      rows = await Model.collection.find({ _id: { $in: chunk } }).toArray();
    } catch (err) {
      logger.warn(`[sync] documentUpserted read failed for ${Model.modelName} (${chunk.length} ids): ${err && err.message}`);
      // eslint-disable-next-line no-continue
      continue;
    }
    for (const raw of rows) {
      try {
        // eslint-disable-next-line no-await-in-loop
        if (await emitOne(Model, raw)) written += 1;
      } catch (err) {
        logger.warn(`[sync] documentUpserted capture failed for ${Model.modelName} ${String(raw._id)}: ${err && err.message}`);
      }
    }
  }
  return written;
};

/**
 * Write one `documentRemoved` event per id. The row is already gone, so there is no snapshot.
 * Never throws.
 * @param {import('mongoose').Model} Model
 * @param {Array<unknown>} ids
 * @returns {Promise<number>} events written
 */
export const emitDocumentsRemoved = async (Model, ids) => {
  let written = 0;
  const unique = [...new Map((ids || []).filter((i) => i != null).map((i) => [String(i), i])).values()];
  for (const id of unique) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const event = await writePilotOutboxEvent({
        entityType: Model.modelName,
        eventType: DOCUMENT_REMOVED_EVENT_TYPE,
        aggregateId: String(id),
        payload: {
          _id: String(id),
          modelName: Model.modelName,
          collectionName: Model.collection.collectionName,
        },
      });
      if (event) written += 1;
    } catch (err) {
      logger.warn(`[sync] documentRemoved capture failed for ${Model.modelName} ${String(id)}: ${err && err.message}`);
    }
  }
  return written;
};

/**
 * True when a filter value is a Mongo operator object (`$in`, `$gt`, …) rather than an id.
 * @param {unknown} value
 * @returns {boolean}
 */
const isOperator = (value) =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).some((key) => key.startsWith('$'));

/**
 * Ids named directly by a filter, or null when the filter must be queried.
 * @param {unknown} filter
 * @returns {unknown[]|null}
 */
const idsInFilter = (filter) => {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter) || filter._id == null) return null;
  const { _id: id } = filter;
  if (isOperator(id)) {
    if (Array.isArray(id.$in)) return id.$in;
    if (id.$eq != null && Object.keys(id).length === 1) return [id.$eq];
    return null;
  }
  return [id];
};

/**
 * Split bulkWrite ops into ids already known and filters that have to be read before the write.
 * Inserts without an `_id` are recovered from the driver result afterwards.
 * @param {Array<Record<string, any>>} ops
 * @returns {{ upsertIds: unknown[], removeIds: unknown[], upsertFilters: object[], removeFilters: object[] }}
 */
export const planBulkCapture = (ops) => {
  const upsertIds = [];
  const removeIds = [];
  const upsertFilters = [];
  const removeFilters = [];
  for (const op of ops || []) {
    if (!op || typeof op !== 'object') continue;
    if (op.insertOne) {
      const id = op.insertOne.document && op.insertOne.document._id;
      if (id != null) upsertIds.push(id);
      continue;
    }
    const updating = op.updateOne || op.updateMany || op.replaceOne;
    const deleting = op.deleteOne || op.deleteMany;
    const spec = updating || deleting;
    if (!spec) continue;
    const known = idsInFilter(spec.filter);
    if (known) {
      (deleting ? removeIds : upsertIds).push(...known);
    } else if (spec.filter && typeof spec.filter === 'object') {
      (deleting ? removeFilters : upsertFilters).push(spec.filter);
    }
  }
  return { upsertIds, removeIds, upsertFilters, removeFilters };
};

/**
 * `_id`s the driver reports for inserts and upserts. Mongoose 5 returns index maps; newer drivers return arrays.
 * @param {any} result bulkWrite result
 * @returns {unknown[]}
 */
export const idsFromBulkResult = (result) => {
  const out = [];
  [result && result.insertedIds, result && result.upsertedIds].forEach((bag) => {
    if (!bag) return;
    const values = Array.isArray(bag) ? bag : Object.values(bag);
    values.forEach((value) => out.push(value && value._id != null ? value._id : value));
  });
  return out;
};
