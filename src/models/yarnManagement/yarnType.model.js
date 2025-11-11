import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import CountSize from './countSize.model.js';

// Embedded CountSize schema - stores entire CountSize object
const embeddedCountSizeSchema = mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'deleted'],
      default: 'active',
    },
  },
  { _id: false, timestamps: false }
);

const yarnTypeDetailSchema = mongoose.Schema(
  {
    subtype: {
      type: String,
      required: true,
      trim: true,
    },
    countSize: {
      type: [embeddedCountSizeSchema],
      default: [],
    },
    tearWeight: {
      type: String,
      trim: true,
    }
  },
  { _id: true }
);

const yarnTypeSchema = mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      auto: true,
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

// Pre-save hook: Automatically converts countSize IDs to embedded objects
// Frontend can send just IDs, and this hook will fetch and store full CountSize data
yarnTypeSchema.pre('save', async function (next) {
  if (this.isModified('details')) {
    for (const detail of this.details) {
      if (!detail.countSize || detail.countSize.length === 0) {
        detail.countSize = [];
        continue;
      }

      // Check if countSize contains IDs (strings or ObjectIds) that need conversion
      const firstItem = detail.countSize[0];
      const needsConversion = 
        mongoose.Types.ObjectId.isValid(firstItem) || 
        (typeof firstItem === 'string' && mongoose.Types.ObjectId.isValid(firstItem)) ||
        (firstItem && typeof firstItem === 'object' && !firstItem.name);

      if (needsConversion) {
        try {
          // Convert all IDs to ObjectIds
          const countSizeIds = detail.countSize.map(id => {
            if (mongoose.Types.ObjectId.isValid(id)) {
              return id;
            }
            if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) {
              return new mongoose.Types.ObjectId(id);
            }
            // If it's already an object with _id, use that
            if (id && typeof id === 'object' && id._id) {
              return mongoose.Types.ObjectId.isValid(id._id) ? id._id : new mongoose.Types.ObjectId(id._id);
            }
            return id;
          });

          // Fetch CountSize documents from database
          const countSizes = await CountSize.find({ _id: { $in: countSizeIds } });
          
          // Create a map: ID -> CountSize object
          const countSizeMap = new Map();
          countSizes.forEach(cs => {
            countSizeMap.set(cs._id.toString(), {
              _id: cs._id,
              name: cs.name,
              status: cs.status,
            });
          });

          // Convert IDs to embedded objects
          detail.countSize = countSizeIds.map((id) => {
            const idStr = id.toString();
            // If found in database, use that data; otherwise mark as deleted
            if (countSizeMap.has(idStr)) {
              return countSizeMap.get(idStr);
            }
            // CountSize was deleted, store with 'deleted' status
            return {
              _id: id,
              name: 'Unknown',
              status: 'deleted',
            };
          });
        } catch (error) {
          console.error('Error converting countSize IDs to embedded objects:', error);
          // On error, convert to placeholder objects
          detail.countSize = detail.countSize.map(id => {
            const objId = mongoose.Types.ObjectId.isValid(id) 
              ? id 
              : (typeof id === 'string' ? new mongoose.Types.ObjectId(id) : (id._id || id));
            return {
              _id: objId,
              name: 'Unknown',
              status: 'deleted',
            };
          });
        }
      }
      // If already embedded objects (has name property), no conversion needed
    }
  }
  next();
});

// Add plugins for converting MongoDB document to JSON and pagination support
yarnTypeSchema.plugin(toJSON);
yarnTypeSchema.plugin(paginate);

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
 * @typedef YarnType
 */
const YarnType = mongoose.model('YarnType', yarnTypeSchema);

export default YarnType;

