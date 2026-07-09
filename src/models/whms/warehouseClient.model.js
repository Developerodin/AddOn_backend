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
 * Build combined legacy name/contact from split fields.
 * @param {string} name
 * @param {string} contact
 */
const buildCombinedNameContact = (name, contact) => {
  const n = String(name ?? '').trim();
  const c = String(contact ?? '').trim();
  if (n && c) return `${n} / ${c}`;
  return n || c;
};

/**
 * Sync split SM/ABM fields into legacy combined fields on storeProfile.
 * @param {Record<string, unknown>} profile
 */
const syncStoreProfileCombinedFields = (profile) => {
  if (!profile || typeof profile !== 'object') return;
  const sm = buildCombinedNameContact(profile.smName, profile.smContact);
  if (sm) profile.smNameAndContact = sm;
  const abm = buildCombinedNameContact(profile.abmName, profile.abmContact);
  if (abm) profile.abmNameAndContact = abm;
};

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
    pincode: { type: String, trim: true, default: '' },
    gst: { type: String, trim: true, default: '' },
    storeLandlineNo: { type: String, trim: true, default: '' },
    smName: { type: String, trim: true, default: '' },
    smContact: { type: String, trim: true, default: '' },
    /** Legacy combined — kept in sync from smName + smContact */
    smNameAndContact: { type: String, trim: true, default: '' },
    storeMailId: { type: String, trim: true, lowercase: true, default: '' },
    abmName: { type: String, trim: true, default: '' },
    abmContact: { type: String, trim: true, default: '' },
    /** Legacy combined — kept in sync from abmName + abmContact */
    abmNameAndContact: { type: String, trim: true, default: '' },
    abmMailId: { type: String, trim: true, lowercase: true, default: '' },
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
    /** SAP code (Trade / Dept / Ecom) */
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

warehouseClientSchema.index({ retailerName: 1 });
warehouseClientSchema.index({ type: 1, city: 1 });
warehouseClientSchema.index({ gstin: 1 });

warehouseClientSchema.pre('validate', function warehouseClientStoreProfileSync(next) {
  if (this.type !== WarehouseClientType.STORE) {
    this.storeProfile = undefined;
  } else if (this.storeProfile == null) {
    this.storeProfile = {};
  } else {
    syncStoreProfileCombinedFields(this.storeProfile);
  }
  next();
});

warehouseClientSchema.pre('save', function warehouseClientStoreProfileSaveSync(next) {
  if (this.type === WarehouseClientType.STORE && this.storeProfile) {
    syncStoreProfileCombinedFields(this.storeProfile);
    this.markModified('storeProfile');
  }
  next();
});

/**
 * Store clients: API JSON omits wholesale root fields (retailer, gstin, …).
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
