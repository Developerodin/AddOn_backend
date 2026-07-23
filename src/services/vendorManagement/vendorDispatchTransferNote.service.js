import httpStatus from 'http-status';
import mongoose from 'mongoose';
import VendorDispatchStockTransferNote, {
  VendorDispatchStnCounter,
  VendorDispatchStnStatus,
} from '../../models/vendorManagement/vendorDispatchStockTransferNote.model.js';
import { ContainersMaster } from '../../models/production/index.js';
import Product from '../../models/product.model.js';
import VendorProductionFlow from '../../models/vendorManagement/vendorProductionFlow.model.js';
import ApiError from '../../utils/ApiError.js';
import * as vendorManagementService from '../vendorManagement/vendorManagement.service.js';
import {
  filterVendorWarehouseHandoffReceivedData,
  getPrintEligibleVendorDispatchTransferredData,
  loadActiveVendorStnAllocationMap,
} from '../../utils/vendorDispatchWarehousePending.util.js';

const REPORT_MAX_ROWS = 10000;
const VENDOR_WAREHOUSE_INWARD_FLOOR = 'Warehouse Inward';

/**
 * Paginate through vendor production flows on dispatch floor.
 * @param {Object} filter
 * @returns {Promise<Array<Object>>}
 */
const collectAllPendingVendorFlows = async (filter = {}) => {
  const aggregated = [];
  let page = 1;
  let totalPages = 1;
  const limit = 200;

  while (page <= totalPages && page <= 500) {
    // eslint-disable-next-line no-await-in-loop
    const batch = await vendorManagementService.queryVendorProductionFlows(
      { currentFloorKey: 'dispatch' },
      { page, limit },
      filter.search
    );
    aggregated.push(...(batch.results || []));
    totalPages = batch.totalPages || 1;
    page += 1;
    if (!(batch.results || []).length) break;
  }

  return aggregated;
};

/**
 * Build flat pending print lines from vendor flow snapshots.
 * @param {Array<Object>} flows
 * @param {Map<string, number>} stnAllocMap
 * @returns {Array<Object>}
 */
