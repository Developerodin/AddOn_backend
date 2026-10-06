import Joi from 'joi';
import { objectId } from '../custom.validation.js';

const clientTypes = ['Store', 'Trade', 'Departmental', 'Ecom'];
const statusValues = ['active', 'inactive'];
const statusSchema = Joi.string().valid(...statusValues).messages({
  'any.only': 'Status "{{#value}}" is not allowed. Use active or inactive.',
});

const storeProfileSchema = Joi.object().keys({
  billCode: Joi.string().allow('').trim(),
  sapCode: Joi.string().allow('').trim(),
  retekCode: Joi.string().allow('').trim(),
  classification: Joi.string().allow('').trim(),
  city: Joi.string().allow('').trim(),
  state: Joi.string().allow('').trim(),
  brand: Joi.string().allow('').trim(),
  brandSub: Joi.string().allow('').trim(),
  openingDate: Joi.date().allow(null).messages({
    'date.base': 'Opening Date "{{#value}}" is not a valid date. Use YYYY-MM-DD (example: 2026-09-18) or leave it blank.',
  }),
  address: Joi.string().allow('').trim(),
  pincode: Joi.string().allow('').trim(),
  gst: Joi.string().allow('').trim(),
  storeLandlineNo: Joi.string().allow('').trim(),
  smName: Joi.string().allow('').trim(),
  smContact: Joi.string().allow('').trim(),
  smNameAndContact: Joi.string().allow('').trim(),
  storeMailId: Joi.string().allow('').trim(),
  abmName: Joi.string().allow('').trim(),
  abmContact: Joi.string().allow('').trim(),
  abmNameAndContact: Joi.string().allow('').trim(),
  abmMailId: Joi.string().allow('').trim(),
});

const sharedFields = {
  slNo: Joi.number().integer().min(0).allow(null),
  parentKeyCode: Joi.string().allow('').trim(),
  retailerName: Joi.string().allow('').trim(),
  contactPerson: Joi.string().allow('').trim(),
  mobilePhone: Joi.string().allow('').trim(),
  address: Joi.string().allow('').trim(),
  locality: Joi.string().allow('').trim(),
  city: Joi.string().allow('').trim(),
  zipCode: Joi.string().allow('').trim(),
  state: Joi.string().allow('').trim(),
  gstin: Joi.string().allow('').trim(),
  email: Joi.string().allow('').trim(),
  phone1: Joi.string().allow('').trim(),
  storeProfile: storeProfileSchema,
  status: statusSchema,
  remarks: Joi.string().allow('').trim(),
};

const { storeProfile: _storeProfileField, ...nonStoreRootFields } = sharedFields;

/** Store clients: `type` + `storeProfile`; optional `status` / `remarks` / `slNo` only (no other root fields). */
export const createWarehouseClientBodySchema = Joi.alternatives().try(
  Joi.object({
    type: Joi.string().valid('Store').required(),
    storeProfile: storeProfileSchema.required(),
    status: statusSchema,
    remarks: Joi.string().allow('').trim(),
    slNo: Joi.number().integer().min(0).allow(null),
  }).unknown(false),
  Joi.object({
    type: Joi.string().valid('Trade', 'Departmental', 'Ecom').required(),
    ...nonStoreRootFields,
  }).unknown(false)
);

export const createWarehouseClient = {
  body: createWarehouseClientBodySchema,
};

export const bulkImportWarehouseClients = {
  body: Joi.object().keys({
    items: Joi.array().items(createWarehouseClientBodySchema).min(1).max(10000).required(),
  }),
};

const listQueryKeys = {
  status: statusSchema,
  city: Joi.string().trim(),
  state: Joi.string().trim(),
  parentKeyCode: Joi.string().trim(),
  search: Joi.string().trim(),
  source: Joi.string().trim(),
  incomplete: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('1', 'true', '0', 'false')),
  sortBy: Joi.string(),
  limit: Joi.number().integer(),
  page: Joi.number().integer(),
};

export const getWarehouseClients = {
  query: Joi.object().keys({
    type: Joi.string().valid(...clientTypes),
    ...listQueryKeys,
  }),
};

/** `type` is required in the path; same filters as list (search, city, state, …). */
export const getWarehouseClientsByType = {
  params: Joi.object().keys({
    type: Joi.string().valid(...clientTypes).required(),
  }),
  query: Joi.object().keys(listQueryKeys),
};

export const getWarehouseClient = {
  params: Joi.object().keys({
    clientId: Joi.string().custom(objectId).required(),
  }),
};

export const updateWarehouseClient = {
  params: Joi.object().keys({
    clientId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      ...sharedFields,
      type: Joi.string().valid(...clientTypes),
    })
    .min(1),
};

