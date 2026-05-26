import httpStatus from 'http-status';
import mongoose from 'mongoose';
import DispatchStockTransferNote, {
  DispatchStnCounter,
  DispatchStnStatus,
} from '../../models/production/dispatchStockTransferNote.model.js';
import { ContainersMaster } from '../../models/production/index.js';
import Product from '../../models/product.model.js';
import ApiError from '../../utils/ApiError.js';
import {
  getPrintEligibleDispatchTransferredData,
  loadActiveStnAllocationMap,
} from '../../utils/dispatchWarehousePending.util.js';
import { getDispatchOrdersPendingWarehousePrint } from './order.service.js';

const REPORT_MAX_ROWS = 10000;

/**
 * Paginate through all pending warehouse print orders for a filter set.
 * @param {Object} filter
 * @returns {Promise<Array<{ order: Object, articles: Object[] }>>}
 */
const collectAllPendingPrintOrders = async (filter = {}) => {
  const aggregated = [];
  let page = 1;
  let totalPages = 1;
  const limit = 200;

  while (page <= totalPages && page <= 500) {
    // eslint-disable-next-line no-await-in-loop
    const batch = await getDispatchOrdersPendingWarehousePrint('Dispatch', filter, { page, limit });
    aggregated.push(...(batch.results || []));
    totalPages = batch.totalPages || 1;
    page += 1;
    if (!(batch.results || []).length) break;
  }

  return aggregated;
};

/**
 * Build flat pending print lines from order catalog snapshot.
 * @param {Array<Object>} orders
 * @returns {Array<{ articleId: string, orderId: string, articleNumber: string, brand: string, qtyInPairs: number }>}
 */
const flattenPendingLinesFromOrders = (orders) => {
  const lines = [];
  for (const order of orders || []) {
    const orderId = String(order._id || order.id);
    for (const article of order.articles || []) {
      const articleId = String(article._id || article.id);
      const transferredData = article.floorQuantities?.dispatch?.transferredData || [];
      for (const row of transferredData) {
        const qty = Number(row.transferred ?? 0);
        if (qty <= 0) continue;
        lines.push({
          articleId,
          orderId,
          articleNumber: String(article.articleNumber ?? '').trim(),
          brand: String(row.brand ?? '').trim(),
          qtyInPairs: qty,
        });
      }
    }
  }
  return lines;
};

/**
 * Resolve product names by factory code (case-insensitive).
 * @param {string[]} factoryCodes
 * @returns {Promise<Map<string, string>>}
 */
