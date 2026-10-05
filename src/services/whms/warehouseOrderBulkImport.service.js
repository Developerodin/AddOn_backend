import { WarehouseClient, WarehouseOrder } from '../../models/whms/index.js';
import { flowStatusForCoarseStatus } from '../../models/whms/warehouseOrder.model.js';
import StyleCode from '../../models/styleCode.model.js';
import StyleCodePairs from '../../models/styleCodePairs.model.js';
import { createPickListForOrder } from './pickList.service.js';
import { blockInventoryForWarehouseOrder } from './warehouseOrderInventoryBlock.helper.js';
import { buildArticleAttrsByStyleCodeId, coalesceLineField } from './warehouseOrderCatalogEnrich.js';
import { generateWarehouseOrderNumber } from './warehouseOrderNumber.js';

const WAREHOUSE_CLIENT_TYPES = new Set(['Store', 'Trade', 'Departmental', 'Ecom']);

/**
 * Parse date strings like "17/02/2026", "17-02-2026", Excel serials, or ISO strings.
 * @param {unknown} raw
 * @returns {Date|null}
 */
const parseFlexibleDate = (raw) => {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  const str = String(raw).trim();

  const ddmmyyyy = str.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (ddmmyyyy) return new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`);

  if (/^\d{4,6}$/.test(str)) {
    const serial = Number(str);
    if (serial > 0) {
      const EXCEL_EPOCH = new Date(Date.UTC(1899, 11, 30)).getTime();
      return new Date(EXCEL_EPOCH + serial * 86400000);
    }
  }

  const iso = new Date(str);
  return Number.isNaN(iso.getTime()) ? null : iso;
};

/**
 * Normalize bulk-import client type strings (e.g. "store" → "Store").
 * @param {string} raw
 * @returns {string|null}
 */
const normalizeBulkImportClientType = (raw) => {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const title = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  if (WAREHOUSE_CLIENT_TYPES.has(title)) return title;
  if (v === 'Departmental' || /^departmental$/i.test(v)) return 'Departmental';
  if (/^ecom$/i.test(v)) return 'Ecom';
  return WAREHOUSE_CLIENT_TYPES.has(v) ? v : null;
};

/**
 * Trim a store profile code from a bulk-import row.
 * @param {unknown} value
 * @returns {string}
 */
const storeCode = (value) => (value == null ? '' : String(value).trim());

/**
 * Find WarehouseClient docs by display name + type (may return multiple when names collide).
 * Store: storeProfile.brand / billCode / sapCode / retekCode.
 * Other types: retailerName or parentKeyCode (SAP code).
 * @param {string} clientName
 * @param {string} clientType
 */
const findClientsByName = async (clientName, clientType) => {
  const name = String(clientName).trim();
  if (!name) return [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped}$`, 'i');

  const filter = { type: clientType };
  if (clientType === 'Store') {
    filter.$or = [
      { 'storeProfile.brand': regex },
      { 'storeProfile.billCode': regex },
      { 'storeProfile.sapCode': regex },
      { 'storeProfile.retekCode': regex },
    ];
  } else {
    filter.$or = [{ retailerName: regex }, { parentKeyCode: regex }];
  }

  return WarehouseClient.find(filter).lean();
};

/**
 * Find Store clients whose profile codes match every code that was sent.
 * @param {{ bill: string, sap: string, retek: string }} codes
 */
const findStoresByProfileCodes = async ({ bill, sap, retek }) => {
  const filter = { type: 'Store' };
  if (bill) filter['storeProfile.billCode'] = bill;
  if (sap) filter['storeProfile.sapCode'] = sap;
  if (retek) filter['storeProfile.retekCode'] = retek;
  return WarehouseClient.find(filter).lean();
};

/**
 * Resolve client for bulk import.
 * Prefer Mongo clientId, then store bill/SAP/retek together, then unique client name.
 * @param {{ clientId?: string, clientName?: string, clientType: string, storeBillCode?: string, storeSapCode?: string, storeRetekCode?: string }} row
 */