export const deleteWarehouseClient = {
  params: Joi.object().keys({
    clientId: Joi.string().custom(objectId).required(),
  }),
};

const FIELD_LABELS = [
  ['openingDate', 'Opening Date'],
  ['storeProfile', 'store details'],
  ['parentKeyCode', 'SAP Code'],
  ['retailerName', 'Party Name'],
  ['contactPerson', 'Contact Person'],
  ['mobilePhone', 'Contact Number'],
  ['phone1', 'Contact Number 1'],
  ['zipCode', 'Pincode'],
  ['gstin', 'GSTIN'],
  ['billCode', 'Bill Code'],
  ['sapCode', 'SAP Code'],
  ['retekCode', 'Retek Code'],
  ['brandSub', 'Sub Brand'],
  ['storeLandlineNo', 'Store Landline'],
  ['smName', 'Store Manager Name'],
  ['smContact', 'Store Manager Contact'],
  ['storeMailId', 'Store email'],
  ['abmName', 'ABM Name'],
  ['abmContact', 'ABM Contact'],
  ['abmMailId', 'ABM email'],
  ['slNo', 'Sr.No.'],
  ['type', 'Channel'],
  ['status', 'Status'],
];

/**
 * Replace API field names in a Joi message with the spreadsheet column names.
 * @param {string} message
 * @returns {string}
 */
function labelizeWarehouseClientMessage(message) {
  return FIELD_LABELS.reduce(
    (text, [key, label]) => text.replaceAll(`"${key}"`, label),
    message,
  );
}

/**
 * Spreadsheet row number for an items[index] path (header is row 1).
 * @param {Array<string|number>} path
 * @returns {number | null}
 */
function spreadsheetRowFromPath(path) {
  const itemsAt = path.indexOf('items');
  if (itemsAt >= 0 && typeof path[itemsAt + 1] === 'number') {
    return path[itemsAt + 1] + 2;
  }
  return null;
}

/**
 * Keep the failure from the branch that matches the submitted Channel.
 * The other branch always fails and would only add noise.
 * @param {string | undefined} type
 * @param {Array<{ type?: string, message?: string, context?: { key?: string, valids?: string[] } }>} details
 */
function detailsForSubmittedType(type, details) {
  if (type === 'Store') {
    return details.filter((detail) => {
      const message = detail.message || '';
      if (message.includes('Trade, Departmental, Ecom')) return false;
      if (detail.type === 'object.unknown' && detail.context?.key === 'storeProfile') return false;
      return true;
    });
  }
  if (type === 'Trade' || type === 'Departmental' || type === 'Ecom') {
    return details.filter((detail) => {
      const valids = detail.context?.valids;
      if (detail.type === 'any.only' && valids?.length === 1 && valids[0] === 'Store') return false;
      if (detail.type === 'any.required' && detail.context?.key === 'storeProfile') return false;
      return true;
    });
  }
  const shown = type ? `"${type}"` : 'blank';
  return [{
    message: `Channel is ${shown}. Use Store, Trade, Departmental, or Ecom.`,
  }];
}

/**
 * One Joi detail → one sentence a user can act on.
 * @param {{ type?: string, message?: string, path?: Array<string|number>, context?: { value?: { type?: string }, details?: object[] } }} detail
 * @returns {string}
 */
function formatWarehouseClientDetail(detail) {
  if (detail.type === 'alternatives.match' && Array.isArray(detail.context?.details)) {
    const submittedType = detail.context.value?.type;
    const relevant = detailsForSubmittedType(submittedType, detail.context.details);
    const text = [...new Set(
      relevant.map((item) => labelizeWarehouseClientMessage(item.message || '')).filter(Boolean),
    )].join('; ');
    const row = spreadsheetRowFromPath(detail.path || []);
    return row ? `Row ${row}: ${text}` : text;
  }
  const row = spreadsheetRowFromPath(detail.path || []);
  const text = labelizeWarehouseClientMessage(detail.message || 'Invalid value');
  return row ? `Row ${row}: ${text}` : text;
}

/**
 * Turn a warehouse-client Joi error into row-level sentences.
 * @param {{ details: Array<object> }} error
 * @returns {string}
 */
export function formatWarehouseClientValidationError(error) {
  const lines = [...new Set((error.details || []).map(formatWarehouseClientDetail).filter(Boolean))];
  const shown = lines.slice(0, 12);
  const extra = lines.length - shown.length;
  const body = shown.join(' | ');
  if (!extra) return body || 'Import data is invalid. Check Channel and dates, then upload again.';
  return `${body} | and ${extra} more row(s). Nothing was saved.`;
}
