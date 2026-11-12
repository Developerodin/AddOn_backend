import {
  DOCUMENT_REMOVED_EVENT_TYPE,
  DOCUMENT_UPSERTED_EVENT_TYPE,
  MAX_DOCUMENT_PAYLOAD_BYTES,
  isCapturableModelName,
} from './syncDocumentTypes.js';

/**
 * Transport policy for incoming events. Pure functions, no I/O.
 * A refusal here is a 422 for that one event; siblings in the batch are unaffected.
 */

export const MAX_BATCH_EVENTS = 100;
export const MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Named entity types of the specific pilot / ownership events. Every mongoose model name the registrar captures is
 * accepted too (see isAllowedEntityType); UserActivityLog and the other excluded models are refused.
 * Stored always; applied only when SYNC_APPLY_PILOT=true.
 */
export const ALLOWED_ENTITY_TYPES = Object.freeze([
  'vendorProductionFlow',
  'yarnPurchaseOrder',
  'productionOrder',
  'yarnCone',
  'warehouseInventory',
  'category',
  'product',
  'styleCode',
  'yarnCatalog',
]);

/**
 * @param {unknown} entityType
 * @returns {boolean} true for a named pilot entity type or a model name the registrar captures
 */
export const isAllowedEntityType = (entityType) =>
  ALLOWED_ENTITY_TYPES.includes(entityType) || isCapturableModelName(entityType);

/** Derived quantities are recomputed by each site, never shipped. */
const FORBIDDEN_PAYLOAD_KEYS = new Set(['producedqty', 'remainingqty']);
const ATTACHMENT_KEY_RE = /(attachment|filedata|filebytes|filecontent|base64|blob|binary)/i;
const DATA_URI_RE = /^data:[^;,]*;base64,/i;
const REPORT_ENTITY_RE = /(report|dashboard)/i;

/**
 * @param {unknown} value
 * @param {(key: string|null, v: unknown) => string|null} visit returns a code to stop
 * @param {number} depth
 * @returns {string|null}
 */
const walk = (value, visit, depth = 0) => {
  if (depth > 32) return 'PAYLOAD_TOO_DEEP';
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return 'ATTACHMENT_NOT_ALLOWED';
  if (Array.isArray(value)) {
    for (const v of value) {
      const code = visit(null, v) || walk(v, visit, depth + 1);
      if (code) return code;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const code = visit(k, v) || walk(v, visit, depth + 1);
      if (code) return code;
    }
  }
  return null;
};

const visitPayloadNode = (key, v) => {
  if (key !== null) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key.toLowerCase())) return 'DERIVED_FIELD_NOT_ALLOWED';
    if (ATTACHMENT_KEY_RE.test(key)) return 'ATTACHMENT_NOT_ALLOWED';
  }
  if (typeof v === 'string' && DATA_URI_RE.test(v)) return 'ATTACHMENT_NOT_ALLOWED';
  return null;
};

/**
 * documentUpserted carries whole rows whose field names (e.g. `attachments` holding URLs) are not bytes. Key names
 * are not refused there; derived quantities and inline `data:` blobs still are.
 * @param {string|null} key
 * @param {unknown} v
 * @returns {string|null}
 */
const visitDocumentNode = (key, v) => {
  if (key !== null && FORBIDDEN_PAYLOAD_KEYS.has(key.toLowerCase())) return 'DERIVED_FIELD_NOT_ALLOWED';
  if (typeof v === 'string' && DATA_URI_RE.test(v)) return 'ATTACHMENT_NOT_ALLOWED';
  return null;
};

const MESSAGES = {
  SITE_MISMATCH: 'Event siteId does not match the authenticated site',
  REPORT_ENTITY_NOT_SYNCABLE: 'Report and dashboard entities are not synced',
  ENTITY_TYPE_NOT_ALLOWED: 'Entity type is not enabled for sync',
  PAYLOAD_TOO_LARGE: `Payload exceeds ${MAX_PAYLOAD_BYTES} bytes (${MAX_DOCUMENT_PAYLOAD_BYTES} for documentUpserted)`,
  PAYLOAD_TOO_DEEP: 'Payload nesting is too deep',
  DERIVED_FIELD_NOT_ALLOWED: 'Derived quantities (producedQty, remainingQty) are not accepted',
  ATTACHMENT_NOT_ALLOWED: 'Attachment bytes are not accepted',
};

/**
 * @param {Record<string, any>} event Joi-validated event
 * @param {string} authenticatedSiteId
 * @returns {{ code: string, message: string } | null}
 */
export const checkEventPolicy = (event, authenticatedSiteId) => {
  const refuse = (code) => ({ code, message: MESSAGES[code] || code });
  if (event.siteId !== authenticatedSiteId) return refuse('SITE_MISMATCH');
  if (REPORT_ENTITY_RE.test(String(event.entityType || ''))) return refuse('REPORT_ENTITY_NOT_SYNCABLE');
  if (!isAllowedEntityType(event.entityType)) return refuse('ENTITY_TYPE_NOT_ALLOWED');

  const isDocument =
    event.eventType === DOCUMENT_UPSERTED_EVENT_TYPE || event.eventType === DOCUMENT_REMOVED_EVENT_TYPE;
  const size = Buffer.byteLength(JSON.stringify(event.payload ?? null), 'utf8');
  if (size > (isDocument ? MAX_DOCUMENT_PAYLOAD_BYTES : MAX_PAYLOAD_BYTES)) return refuse('PAYLOAD_TOO_LARGE');

  const code = walk(event.payload, isDocument ? visitDocumentNode : visitPayloadNode);
  return code ? refuse(code) : null;
};