const resolveArticleNamesByFactoryCode = async (factoryCodes) => {
  const unique = [...new Set(factoryCodes.filter(Boolean))];
  const nameMap = new Map();
  if (!unique.length) return nameMap;

  const products = await Product.find({
    $or: unique.map((code) => ({
      factoryCode: new RegExp(`^${String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    })),
  })
    .select('factoryCode name')
    .lean();

  for (const product of products) {
    const fc = String(product.factoryCode ?? '').trim().toLowerCase();
    if (fc) nameMap.set(fc, String(product.name ?? '').trim() || '—');
  }
  return nameMap;
};

/**
 * Resolve catalog brand labels by factory code (same fallback as dispatch article view).
 * @param {string[]} factoryCodes
 * @returns {Promise<Map<string, string>>}
 */
const resolveBrandLabelsByFactoryCode = async (factoryCodes) => {
  const unique = [...new Set(factoryCodes.filter(Boolean))];
  const brandMap = new Map();
  if (!unique.length) return brandMap;

  const products = await Product.find({
    $or: unique.map((code) => ({
      factoryCode: new RegExp(`^${String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    })),
  })
    .select('factoryCode styleCodes')
    .populate('styleCodes', 'brand')
    .lean();

  for (const product of products) {
    const fc = String(product.factoryCode ?? '').trim().toLowerCase();
    if (!fc) continue;
    const seen = new Set();
    const brands = [];
    for (const styleCode of product.styleCodes || []) {
      const brand = String(styleCode?.brand ?? '').trim();
      const key = brand.toLowerCase();
      if (!brand || seen.has(key)) continue;
      seen.add(key);
      brands.push(brand);
    }
    if (brands.length) brandMap.set(fc, brands.join('; '));
  }
  return brandMap;
};

/**
 * Brand display for STN line: transfer row brand, else product catalog brands.
 * @param {string} lineBrand
 * @param {string} factoryCode
 * @param {Map<string, string>} brandMap
 * @returns {string}
 */
const displayBrandForLine = (lineBrand, factoryCode, brandMap) => {
  const trimmed = String(lineBrand ?? '').trim();
  if (trimmed) return trimmed;
  const fcKey = String(factoryCode ?? '').trim().toLowerCase();
  return brandMap.get(fcKey) || '—';
};

/**
 * Maps a pending flat line to STN line fields with resolved name + brand.
 * @param {Object} line
 * @param {Map<string, string>} nameMap
 * @param {Map<string, string>} brandMap
 * @returns {Object}
 */
const mapLineToStnFields = (line, nameMap, brandMap) => {
  const fcKey = String(line.articleNumber ?? '').trim().toLowerCase();
  const brandLabel = displayBrandForLine(line.brand, line.articleNumber, brandMap);
  return {
    articleId: line.articleId,
    orderId: line.orderId,
    articleNumber: line.articleNumber || '—',
    sapArticleNo: brandLabel,
    articleName: nameMap.get(fcKey) || '—',
    brand: brandLabel,
    qtyInPairs: line.qtyInPairs,
    containerIds: line.containerIds || [],
    containerBarcodes: line.containerBarcodes || [],
  };
};

/**
 * Re-resolve brand labels from catalog for stored lines (re-print / history display).
 * @param {Array<Object>} lines
 * @returns {Promise<Array<Object>>}
 */
const enrichStnLinesWithCatalogBrands = async (lines) => {
  const factoryCodes = (lines || []).map((line) => line.articleNumber).filter(Boolean);
  const brandMap = await resolveBrandLabelsByFactoryCode(factoryCodes);
  return (lines || []).map((line) => {
    const rawBrand = String(line.brand ?? '').trim();
    const normalizedRaw = rawBrand === '—' ? '' : rawBrand;
    const brandLabel = displayBrandForLine(normalizedRaw, line.articleNumber, brandMap);
    return {
      ...line,
      brand: brandLabel,
      sapArticleNo: brandLabel,
    };
  });
};

/**
 * Attach warehouse-staged containers to pending lines (best-effort).
 * @param {Array<Object>} lines
 * @returns {Promise<{ lines: Array<Object>, totalBoxes: number }>}
 */
const attachContainersToLines = async (lines) => {
  const articleIds = [...new Set(lines.map((l) => l.articleId))].filter(Boolean);
  if (!articleIds.length) {
    return { lines, totalBoxes: 0 };
  }

  const objectIds = articleIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const containers = await ContainersMaster.find({
    activeFloor: 'Warehouse',
    status: 'Active',
    'activeItems.article': { $in: objectIds },
  })
    .select('_id barcode activeItems')
    .lean();

  const containersByArticle = new Map();
  const distinctContainerIds = new Set();

  for (const container of containers) {
    distinctContainerIds.add(String(container._id));
    for (const item of container.activeItems || []) {
      const artId = String(item.article ?? '');
      if (!artId) continue;
      if (!containersByArticle.has(artId)) containersByArticle.set(artId, []);
      containersByArticle.get(artId).push({
        id: container._id,
        barcode: container.barcode || String(container._id),
      });
    }
  }

  const enriched = lines.map((line) => {
    const linked = containersByArticle.get(line.articleId) || [];
    return {
      ...line,
      containerIds: linked.map((c) => c.id),
      containerBarcodes: linked.map((c) => c.barcode),
    };
  });

  return { lines: enriched, totalBoxes: distinctContainerIds.size };
};

/**
 * Create a Stock Transfer Note from current print-eligible pending qty.
 * @param {Object} body
 * @param {string} [body.categoryLabel]
 * @param {Object} [filter] - optional same filters as pending print list
 * @param {Object} user
 * @returns {Promise<Object>}
 */
export const createDispatchTransferNote = async (body = {}, filter = {}, user = null) => {
  const pendingOrders = await collectAllPendingPrintOrders(filter);
  const flatLines = flattenPendingLinesFromOrders(pendingOrders);

  if (!flatLines.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No pending quantity available for transfer note');
  }

  const factoryCodes = flatLines.map((l) => l.articleNumber);
  const nameMap = await resolveArticleNamesByFactoryCode(factoryCodes);
  const brandMap = await resolveBrandLabelsByFactoryCode(factoryCodes);
  const { lines: linesWithContainers, totalBoxes } = await attachContainersToLines(flatLines);

  const stnLines = linesWithContainers.map((line) => mapLineToStnFields(line, nameMap, brandMap));

  const allocations = linesWithContainers.map((line) => ({
    articleId: line.articleId,
    brand: line.brand,
    quantity: line.qtyInPairs,
  }));

  const totalQty = stnLines.reduce((sum, line) => sum + line.qtyInPairs, 0);
  const stnSerial = await DispatchStnCounter.getNextSerial();

  const doc = await DispatchStockTransferNote.create({
    stnSerial,
    stnDate: new Date(),
    categoryLabel: String(body.categoryLabel ?? '').trim() || 'CORE & COLLECTION MIX',
    fromUnit: 'Unit B7-GF',
    toUnit: 'Unit B8-2F',
    totalQty,
    totalBoxes,
    createdBy: user?.id || user?._id,
    status: DispatchStnStatus.ACTIVE,
    lines: stnLines,
    allocations,
  });

  return doc.toJSON ? doc.toJSON() : doc;
};

/**
 * Query transfer note history with pagination.
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const queryDispatchTransferNotes = async (filter = {}, options = {}) => {
  const mongoFilter = { status: DispatchStnStatus.ACTIVE };

  if (filter.startDate || filter.endDate) {
    mongoFilter.stnDate = {};
    if (filter.startDate) mongoFilter.stnDate.$gte = new Date(filter.startDate);
    if (filter.endDate) {
      const end = new Date(filter.endDate);
      end.setHours(23, 59, 59, 999);
      mongoFilter.stnDate.$lte = end;
    }
  }

  if (filter.search) {
    const term = String(filter.search).trim();
    if (term) {
      mongoFilter.$or = [
        { stnSerial: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        { categoryLabel: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        { 'lines.articleNumber': new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        { 'lines.sapArticleNo': new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      ];
    }
  }

  const queryOptions = {
    sortBy: options.sortBy || 'stnDate:desc',
    limit: options.limit || 20,
    page: options.page || 1,
    populate: { path: 'createdBy', select: 'name email' },
  };

  return DispatchStockTransferNote.paginate(mongoFilter, queryOptions);
};

/**
 * Fetch one transfer note by Mongo id.
 * @param {string} transferNoteId
 * @returns {Promise<Object>}
 */
export const getDispatchTransferNoteById = async (transferNoteId) => {
  const doc = await DispatchStockTransferNote.findById(transferNoteId).populate(
    'createdBy',
    'name email'
  );
  if (!doc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Transfer note not found');
  }
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.lines = await enrichStnLinesWithCatalogBrands(json.lines);
  return json;
};

/**
 * Flat report rows for Excel export.
 * @param {Object} filter
 * @returns {Promise<Array<Object>>}
 */
export const getDispatchTransferNoteReportRows = async (filter = {}) => {
  const mongoFilter = { status: DispatchStnStatus.ACTIVE };

  if (filter.startDate || filter.endDate) {
    mongoFilter.stnDate = {};
    if (filter.startDate) mongoFilter.stnDate.$gte = new Date(filter.startDate);
    if (filter.endDate) {
      const end = new Date(filter.endDate);
      end.setHours(23, 59, 59, 999);
      mongoFilter.stnDate.$lte = end;
    }
  }

  if (filter.search) {
    const term = String(filter.search).trim();
    if (term) {
      mongoFilter.$or = [
        { stnSerial: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        { categoryLabel: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        { 'lines.articleNumber': new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      ];
    }
  }

  const docs = await DispatchStockTransferNote.find(mongoFilter)
    .sort({ stnDate: -1 })
    .limit(REPORT_MAX_ROWS)
    .populate('createdBy', 'name email')
    .lean();

  const rows = [];
  for (const doc of docs) {
    for (const line of doc.lines || []) {
      rows.push({
        stnSerial: doc.stnSerial,
        stnDate: doc.stnDate,
        categoryLabel: doc.categoryLabel,
        totalQty: doc.totalQty,
        totalBoxes: doc.totalBoxes,
        articleNumber: line.articleNumber,
        sapArticleNo: line.sapArticleNo,
        articleName: line.articleName,
        brand: line.brand,
        qtyInPairs: line.qtyInPairs,
        containerBarcodes: (line.containerBarcodes || []).join(', '),
        createdByName: doc.createdBy?.name || doc.createdBy?.email || '',
      });
    }
  }
  return rows;
};

/**
 * Preview pending print lines without creating an STN (for modal preview).
 * @param {Object} filter
 * @returns {Promise<{ lines: Array<Object>, totalQty: number }>}
 */
export const previewDispatchTransferNoteLines = async (filter = {}) => {
  const pendingOrders = await collectAllPendingPrintOrders(filter);
  const flatLines = flattenPendingLinesFromOrders(pendingOrders);
  const factoryCodes = flatLines.map((l) => l.articleNumber);
  const nameMap = await resolveArticleNamesByFactoryCode(factoryCodes);
  const brandMap = await resolveBrandLabelsByFactoryCode(factoryCodes);

  const lines = flatLines.map((line) => {
    const mapped = mapLineToStnFields(line, nameMap, brandMap);
    return {
      articleNumber: mapped.articleNumber,
      sapArticleNo: mapped.brand,
      articleName: mapped.articleName,
      brand: mapped.brand,
      qtyInPairs: mapped.qtyInPairs,
    };
  });

  const totalQty = lines.reduce((sum, line) => sum + line.qtyInPairs, 0);
  return { lines, totalQty };
};

/** @deprecated internal — exported for tests */
export const _internals = {
  collectAllPendingPrintOrders,
  flattenPendingLinesFromOrders,
  loadActiveStnAllocationMap,
  getPrintEligibleDispatchTransferredData,
};