const resolveClientForBulkImport = async (row) => {
  const clientType = normalizeBulkImportClientType(row.clientType);
  if (!clientType) throw new Error(`Invalid clientType "${row.clientType}"`);

  const clientId = row.clientId != null ? String(row.clientId).trim() : '';
  if (clientId) {
    const client = await WarehouseClient.findById(clientId).lean();
    if (!client) throw new Error(`Client id "${clientId}" not found`);
    if (client.type !== clientType) {
      throw new Error(`clientType "${clientType}" does not match client id "${clientId}" (actual: ${client.type})`);
    }
    return { client, clientType };
  }

  const bill = storeCode(row.storeBillCode);
  const sap = storeCode(row.storeSapCode);
  const retek = storeCode(row.storeRetekCode);
  if (bill || sap || retek) {
    if (clientType !== 'Store') {
      throw new Error('Store bill, SAP, or retek codes require clientType "Store"');
    }
    const matches = await findStoresByProfileCodes({ bill, sap, retek });
    const label = `bill "${bill}" sap "${sap}" retek "${retek}"`;
    if (matches.length === 0) throw new Error(`Store not found for ${label}`);
    if (matches.length > 1) {
      const ids = matches.map((c) => String(c._id)).join(', ');
      throw new Error(`Multiple stores (${matches.length}) match ${label}. Matching ids: ${ids}`);
    }
    return { client: matches[0], clientType };
  }

  const clientName = String(row.clientName ?? '').trim();
  if (!clientName) throw new Error('Either clientId, clientName, or a store bill/SAP/retek code is required');

  const matches = await findClientsByName(clientName, clientType);
  if (matches.length === 0) {
    throw new Error(`Client "${clientName}" not found for type "${clientType}"`);
  }
  if (matches.length > 1) {
    const ids = matches.map((c) => String(c._id)).join(', ');
    throw new Error(
      `Multiple clients (${matches.length}) match "${clientName}" for type "${clientType}". ` +
        `Use clientId to disambiguate. Matching ids: ${ids}`
    );
  }

  return { client: matches[0], clientType };
};

/**
 * Map a catalogue single-pair style onto an order line.
 * @param {object} item
 * @param {object} doc
 * @param {Map<string, { colour: string, pattern: string }>} articleAttrsByStyleCodeId
 */
const toSingleLine = (item, doc, articleAttrsByStyleCodeId) => {
  const catalogAttrs = articleAttrsByStyleCodeId.get(String(doc._id)) || { colour: '', pattern: '' };
  return {
    styleCodeId: doc._id,
    styleCode: doc.styleCode,
    pack: doc.pack || '',
    type: coalesceLineField(item.type, doc.brand),
    colour: coalesceLineField(item.colour || item.color, catalogAttrs.colour),
    pattern: coalesceLineField(item.pattern, catalogAttrs.pattern),
    eanCode: coalesceLineField(item.eanCode, doc.eanCode),
    quantity: Number(item.quantity),
  };
};

/**
 * Map a multi-pair style onto an order line.
 * @param {object} item
 * @param {object} doc
 * @param {Map<string, object>} styleCodeById
 * @param {Map<string, { colour: string, pattern: string }>} articleAttrsByStyleCodeId
 */
const toMultiLine = (item, doc, styleCodeById, articleAttrsByStyleCodeId) => {
  const firstLinkedId = doc.styleCodes?.[0] ? String(doc.styleCodes[0]) : '';
  const linkedStyle = firstLinkedId ? styleCodeById.get(firstLinkedId) : null;
  const catalogAttrs = firstLinkedId
    ? articleAttrsByStyleCodeId.get(firstLinkedId) || { colour: '', pattern: '' }
    : { colour: '', pattern: '' };
  return {
    styleCodeMultiPairId: doc._id,
    styleCode: doc.pairStyleCode,
    pack: String(doc.pack || ''),
    type: coalesceLineField(item.type, linkedStyle?.brand),
    colour: coalesceLineField(item.colour || item.color, catalogAttrs.colour),
    pattern: coalesceLineField(item.pattern, catalogAttrs.pattern),
    eanCode: coalesceLineField(item.eanCode, doc.eanCode),
    quantity: Number(item.quantity),
  };
};

/**
 * Split row lines into single and multi items.
 * A code sent as single-pair is moved to multi-pair when it is not a single style code.
 * @param {object} row
 * @param {Map<string, object>} singleByCode
 * @param {Map<string, object>} multiByCode
 * @param {Map<string, object>} styleCodeById
 * @param {Map<string, { colour: string, pattern: string }>} articleAttrsByStyleCodeId
 */
const resolveBulkLineItems = (row, singleByCode, multiByCode, styleCodeById, articleAttrsByStyleCodeId) => {
  const singleItems = [];
  const multiItems = [];

  (row.styleCodeMultiPair || []).forEach((item, mIdx) => {
    const code = String(item.styleCode || '').trim();
    const doc = multiByCode.get(code);
    if (!doc) throw new Error(`Multi-pair styleCode "${code}" not found (item ${mIdx + 1})`);
    multiItems.push(toMultiLine(item, doc, styleCodeById, articleAttrsByStyleCodeId));
  });

  (row.styleCodeSinglePair || []).forEach((item, sIdx) => {
    const code = String(item.styleCode || '').trim();
    const singleDoc = singleByCode.get(code);
    if (singleDoc) {
      singleItems.push(toSingleLine(item, singleDoc, articleAttrsByStyleCodeId));
      return;
    }
    const multiDoc = multiByCode.get(code);
    if (multiDoc) {
      multiItems.push(toMultiLine(item, multiDoc, styleCodeById, articleAttrsByStyleCodeId));
      return;
    }
    throw new Error(`Style code "${code}" not found as single or multi pair (item ${sIdx + 1})`);
  });

  return { singleItems, multiItems };
};

