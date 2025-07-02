import mongoose from 'mongoose';
import validator from 'validator';
import toJSON from './plugins/toJSON.plugin.js';
import paginate from './plugins/paginate.plugin.js';

const storeSchema = mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      auto: true,
    },
    storeId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    storeName: {
      type: String,
      required: true,
      trim: true,
    },
    city: {
      type: String,
      required: true,
      trim: true,
    },
    addressLine1: {
      type: String,
      required: true,
      trim: true,
    },
    addressLine2: {
      type: String,
      trim: true,
      default: '',
    },
    storeNumber: {
      type: String,
      required: true,
      trim: true,
    },
    pincode: {
      type: String,
      required: true,
      trim: true,
      validate(value) {
        if (!/^\d{6}$/.test(value)) {
          throw new Error('Pincode must be exactly 6 digits');
        }
      },
    },
    contactPerson: {
      type: String,
      required: true,
      trim: true,
    },
    contactEmail: {
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
    contactPhone: {
      type: String,
      required: true,
      trim: true,
      validate(value) {
        if (!/^\+?[\d\s\-\(\)]{10,15}$/.test(value)) {
          throw new Error('Invalid phone number format');
        }
      },
    },
    creditRating: {
      type: String,
      enum: ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'],
      default: 'C',
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Add plugins for converting MongoDB document to JSON and pagination support
storeSchema.plugin(toJSON);
storeSchema.plugin(paginate);

/**
 * Check if store ID is taken
 * @param {string} storeId - The store ID
 * @param {ObjectId} [excludeStoreId] - The id of the store to be excluded
 * @returns {Promise<boolean>}
 */
storeSchema.statics.isStoreIdTaken = async function (storeId, excludeStoreId) {
  const store = await this.findOne({ storeId, _id: { $ne: excludeStoreId } });
  return !!store;
};

/**
 * Check if contact email is taken
 * @param {string} contactEmail - The store's contact email
 * @param {ObjectId} [excludeStoreId] - The id of the store to be excluded
 * @returns {Promise<boolean>}
 */
storeSchema.statics.isContactEmailTaken = async function (contactEmail, excludeStoreId) {
  const store = await this.findOne({ contactEmail, _id: { $ne: excludeStoreId } });
  return !!store;
};

/**
 * @typedef Store
 */
const Store = mongoose.model('Store', storeSchema);

export default Store; 