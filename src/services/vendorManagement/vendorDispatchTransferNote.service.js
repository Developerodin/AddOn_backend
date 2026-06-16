import httpStatus from 'http-status';
import mongoose from 'mongoose';
import VendorDispatchStockTransferNote, {
  VendorDispatchStnCounter,
  VendorDispatchStnStatus,
} from '../../models/vendorManagement/vendorDispatchStockTransferNote.model.js';
import { ContainersMaster } from '../../models/production/index.js';
import Product from '../../models/product.model.js';
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
    const articleNumber =
      typeof product === 'object' && product?.factoryCode
        ? String(product.factoryCode).trim()
        : '';

    for (const row of pendingRows) {
      const qty = Number(row.transferred ?? 0);
      if (qty <= 0) continue;
      lines.push({
        vendorProductionFlowId: flowId,
        vendorPurchaseOrderId: flow.vendorPurchaseOrder?._id || flow.vendorPurchaseOrder || null,
        vpoNumber: flow.vendorPurchaseOrder?.vpoNumber || '',
        vendorName: flow.vendor?.header?.vendorName || '',
        articleNumber,
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
  const fcKey = String(line.articleNumber ?? '').trim().toLowerCase();
  const brandLabel = displayBrandForLine(line.brand, line.articleNumber, brandMap);
  return {
    vendorProductionFlowId: line.vendorProductionFlowId,
    vendorPurchaseOrderId: line.vendorPurchaseOrderId,
    vpoNumber: line.vpoNumber || '',
    vendorName: line.vendorName || '',
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
 * Re-resolve brand labels from catalog for stored lines.
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

  const factoryCodes = flatLines.map((l) => l.articleNumber);
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

  return VendorDispatchStockTransferNote.paginate(mongoFilter, queryOptions);
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

  const rows = [];
  for (const doc of docs) {
    for (const line of doc.lines || []) {
      rows.push({
        stnSerial: doc.stnSerial,
        stnDate: doc.stnDate,
        categoryLabel: doc.categoryLabel,
        totalQty: doc.totalQty,
        totalBoxes: doc.totalBoxes,
        vpoNumber: line.vpoNumber,
        vendorName: line.vendorName,
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
      vpoNumber: mapped.vpoNumber,
      vendorName: mapped.vendorName,
    };
  });

  const totalQty = lines.reduce((sum, line) => sum + line.qtyInPairs, 0);
  return { lines, totalQty };
};
