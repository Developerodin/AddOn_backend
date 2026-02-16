import mongoose from 'mongoose';
import validator from 'validator';
import { toJSON, paginate } from './plugins/index.js';

const vendorSchema = mongoose.Schema(
  {
    vendorName: {
      type: String,
      required: true,
      trim: true,
    },
    vendorCode: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
      unique: true,
    },
    contactPerson: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      validate(value) {
        if (!/^\+?[\d\s\-\(\)]{10,15}$/.test(value)) {
          throw new Error('Invalid phone number format');
        }
      },
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
      validate(value) {
        if (value && !validator.isEmail(value)) {
          throw new Error('Invalid email');
        }
      },
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
    remarks: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      lowercase: true,
    },
  },
  { timestamps: true }
);

vendorSchema.plugin(toJSON);
vendorSchema.plugin(paginate);

vendorSchema.statics.isVendorCodeTaken = async function (vendorCode, excludeVendorId) {
  if (!vendorCode) return false;
  const vendor = await this.findOne({
    vendorCode: vendorCode.toUpperCase(),
    _id: { $ne: excludeVendorId },
  });
  return !!vendor;
};

vendorSchema.statics.isEmailTaken = async function (email, excludeVendorId) {
  if (!email) return false;
  const vendor = await this.findOne({
    email: email.toLowerCase(),
    _id: { $ne: excludeVendorId },
  });
  return !!vendor;
};

const Vendor = mongoose.model('Vendor', vendorSchema);

export default Vendor;