/**
 * Collect every style code string on the import payload.
 * @param {object[]} orders
 * @returns {string[]}
 */
const collectStyleCodes = (orders) => {
  const codes = new Set();
  orders.forEach((row) => {
    (row.styleCodeSinglePair || []).forEach((item) => {
      if (item?.styleCode) codes.add(String(item.styleCode).trim());
    });
    (row.styleCodeMultiPair || []).forEach((item) => {
      if (item?.styleCode) codes.add(String(item.styleCode).trim());
    });
  });
  return [...codes];
};

/**
 * Bulk-import warehouse orders from a flat array (typically from an Excel upload).
 *
 * Each row accepts:
 *  - clientType, clientId or clientName, or storeBillCode / storeSapCode / storeRetekCode
 *  - date, status, addonOrderId, meta
 *  - styleCodeSinglePair / styleCodeMultiPair style codes (catalogue fills pack, type, colour, pattern, ean)
 * @param {object[]} orders
 * @param {number} [_batchSize]
 */
export const bulkImportWarehouseOrders = async (orders, _batchSize = 50) => {
  const results = {
    total: orders.length,
    created: 0,
    failed: 0,
    errors: [],
    processingTime: 0,
  };
  const startTime = Date.now();
  const codes = collectStyleCodes(orders);

  const [singleDocs, multiDocs] = await Promise.all([
    codes.length ? StyleCode.find({ styleCode: { $in: codes } }).lean() : [],
    codes.length ? StyleCodePairs.find({ pairStyleCode: { $in: codes } }).lean() : [],
  ]);

  const singleByCode = new Map(singleDocs.map((d) => [d.styleCode, d]));
  const multiByCode = new Map(multiDocs.map((d) => [d.pairStyleCode, d]));

  const linkedStyleCodeIds = new Set();
  multiDocs.forEach((d) => {
    (d.styleCodes || []).forEach((id) => linkedStyleCodeIds.add(String(id)));
  });

  const missingLinkedIds = [...linkedStyleCodeIds].filter((id) => !singleDocs.some((d) => String(d._id) === id));
  const linkedStyleDocs =
    missingLinkedIds.length > 0 ? await StyleCode.find({ _id: { $in: missingLinkedIds } }).lean() : [];
  const styleCodeById = new Map([...singleDocs, ...linkedStyleDocs].map((d) => [String(d._id), d]));

  const articleAttrsByStyleCodeId = await buildArticleAttrsByStyleCodeId([
    ...singleDocs.map((d) => String(d._id)),
    ...linkedStyleCodeIds,
  ]);

  for (let i = 0; i < orders.length; i += 1) {
    const row = orders[i];
    try {
      if (!row.clientType) throw new Error('clientType is required');

      const { client, clientType } = await resolveClientForBulkImport(row);
      const clientName =
        client.type === 'Store'
          ? client.storeProfile?.brand ||
            client.storeProfile?.billCode ||
            client.storeProfile?.sapCode ||
            client.storeProfile?.retekCode ||
            'Store'
          : client.retailerName || client.parentKeyCode || 'Client';

      const { singleItems, multiItems } = resolveBulkLineItems(
        row,
        singleByCode,
        multiByCode,
        styleCodeById,
        articleAttrsByStyleCodeId
      );

      if (singleItems.length + multiItems.length === 0) {
        throw new Error('Order must have at least one style-code item');
      }

      const orderNumber = await generateWarehouseOrderNumber();
      const addonOrderId =
        row.addonOrderId != null && String(row.addonOrderId).trim() ? String(row.addonOrderId).trim() : undefined;
      const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? row.meta : undefined;

      const created = await WarehouseOrder.create({
        orderNumber,
        date: parseFlexibleDate(row.date) || new Date(),
        clientType,
        clientId: client._id,
        clientName,
        ...(addonOrderId !== undefined ? { addonOrderId } : {}),
        ...(meta ? { meta } : {}),
        styleCodeSinglePair: singleItems,
        styleCodeMultiPair: multiItems,
        status: row.status || 'pending',
        flowStatus: flowStatusForCoarseStatus(row.status || 'pending'),
      });

      await createPickListForOrder(created);
      await blockInventoryForWarehouseOrder(created);
      results.created += 1;
    } catch (error) {
      results.failed += 1;
      results.errors.push({
        index: i,
        row: i + 1,
        clientName: row.clientName || row.storeBillCode || row.storeSapCode || row.storeRetekCode,
        clientId: row.clientId,
        reason: error.message,
        error: error.message,
      });
    }
  }

  results.processingTime = Date.now() - startTime;
  return results;
};