const flattenPendingLinesFromFlows = (flows, stnAllocMap) => {
  const lines = [];
  for (const flow of flows || []) {
    const flowId = String(flow._id || flow.id);
    const dispatch = flow.floorQuantities?.dispatch;
    if (!dispatch) continue;

    const handoffData = filterVendorWarehouseHandoffReceivedData(dispatch.receivedData);
    const pendingRows = getPrintEligibleVendorDispatchTransferredData(
      dispatch.transferredData,
      handoffData,
      flowId,
      stnAllocMap
    );

    const product = flow.product;
    const factoryCode =
      typeof product === 'object' && product?.factoryCode
        ? String(product.factoryCode).trim()
        : '';
    const vendorCode =
      typeof product === 'object' && product?.vendorCode
        ? String(product.vendorCode).trim()
        : '';
    /** Display the vendor's own code; fall back to factory code so the column is never blank. */
    const articleNumber = vendorCode || factoryCode;

    for (const row of pendingRows) {
      const qty = Number(row.transferred ?? 0);
      if (qty <= 0) continue;
      lines.push({
        vendorProductionFlowId: flowId,
        vendorPurchaseOrderId: flow.vendorPurchaseOrder?._id || flow.vendorPurchaseOrder || null,
        vpoNumber: flow.vendorPurchaseOrder?.vpoNumber || '',
        vendorName: flow.vendor?.header?.vendorName || '',
        invoiceNumber: String(flow.referenceCode ?? '').trim(),
        articleNumber,
        factoryCode,
        brand: String(row.brand ?? '').trim(),
        qtyInPairs: qty,
      });
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
 * Resolve catalog brand labels by factory code.
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
 * Brand display for STN line.
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
 * Maps a pending flat line to STN line fields.
 * @param {Object} line
 * @param {Map<string, string>} nameMap
 * @param {Map<string, string>} brandMap
 * @returns {Object}
 */
const mapLineToStnFields = (line, nameMap, brandMap) => {
  /** Name/brand catalog is keyed on factory code; the displayed articleNumber is the vendor code. */
  const fcKey = String(line.factoryCode ?? '').trim().toLowerCase();
  const brandLabel = displayBrandForLine(line.brand, line.factoryCode, brandMap);
  return {
    vendorProductionFlowId: line.vendorProductionFlowId,
    vendorPurchaseOrderId: line.vendorPurchaseOrderId,
    vpoNumber: line.vpoNumber || '',
    vendorName: line.vendorName || '',
    invoiceNumber: line.invoiceNumber || '',
    articleNumber: line.articleNumber || '—',
    factoryCode: line.factoryCode || '',
    sapArticleNo: brandLabel,
    articleName: nameMap.get(fcKey) || '—',
    brand: brandLabel,
    qtyInPairs: line.qtyInPairs,
    containerIds: line.containerIds || [],
    containerBarcodes: line.containerBarcodes || [],
  };
};

/**
 * Re-resolve brand labels from catalog for stored lines.
 * @param {Array<Object>} lines
 * @returns {Promise<Array<Object>>}
 */
const enrichStnLinesWithCatalogBrands = async (lines) => {
  /** Older STN docs may lack `factoryCode`; fall back to articleNumber for those legacy rows. */
  const factoryCodes = (lines || []).map((line) => line.factoryCode || line.articleNumber).filter(Boolean);
  const brandMap = await resolveBrandLabelsByFactoryCode(factoryCodes);
  return (lines || []).map((line) => {
    const rawBrand = String(line.brand ?? '').trim();
    const normalizedRaw = rawBrand === '—' ? '' : rawBrand;
    const lookupCode = line.factoryCode || line.articleNumber;
    const brandLabel = displayBrandForLine(normalizedRaw, lookupCode, brandMap);
    return {
      ...line,
      brand: brandLabel,
      sapArticleNo: brandLabel,
    };
  });
};

/**
 * Attach warehouse-inward staged containers to pending lines (vendor pipeline).
 * @param {Array<Object>} lines
 * @returns {Promise<{ lines: Array<Object>, totalBoxes: number }>}
 */
const attachContainersToLines = async (lines) => {
  const flowIds = [...new Set(lines.map((l) => l.vendorProductionFlowId))].filter(Boolean);
  if (!flowIds.length) {
    return { lines, totalBoxes: 0 };
  }

  const objectIds = flowIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const containers = await ContainersMaster.find({
    activeFloor: new RegExp(`^${VENDOR_WAREHOUSE_INWARD_FLOOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    status: 'Active',
    'activeItems.vendorProductionFlow': { $in: objectIds },
  })
    .select('_id barcode activeItems')
    .lean();

  const containersByFlow = new Map();
  const distinctContainerIds = new Set();

  for (const container of containers) {
    distinctContainerIds.add(String(container._id));
    for (const item of container.activeItems || []) {
      const flowId = String(item.vendorProductionFlow ?? '');
      if (!flowId) continue;
      if (!containersByFlow.has(flowId)) containersByFlow.set(flowId, []);
      containersByFlow.get(flowId).push({
        id: container._id,
        barcode: container.barcode || String(container._id),
      });
    }
  }

  const enriched = lines.map((line) => {
    const linked = containersByFlow.get(String(line.vendorProductionFlowId)) || [];
    return {
      ...line,
      containerIds: linked.map((c) => c.id),
      containerBarcodes: linked.map((c) => c.barcode),
    };
  });

  return { lines: enriched, totalBoxes: distinctContainerIds.size };
};

/**
 * Resolve invoice numbers for STN lines via vendor production flow referenceCode.
 * @param {Array<{ vendorProductionFlowId?: unknown, invoiceNumber?: string }>} lines
 * @returns {Promise<Map<string, string>>}
 */
const resolveInvoiceNumbersByFlowId = async (lines) => {
  const flowIds = [
    ...new Set(
      (lines || [])
        .filter((line) => !String(line.invoiceNumber ?? '').trim() && line.vendorProductionFlowId)
        .map((line) => String(line.vendorProductionFlowId))
    ),
  ].filter((id) => mongoose.Types.ObjectId.isValid(id));

  const map = new Map();
  if (!flowIds.length) return map;

  const objectIds = flowIds.map((id) => new mongoose.Types.ObjectId(id));
  const flows = await VendorProductionFlow.find({ _id: { $in: objectIds } })
    .select('referenceCode')
    .lean();

  for (const flow of flows) {
    const invoice = String(flow.referenceCode ?? '').trim();
    if (invoice) map.set(String(flow._id), invoice);
  }
  return map;
};

/**
 * Attach invoice numbers to STN lines (stored value or flow.referenceCode fallback).
 * @param {Array<Object>} lines
 * @returns {Promise<Array<Object>>}
 */
const enrichStnLinesWithInvoiceNumbers = async (lines) => {
  const invoiceByFlowId = await resolveInvoiceNumbersByFlowId(lines || []);
  return (lines || []).map((line) => {
    const stored = String(line.invoiceNumber ?? '').trim();
    const fromFlow = invoiceByFlowId.get(String(line.vendorProductionFlowId ?? '')) || '';
    return {
      ...line,
      invoiceNumber: stored || fromFlow,
    };
  });
};

/**
 * Create a vendor dispatch Stock Transfer Note from current print-eligible pending qty.
 * @param {Object} body
 * @param {string} [body.categoryLabel]
 * @param {Object} [filter]
 * @param {Object} user
 * @returns {Promise<Object>}
 */
export const createVendorDispatchTransferNote = async (body = {}, filter = {}, user = null) => {
  const stnAllocMap = await loadActiveVendorStnAllocationMap();
  const flows = await collectAllPendingVendorFlows(filter);
  const flatLines = flattenPendingLinesFromFlows(flows, stnAllocMap);

  if (!flatLines.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No pending quantity available for transfer note');
  }

  const factoryCodes = flatLines.map((l) => l.factoryCode);
  const nameMap = await resolveArticleNamesByFactoryCode(factoryCodes);
  const brandMap = await resolveBrandLabelsByFactoryCode(factoryCodes);
  const { lines: linesWithContainers, totalBoxes } = await attachContainersToLines(flatLines);

  const stnLines = linesWithContainers.map((line) => mapLineToStnFields(line, nameMap, brandMap));

  const allocations = linesWithContainers.map((line) => ({
    vendorProductionFlowId: line.vendorProductionFlowId,
    brand: line.brand,
    quantity: line.qtyInPairs,
  }));

  const totalQty = stnLines.reduce((sum, line) => sum + line.qtyInPairs, 0);
  const stnSerial = await VendorDispatchStnCounter.getNextSerial();

  const doc = await VendorDispatchStockTransferNote.create({
    stnSerial,
    stnDate: new Date(),
    categoryLabel: String(body.categoryLabel ?? '').trim() || 'CORE & COLLECTION MIX',
    fromUnit: 'Unit B7-GF',
    toUnit: 'Unit B8-2F',
    totalQty,
    totalBoxes,
    createdBy: user?.id || user?._id,
    status: VendorDispatchStnStatus.ACTIVE,
    lines: stnLines,
    allocations,
  });

  return doc.toJSON ? doc.toJSON() : doc;
};

/**
 * Query vendor transfer note history with pagination.
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const queryVendorDispatchTransferNotes = async (filter = {}, options = {}) => {
  const mongoFilter = { status: VendorDispatchStnStatus.ACTIVE };

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
        { 'lines.vpoNumber': new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        { 'lines.vendorName': new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      ];
    }
  }

  const queryOptions = {
    sortBy: options.sortBy || 'stnDate:desc',
    limit: options.limit || 20,
    page: options.page || 1,
    populate: 'createdBy',
  };

  const result = await VendorDispatchStockTransferNote.paginate(mongoFilter, queryOptions);
  if (result.results?.length) {
    result.results = await Promise.all(
      result.results.map(async (doc) => {
        const json = doc.toJSON ? doc.toJSON() : doc;
        json.lines = await enrichStnLinesWithInvoiceNumbers(json.lines);
        return json;
      })
    );
  }
  return result;
};

/**
 * Get vendor transfer note by id with enriched brand labels.
 * @param {string} transferNoteId
 * @returns {Promise<Object>}
 */
export const getVendorDispatchTransferNoteById = async (transferNoteId) => {
  const doc = await VendorDispatchStockTransferNote.findById(transferNoteId).populate(
    'createdBy',
    'name email'
  );
  if (!doc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Transfer note not found');
  }
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.lines = await enrichStnLinesWithCatalogBrands(json.lines);
  json.lines = await enrichStnLinesWithInvoiceNumbers(json.lines);
  return json;
};

/**
 * Flat report rows for Excel export.
 * @param {Object} filter
 * @returns {Promise<Array<Object>>}
 */
export const getVendorDispatchTransferNoteReportRows = async (filter = {}) => {
  const mongoFilter = { status: VendorDispatchStnStatus.ACTIVE };

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

  const docs = await VendorDispatchStockTransferNote.find(mongoFilter)
    .sort({ stnDate: -1 })
    .limit(REPORT_MAX_ROWS)
    .populate('createdBy', 'name email')
    .lean();

  const allLines = docs.flatMap((doc) => doc.lines || []);
  const invoiceByFlowId = await resolveInvoiceNumbersByFlowId(allLines);

  const rows = [];
  for (const doc of docs) {
    for (const line of doc.lines || []) {
      const storedInvoice = String(line.invoiceNumber ?? '').trim();
      const flowInvoice = invoiceByFlowId.get(String(line.vendorProductionFlowId ?? '')) || '';
      rows.push({
        stnSerial: doc.stnSerial,
        stnDate: doc.stnDate,
        categoryLabel: doc.categoryLabel,
        totalQty: doc.totalQty,
        totalBoxes: doc.totalBoxes,
        vpoNumber: line.vpoNumber,
        vendorName: line.vendorName,
        invoiceNumber: storedInvoice || flowInvoice,
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
 * Preview pending print lines without creating an STN.
 * @param {Object} filter
 * @returns {Promise<{ lines: Array<Object>, totalQty: number }>}
 */
export const previewVendorDispatchTransferNoteLines = async (filter = {}) => {
  const stnAllocMap = await loadActiveVendorStnAllocationMap();
  const flows = await collectAllPendingVendorFlows(filter);
  const flatLines = flattenPendingLinesFromFlows(flows, stnAllocMap);
  const factoryCodes = flatLines.map((l) => l.factoryCode);
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
      vpoNumber: mapped.vpoNumber,
      vendorName: mapped.vendorName,
    };
  });

  const totalQty = lines.reduce((sum, line) => sum + line.qtyInPairs, 0);
  return { lines, totalQty };
};
