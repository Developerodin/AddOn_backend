import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

/** WHMS client / outlet classification */
export const WarehouseClientType = {
  STORE: 'Store',
  TRADE: 'Trade',
  DEPARTMENTAL: 'Departmental',
  ECOM: 'Ecom',
};

const CLIENT_TYPES = Object.values(WarehouseClientType);

/**
 * Extra attributes when {@link WarehouseClientType.STORE} — Bill-to / store master style fields.
 * Other client types leave this undefined.
 */
const warehouseClientStoreProfileSchema = mongoose.Schema(
  {
    billCode: { type: String, trim: true, default: '' },
    sapCode: { type: String, trim: true, default: '' },
    retekCode: { type: String, trim: true, default: '' },
    classification: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    brand: { type: String, trim: true, default: '' },
    /** Brand - Sub */
    brandSub: { type: String, trim: true, default: '' },
    openingDate: { type: Date, default: null },
    address: { type: String, trim: true, default: '' },
    gst: { type: String, trim: true, default: '' },
    storeLandlineNo: { type: String, trim: true, default: '' },
    /** SM Name & Contact No. */
    smNameAndContact: { type: String, trim: true, default: '' },
    storeMailId: { type: String, trim: true, lowercase: true, default: '' },
  },
  { _id: false }
);

const warehouseClientSchema = mongoose.Schema(
  {
    /** Display / import row serial (optional; assign from sheet or auto) */
    slNo: {
      type: Number,
      min: 0,
      default: null,
    },
    distributorName: {
      type: String,
      trim: true,
      default: '',
    },
    /** ParentKey - Code */
    parentKeyCode: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    retailerName: {
      type: String,
      trim: true,
      default: '',
    },
    type: {
      type: String,
      enum: CLIENT_TYPES,
      required: true,
      index: true,
    },
    contactPerson: {
      type: String,
      trim: true,
      default: '',
    },
    mobilePhone: {
      type: String,
      trim: true,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    locality: {
      type: String,
      trim: true,
      default: '',
    },
    city: {
      type: String,
      trim: true,
      default: '',
    },
    zipCode: {
      type: String,
      trim: true,
      default: '',
    },
    state: {
      type: String,
      trim: true,
      default: '',
    },
    gstin: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    phone1: {
      type: String,
      trim: true,
      default: '',
    },
    rsm: { type: String, trim: true, default: '' },
    asm: { type: String, trim: true, default: '' },
    se: { type: String, trim: true, default: '' },
    dso: { type: String, trim: true, default: '' },
    outlet: {
      type: String,
      trim: true,
      default: '',
    },
    /** Populated when `type` is Store */
    storeProfile: {
      type: warehouseClientStoreProfileSchema,
      default: undefined,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
    remarks: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true }
);

warehouseClientSchema.index({ distributorName: 1, retailerName: 1 });
warehouseClientSchema.index({ type: 1, city: 1 });
warehouseClientSchema.index({ gstin: 1 });

warehouseClientSchema.pre('validate', function warehouseClientStoreProfileSync(next) {
  if (this.type !== WarehouseClientType.STORE) {
    this.storeProfile = undefined;
  } else if (this.storeProfile == null) {
    this.storeProfile = {};
  }
  next();
});

/**
 * Store clients: API JSON omits wholesale root fields (distributor, retailer, gstin, …).
 * Only store-relevant data is returned after the global toJSON plugin runs (id, timestamps).
 */
warehouseClientSchema.set('toJSON', {
  transform(_doc, ret) {
    if (ret.type !== WarehouseClientType.STORE) {
      return ret;
    }
    const profile = ret.storeProfile;
    const storeProfilePlain =
      profile == null
        ? {}
        : typeof profile.toObject === 'function'
          ? profile.toObject()
          : { ...profile };

    return {
      id: ret.id,
      type: ret.type,
      storeProfile: storeProfilePlain,
      status: ret.status,
      remarks: ret.remarks,
      slNo: ret.slNo,
      createdAt: ret.createdAt,
      updatedAt: ret.updatedAt,
    };
  },
});

warehouseClientSchema.plugin(toJSON);
warehouseClientSchema.plugin(paginate);

const WarehouseClient = mongoose.model('WarehouseClient', warehouseClientSchema, 'warehouse_clients');

export default WarehouseClient;
