import mongoose from 'mongoose';
import validator from 'validator';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

const PHONE_REGEX = /^\+?[\d\s\-()]{10,15}$/;

/**
 * Vendor form header (modal top section): codes, identity, status, location, notes.
 */
const vendorHeaderSchema = new mongoose.Schema(
  {
    vendorCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    vendorName: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['active', 'inactive'],
      lowercase: true,
    },
    city: {
      type: String,
      trim: true,
    },
    state: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    gstin: {
      type: String,
      trim: true,
      uppercase: true,
      validate(value) {
        if (value && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(value)) {
          throw new Error('Invalid GSTIN format');
        }
      },
    },
  },
  { _id: false }
);

/**
 * One row in the contact-persons table. Only the first row is required to be complete (validated on parent).
 */
const contactPersonSchema = new mongoose.Schema(
  {
    contactName: {
      type: String,
      trim: true,
      default: '',
    },
    phone: {
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
  },
  { _id: true }
);

const vendorManagementSchema = new mongoose.Schema(
  {
    header: {
      type: vendorHeaderSchema,
      required: true,
    },
    contactPersons: {
      type: [contactPersonSchema],
      default: [],
    },
    /** Array of Product `_id` values the user assigns to this vendor */
    products: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
      default: [],
      validate: {
        validator(value) {
          if (!value?.length) return true;
          const ids = value.map((id) => id.toString());
          return new Set(ids).size === ids.length;
        },
        message: 'Duplicate product ids are not allowed',
      },
    },
  },
  { timestamps: true }
);

vendorManagementSchema.pre('validate', function (next) {
  const persons = this.contactPersons || [];
  if (persons.length < 1) {
    this.invalidate('contactPersons', 'At least one contact row is required');
    return next();
  }

  const first = persons[0];
  const name = first.contactName?.trim();
  const phone = first.phone?.trim();

  if (!name) {
    this.invalidate('contactPersons.0.contactName', 'Contact name is required for the primary contact');
  }
  if (!phone) {
    this.invalidate('contactPersons.0.phone', 'Phone is required for the primary contact');
  } else if (!PHONE_REGEX.test(phone)) {
    this.invalidate('contactPersons.0.phone', 'Invalid phone number format');
  }

  persons.forEach((row, i) => {
    const em = row.email?.trim();
    if (em && !validator.isEmail(em)) {
      this.invalidate(`contactPersons.${i}.email`, 'Invalid email');
    }
    const p = row.phone?.trim();
    if (i > 0 && p && !PHONE_REGEX.test(p)) {
      this.invalidate(`contactPersons.${i}.phone`, 'Invalid phone number format');
    }
  });

  next();
});

vendorManagementSchema.plugin(toJSON);
vendorManagementSchema.plugin(paginate);

vendorManagementSchema.index({ 'header.vendorCode': 1 }, { unique: true, sparse: true });
vendorManagementSchema.index({ products: 1 });

vendorManagementSchema.statics.isVendorCodeTaken = async function (vendorCode, excludeId) {
  if (!vendorCode) return false;
  const doc = await this.findOne({
    'header.vendorCode': String(vendorCode).trim().toUpperCase(),
    _id: { $ne: excludeId },
  });
  return !!doc;
};

vendorManagementSchema.statics.isGstinTaken = async function (gstin, excludeId) {
  if (!gstin) return false;
  const normalized = String(gstin).trim().toUpperCase();
  const doc = await this.findOne({
    'header.gstin': normalized,
    _id: { $ne: excludeId },
  });
  return !!doc;
};

const VendorManagement = mongoose.model('VendorManagement', vendorManagementSchema);

export default VendorManagement;
export { vendorHeaderSchema, contactPersonSchema };
