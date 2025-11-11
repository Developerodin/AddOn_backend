import mongoose from 'mongoose';
import validator from 'validator';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

const yarnDetailsSchema = mongoose.Schema(
  {
    yarnType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnType',
      required: true,
    },
    yarnsubtype: {
      type: String,
      trim: true,
    },
    color: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Color',
      required: true,
    },
    shadeNumber: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const supplierSchema = mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      auto: true,
    },
    brandName: {
      type: String,
      required: true,
      trim: true,
    },
    contactPersonName: {
      type: String,
      required: true,
      trim: true,
    },
    contactNumber: {
      type: String,
      required: true,
      trim: true,
      validate(value) {
        if (!/^\+?[\d\s\-\(\)]{10,15}$/.test(value)) {
          throw new Error('Invalid contact number format');
        }
      },
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      validate(value) {
        if (!validator.isEmail(value)) {
          throw new Error('Invalid email');
        }
      },
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    gstNo: {
      type: String,
      trim: true,
      uppercase: true,
      validate(value) {
        if (value && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(value)) {
          throw new Error('Invalid GST number format');
        }
      },
    },
    yarnDetails: {
      type: [yarnDetailsSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended'],
      default: 'active',
    },
  },
  { timestamps: true }
);

// Add plugins for converting MongoDB document to JSON and pagination support
supplierSchema.plugin(toJSON);
supplierSchema.plugin(paginate);

/**
 * Check if email is taken
 * @param {string} email - The supplier's email
 * @param {ObjectId} [excludeSupplierId] - The id of the supplier to be excluded
 * @returns {Promise<boolean>}
 */
supplierSchema.statics.isEmailTaken = async function (email, excludeSupplierId) {
  const supplier = await this.findOne({ email, _id: { $ne: excludeSupplierId } });
  return !!supplier;
};

/**
 * Check if GST number is taken
 * @param {string} gstNo - The supplier's GST number
 * @param {ObjectId} [excludeSupplierId] - The id of the supplier to be excluded
 * @returns {Promise<boolean>}
 */
supplierSchema.statics.isGstNoTaken = async function (gstNo, excludeSupplierId) {
  if (!gstNo) return false;
  const supplier = await this.findOne({ gstNo, _id: { $ne: excludeSupplierId } });
  return !!supplier;
};

/**
 * @typedef Supplier
 */
const Supplier = mongoose.model('Supplier', supplierSchema);

export default Supplier;

