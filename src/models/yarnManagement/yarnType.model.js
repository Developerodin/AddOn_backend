import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

const yarnTypeDetailSchema = mongoose.Schema(
  {
    subtype: {
      type: String,
      required: true,
      trim: true,
    },
    countSize: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'CountSize',
      default: [],
    },
    tearWeight: {
      type: String,
      trim: true,
    }
  },
  { _id: false }
);

const yarnTypeSchema = mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      auto: true,
    },
    yarnName:{
      type: String,
      required: false,
      trim: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    details: {
      type: [yarnTypeDetailSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  { timestamps: true }
);

// Add plugins for converting MongoDB document to JSON and pagination support
yarnTypeSchema.plugin(toJSON);
yarnTypeSchema.plugin(paginate);

/**
 * Auto-generate yarnName from name, subtype, and countSize
 */
yarnTypeSchema.pre('save', async function (next) {
  // Only generate if yarnName is not already set
  if (this.yarnName) {
    return next();
  }

  // Generate yarnName from name and first detail
  if (this.name && this.details && this.details.length > 0) {
    const detail = this.details[0];
    const parts = [this.name];

    // Add subtype if exists
    if (detail.subtype) {
      parts.push(detail.subtype);
    }

    // Add countSize names if exists
    if (detail.countSize && detail.countSize.length > 0) {
      // Check if populated or need to fetch
      if (typeof detail.countSize[0] === 'object' && detail.countSize[0].name) {
        // Already populated
        const countSizeNames = detail.countSize.map(cs => cs.name).join('-');
        parts.push(countSizeNames);
      } else {
        // Need to fetch from database
        const CountSize = mongoose.model('CountSize');
        const countSizes = await CountSize.find({ _id: { $in: detail.countSize } });
        if (countSizes.length > 0) {
          const countSizeNames = countSizes.map(cs => cs.name).join('-');
          parts.push(countSizeNames);
        }
      }
    }

    this.yarnName = parts.join('-');
  } else if (this.name) {
    // Fallback to just name if no details
    this.yarnName = this.name;
  }

  next();
});

/**
 * Check if yarn type name is taken
 * @param {string} name - The yarn type name
 * @param {ObjectId} [excludeYarnTypeId] - The id of the yarn type to be excluded
 * @returns {Promise<boolean>}
 */
yarnTypeSchema.statics.isNameTaken = async function (name, excludeYarnTypeId) {
  const yarnType = await this.findOne({ name, _id: { $ne: excludeYarnTypeId } });
  return !!yarnType;
};

/**
 * Check if yarn name is taken
 * @param {string} yarnName - The yarn name
 * @param {ObjectId} [excludeYarnTypeId] - The id of the yarn type to be excluded
 * @returns {Promise<boolean>}
 */
yarnTypeSchema.statics.isYarnNameTaken = async function (yarnName, excludeYarnTypeId) {
  if (!yarnName) return false;
  const yarnType = await this.findOne({ yarnName, _id: { $ne: excludeYarnTypeId } });
  return !!yarnType;
};

/**
 * @typedef YarnType
 */
const YarnType = mongoose.model('YarnType', yarnTypeSchema);

export default YarnType;

