import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { VendorManagement, Product, VendorProductionFlow } from '../../models/index.js';
import ApiError from '../../utils/ApiError.js';

/** Fields loaded when `populate=products` on vendor management */
const VENDOR_PRODUCT_POPULATE_SELECT =
  'name softwareCode internalCode vendorCode factoryCode status category attributes';

/**
 * Whether this product doc matches a single lookup code (same value may live in factoryCode or internalCode).
 * @param {{ factoryCode?: string, internalCode?: string }} doc
 * @param {string} v
 */
function productDocMatchesCode(doc, v) {
  const fc = doc.factoryCode != null ? String(doc.factoryCode).trim() : '';
  const ic = doc.internalCode != null ? String(doc.internalCode).trim() : '';
  return (fc && fc === v) || (ic && ic === v);
}

/**
 * Normalize vendor `products` input to unique `ObjectId`s.
 * Each row must be `{ factoryCode }` and/or `{ internalCode }` / `{ articleCode }` (same article no. may live on either Product field). Raw Mongo product ids are not accepted.
 * @param {unknown[]} [products]
 * @returns {Promise<mongoose.Types.ObjectId[]>}
 */
async function resolveProductsInputToIds(products) {
  if (!products?.length) return [];

  /** @typedef {{ value: string }} Slot */
  /** @type {Slot[]} */
  const slots = [];

  for (const raw of products) {
    const isPlainObject =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw) && !(raw instanceof mongoose.Types.ObjectId);

    if (!isPlainObject) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Each product must be an object with factoryCode, internalCode, or articleCode (raw product ids are not accepted)'
      );
    }

    const fc = raw.factoryCode != null ? String(raw.factoryCode).trim() : '';
    const ic = raw.internalCode != null ? String(raw.internalCode).trim() : '';
    const ac = raw.articleCode != null ? String(raw.articleCode).trim() : '';
    const parts = [fc, ic, ac].filter(Boolean);
    if (parts.length === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Each product object must include factoryCode, internalCode, or articleCode'
      );
    }
    if (new Set(parts).size > 1) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'factoryCode, internalCode, and articleCode must be the same value when more than one is set'
      );
    }
    slots.push({ value: parts[0] });
  }

  const codeVals = [...new Set(slots.map((s) => s.value))];
  /** @type {Map<string, mongoose.Types.ObjectId>} */
  const codeMap = new Map();
  if (codeVals.length) {
    const docs = await Product.find({
      $or: [{ factoryCode: { $in: codeVals } }, { internalCode: { $in: codeVals } }],
    })
      .select('_id factoryCode internalCode')
      .lean();

    for (const v of codeVals) {
      const mids = docs.filter((d) => productDocMatchesCode(d, v)).map((d) => d._id);
      if (mids.length === 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `No product found with factoryCode or internalCode/article number "${v}"`
        );
      }
      if (mids.length > 1) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Multiple products match factoryCode/internalCode "${v}"`
        );
      }
      codeMap.set(v, mids[0]);
    }
  }

  const out = [];
  const seen = new Set();
  for (const s of slots) {
    const oid = codeMap.get(s.value);
    const key = oid.toString();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(oid);
    }
  }
  return out;
}

function normalizeHeader(header) {
  if (!header) return header;
  const h = { ...header };
  if (h.vendorCode != null) h.vendorCode = String(h.vendorCode).trim().toUpperCase();
  if (h.status != null) h.status = String(h.status).toLowerCase();
  return h;
}

function normalizeVendorUpdateBody(updateBody = {}) {
  const wrapper = updateBody.payload || updateBody.paylode || updateBody.data;
  const src = wrapper && typeof wrapper === 'object' ? wrapper : updateBody;

  const headerFields = ['vendorCode', 'vendorName', 'status', 'city', 'state', 'notes', 'address', 'gstin'];
  const flatHeader = {};
  headerFields.forEach((key) => {
    if (src[key] !== undefined) flatHeader[key] = src[key];
  });

  const normalized = {};
  if (src.header && typeof src.header === 'object') {
    normalized.header = src.header;
  } else if (Object.keys(flatHeader).length) {
    normalized.header = flatHeader;
  }

  if (src.contactPersons !== undefined) normalized.contactPersons = src.contactPersons;
  if (src.products !== undefined) normalized.products = src.products;
  return normalized;
}

/**
 * @param {Object} body
 * @returns {Promise<import('mongoose').Document>}
 */
export const createVendorManagement = async (body) => {
  const header = normalizeHeader(body.header);
  if (header?.vendorCode && (await VendorManagement.isVendorCodeTaken(header.vendorCode))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor code already taken');
  }
  if (header?.gstin && (await VendorManagement.isGstinTaken(header.gstin))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'GSTIN already taken');
  }
  const productIds = await resolveProductsInputToIds(body.products);
  return VendorManagement.create({
    header,
    contactPersons: body.contactPersons,
    products: productIds,
  });
};

/**
 * Create many vendor records in order (same rules as single create). Stops on first error.
 * @param {{ vendors: object[] }} body
 */
export const bulkCreateVendorManagements = async (body) => {
  const { vendors } = body;
  if (!Array.isArray(vendors) || vendors.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'vendors array is required');
  }

  const seenVendorCodes = new Set();
  const seenGstins = new Set();
  for (const row of vendors) {
    const h = row.header;
    if (h?.vendorCode != null) {
      const vc = String(h.vendorCode).trim().toUpperCase();
      if (seenVendorCodes.has(vc)) {
        throw new ApiError(httpStatus.BAD_REQUEST, `Duplicate vendorCode in import: ${vc}`);
      }
      seenVendorCodes.add(vc);
    }
    if (h?.gstin != null && String(h.gstin).trim()) {
      const g = String(h.gstin).trim().toUpperCase();
      if (seenGstins.has(g)) {
        throw new ApiError(httpStatus.BAD_REQUEST, `Duplicate GSTIN in import: ${g}`);
      }
      seenGstins.add(g);
    }
  }

  const created = [];
  /* eslint-disable no-await-in-loop, no-restricted-syntax -- sequential creates; fail-fast on duplicate DB keys */
  for (const raw of vendors) {
    const doc = await createVendorManagement(raw);
    const populated = await getVendorManagementById(doc._id, { populateProducts: true });
    created.push(populated ?? doc);
  }
  /* eslint-enable no-await-in-loop, no-restricted-syntax */

  return { created, count: created.length };
};

/**
 * @param {Object} filter
 * @param {Object} options
 * @param {string} [search]
 */
export const queryVendorManagements = async (filter, options, search) => {
  let mongoFilter = {};

  if (filter.vendorName) {
    mongoFilter['header.vendorName'] = { $regex: filter.vendorName, $options: 'i' };
  }
  if (filter.vendorCode) {
    mongoFilter['header.vendorCode'] = String(filter.vendorCode).trim().toUpperCase();
  }
  if (filter.status) {
    mongoFilter['header.status'] = String(filter.status).toLowerCase();
  }
  if (filter.city) {
    mongoFilter['header.city'] = { $regex: filter.city, $options: 'i' };
  }
  if (filter.state) {
    mongoFilter['header.state'] = { $regex: filter.state, $options: 'i' };
  }

  if (search && typeof search === 'string' && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    const searchFilter = {
      $or: [
        { 'header.vendorName': rx },
        { 'header.vendorCode': rx },
        { 'header.city': rx },
        { 'header.state': rx },
        { 'header.gstin': rx },
        { 'header.notes': rx },
        { 'header.address': rx },
      ],
    };
    mongoFilter = Object.keys(mongoFilter).length ? { $and: [mongoFilter, searchFilter] } : searchFilter;
  }

  const paginateOptions = { ...options };
  let populateProductsForList = false;
  if (paginateOptions.populate === 'products') {
    populateProductsForList = true;
    paginateOptions.populate = {
      path: 'products',
      select: VENDOR_PRODUCT_POPULATE_SELECT,
    };
  }

  const result = await VendorManagement.paginate(mongoFilter, paginateOptions);

  if (populateProductsForList && result.results?.length) {
    result.results = result.results.map((row) => {
      const json = row.toJSON();
      json.products = mergeProductAttributesFromSubdocs(row.products, json.products);
      return json;
    });
  }

  return result;
};

/**
 * Merge JSON product rows with raw `attributes` Map from populated subdocs (toJSON can mangle Maps).
 * @param {unknown[]|undefined} subdocs
 * @param {object[]} jsonProducts
 */
function mergeProductAttributesFromSubdocs(subdocs, jsonProducts) {
  if (!Array.isArray(jsonProducts) || !subdocs?.length) return jsonProducts;
  return jsonProducts.map((jp, i) => {
    const sub = subdocs[i];
    if (!sub) return jp;
    const attrs = sub.get ? sub.get('attributes') : sub.attributes;
    const obj =
      attrs instanceof Map
        ? Object.fromEntries(attrs)
        : attrs && typeof attrs === 'object'
          ? { ...attrs }
          : {};
    return { ...jp, attributes: obj };
  });
}

/**
 * @param {import('mongoose').Types.ObjectId|string} id
 * @param {{ populateProducts?: boolean }} [opts]
 */
export const getVendorManagementById = async (id, opts = {}) => {
  let q = VendorManagement.findById(id);
  if (opts.populateProducts) {
    q = q.populate({
      path: 'products',
      select: VENDOR_PRODUCT_POPULATE_SELECT,
    });
  }
  const doc = await q.exec();
  if (!doc) return null;
  if (opts.populateProducts) {
    const json = doc.toJSON();
    json.products = mergeProductAttributesFromSubdocs(doc.products, json.products);
    return json;
  }
  return doc;
};

/**
 * @param {import('mongoose').Types.ObjectId|string} vendorId
 * @param {Object} updateBody
 */
export const updateVendorManagementById = async (vendorId, updateBody) => {
  const normalizedBody = normalizeVendorUpdateBody(updateBody);
  const vendor = await VendorManagement.findById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor management record not found');
  }

  if (normalizedBody.header) {
    const nextHeader = normalizeHeader({ ...vendor.get('header'), ...normalizedBody.header });
    if (nextHeader.vendorCode && (await VendorManagement.isVendorCodeTaken(nextHeader.vendorCode, vendorId))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Vendor code already taken');
    }
    if (nextHeader.gstin && (await VendorManagement.isGstinTaken(nextHeader.gstin, vendorId))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'GSTIN already taken');
    }
    vendor.set('header', nextHeader);
  }

  if (normalizedBody.contactPersons !== undefined) {
    vendor.set('contactPersons', normalizedBody.contactPersons);
  }

  if (normalizedBody.products !== undefined) {
    const productIds = await resolveProductsInputToIds(normalizedBody.products);
    vendor.set('products', productIds);
  }

  await vendor.save();
  return vendor;
};

/**
 * @param {import('mongoose').Types.ObjectId|string} vendorId
 */
export const deleteVendorManagementById = async (vendorId) => {
  const vendor = await VendorManagement.findById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor management record not found');
  }
  await vendor.deleteOne();
  return vendor;
};

/**
 * Add product ids to vendor (deduped via $addToSet).
 * @param {import('mongoose').Types.ObjectId|string} vendorId
 * @param {unknown[]} productInputs — `{ factoryCode }` / `{ internalCode | articleCode }` per row
 */
export const addProductsToVendor = async (vendorId, productInputs) => {
  const vendor = await VendorManagement.findById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor management record not found');
  }
  const oidList = await resolveProductsInputToIds(productInputs);
  await VendorManagement.updateOne({ _id: vendorId }, { $addToSet: { products: { $each: oidList } } });
  return getVendorManagementById(vendorId, { populateProducts: true });
};

/**
 * Remove product ids from vendor.
 * @param {import('mongoose').Types.ObjectId|string} vendorId
 * @param {string[]} productIds
 */
export const removeProductsFromVendor = async (vendorId, productIds) => {
  const vendor = await VendorManagement.findById(vendorId);
  if (!vendor) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor management record not found');
  }
  const oidList = productIds.map((id) => new mongoose.Types.ObjectId(id));
  await VendorManagement.updateOne({ _id: vendorId }, { $pull: { products: { $in: oidList } } });
  return getVendorManagementById(vendorId, { populateProducts: true });
};

/**
 * Query vendor production flow rows.
 * @param {Object} filter
 * @param {Object} options
 * @param {string} [search]
 */
export const queryVendorProductionFlows = async (filter, options, search) => {
  const mongoFilter = {};

  if (filter.vendor) mongoFilter.vendor = new mongoose.Types.ObjectId(filter.vendor);
  if (filter.vendorPurchaseOrder) mongoFilter.vendorPurchaseOrder = new mongoose.Types.ObjectId(filter.vendorPurchaseOrder);
  if (filter.product) mongoFilter.product = new mongoose.Types.ObjectId(filter.product);
  /**
   * `currentFloorKey` is advanced when quantity is transferred to the next floor, but work can
   * still remain on the previous floor (e.g. M2/M4 on secondary). Listing "secondary checking"
   * should include those rows, not only rows whose cursor is still `secondaryChecking`.
   */
  if (filter.currentFloorKey === 'secondaryChecking') {
    mongoFilter.$or = [
      { currentFloorKey: 'secondaryChecking' },
      { 'floorQuantities.secondaryChecking.remaining': { $gt: 0 } },
    ];
  } else if (filter.currentFloorKey === 'finalChecking') {
    mongoFilter.$or = [
      { currentFloorKey: 'finalChecking' },
      { 'floorQuantities.finalChecking.remaining': { $gt: 0 } },
    ];
  } else if (filter.currentFloorKey) {
    mongoFilter.currentFloorKey = String(filter.currentFloorKey);
  }

  if (search && typeof search === 'string' && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    mongoFilter.referenceCode = rx;
  }

  const paginateOptions = {
    ...options,
    populate: [
      { path: 'vendor', select: 'header.vendorName header.vendorCode' },
      { path: 'vendorPurchaseOrder', select: 'vpoNumber vendorName currentStatus' },
      { path: 'product', select: 'name softwareCode internalCode status' },
    ],
  };

  return VendorProductionFlow.paginate(mongoFilter, paginateOptions);
};

/**
 * Single vendor production flow by id (same populate shape as list rows).
 * @param {import('mongoose').Types.ObjectId|string} flowId
 */
export const getVendorProductionFlowById = async (flowId) => {
  const doc = await VendorProductionFlow.findById(flowId)
    .populate('vendor', 'header.vendorName header.vendorCode')
    .populate('vendorPurchaseOrder', 'vpoNumber vendorName currentStatus')
    .populate('product', 'name softwareCode internalCode status');
  if (!doc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vendor production flow not found');
  }
  return doc;
};
