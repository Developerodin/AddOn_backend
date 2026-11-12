import mongoose from 'mongoose';
import { isCapturableModelName } from './syncDocumentTypes.js';

/**
 * Receiver side of `documentUpserted`. Upserts the source row by its `_id` straight on the collection
 * (`Model.collection.updateOne(..., { upsert: true })`): no save(), no middleware, so no number generator runs and the
 * registrar hooks do not capture it again. The model must be registered on this process; the collection is never
 * guessed.
 */

/**
 * @param {Record<string, any>} payload `{ _id, modelName, collectionName, document }`
 * @param {Record<string, any>} row inbox row (entityType is the model name)
 * @returns {Promise<{ applyOutcome: string, domainInvoked: boolean, modelName: string }>}
 */
export const applyDocumentUpserted = async (payload, row) => {
  const modelName = row.entityType;
  if (!isCapturableModelName(modelName)) throw new Error(`MODEL_NOT_SYNCABLE ${modelName}`);
  if (payload.modelName !== modelName) throw new Error(`MODEL_NAME_MISMATCH ${modelName} payload=${payload.modelName}`);
  const Model = mongoose.models[modelName];
  if (!Model) throw new Error(`MODEL_NOT_REGISTERED ${modelName}`);
  const { collectionName } = Model.collection;
  if (payload.collectionName && payload.collectionName !== collectionName) {
    throw new Error(`COLLECTION_MISMATCH ${modelName} local=${collectionName} payload=${payload.collectionName}`);
  }
  if (!payload.document || typeof payload.document !== 'object') throw new Error(`DOCUMENT_MISSING ${modelName}`);

  // Cast JSON strings back to ObjectIds / Dates through the schema. Constructing a document runs no middleware.
  const casted = new Model({ ...payload.document, _id: payload._id }).toObject({
    depopulate: true,
    virtuals: false,
    getters: false,
    transform: false,
    minimize: false,
    versionKey: false,
  });
  const { _id, __v: _ignoredVersion, ...set } = casted;
  if (_id == null || String(_id) !== String(payload._id)) throw new Error(`ID_CAST_FAILED ${modelName} ${payload._id}`);

  const res = Object.keys(set).length
    ? await Model.collection.updateOne({ _id }, { $set: set }, { upsert: true })
    : await Model.collection.updateOne({ _id }, { $setOnInsert: { _id } }, { upsert: true });
  const inserted = typeof res.upsertedCount === 'number' ? res.upsertedCount > 0 : Boolean(res.result && res.result.upserted);
  return { applyOutcome: inserted ? 'INSERTED' : 'UPDATED', domainInvoked: true, modelName };
};

/**
 * Delete the source row by `_id`. A second delivery matches nothing and does not touch any other row.
 * Uses the collection directly so the registrar does not capture the delete and send it back.
 * @param {Record<string, any>} payload `{ _id, modelName, collectionName }`
 * @param {Record<string, any>} row inbox row (entityType is the model name)
 * @returns {Promise<{ applyOutcome: string, domainInvoked: boolean, modelName: string }>}
 */
export const applyDocumentRemoved = async (payload, row) => {
  const modelName = row.entityType;
  if (!isCapturableModelName(modelName)) throw new Error(`MODEL_NOT_SYNCABLE ${modelName}`);
  if (payload.modelName !== modelName) throw new Error(`MODEL_NAME_MISMATCH ${modelName} payload=${payload.modelName}`);
  const Model = mongoose.models[modelName];
  if (!Model) throw new Error(`MODEL_NOT_REGISTERED ${modelName}`);
  const { collectionName } = Model.collection;
  if (payload.collectionName && payload.collectionName !== collectionName) {
    throw new Error(`COLLECTION_MISMATCH ${modelName} local=${collectionName} payload=${payload.collectionName}`);
  }
  let id = payload._id;
  const idPath = Model.schema.path('_id');
  if (idPath && typeof idPath.cast === 'function') {
    try {
      id = idPath.cast(payload._id);
    } catch (err) {
      throw new Error(`ID_CAST_FAILED ${modelName} ${payload._id}: ${err && err.message}`);
    }
  }
  const res = await Model.collection.deleteOne({ _id: id });
  const deleted = typeof res.deletedCount === 'number' ? res.deletedCount : res.result && res.result.n;
  return { applyOutcome: deleted ? 'DELETED' : 'ALREADY_ABSENT', domainInvoked: true, modelName };
};

export default applyDocumentUpserted;
