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
  { _id: true, timestamps: false }
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

// Post-find hook: Convert ObjectIds to embedded objects when reading (for backward compatibility)
yarnTypeSchema.post(['find', 'findOne', 'findOneAndUpdate'], async function (docs) {
  if (!docs) return;
  
  const documents = Array.isArray(docs) ? docs : [docs];
  
  for (const doc of documents) {
    if (!doc || !doc.details) continue;
    
    for (const detail of doc.details) {
      if (!detail.countSize || detail.countSize.length === 0) continue;
      
      const firstItem = detail.countSize[0];
      // Check if it's still an ObjectId (old data format)
      const isObjectId = mongoose.Types.ObjectId.isValid(firstItem) || 
                        (firstItem && firstItem._bsontype === 'ObjectID') ||
                        (firstItem && typeof firstItem === 'object' && !firstItem.name);
      
      if (isObjectId) {
        try {
          const countSizeIds = detail.countSize.map(cs => {
            // Handle ObjectId buffer format from MongoDB
            if (cs && cs._bsontype === 'ObjectID') {
              if (cs.id && cs.id.data) {
                // Buffer format: { _bsontype: 'ObjectID', id: { type: 'Buffer', data: [...] } }
                return new mongoose.Types.ObjectId(Buffer.from(cs.id.data));
              }
              if (cs.id) {
                return new mongoose.Types.ObjectId(cs.id);
              }
            }
            // Handle regular ObjectId
            if (mongoose.Types.ObjectId.isValid(cs)) {
              return cs;
            }
            // Handle string ID
            if (typeof cs === 'string' && mongoose.Types.ObjectId.isValid(cs)) {
              return new mongoose.Types.ObjectId(cs);
            }
            // Already an embedded object
            if (cs && typeof cs === 'object' && cs._id) {
              return mongoose.Types.ObjectId.isValid(cs._id) ? cs._id : new mongoose.Types.ObjectId(cs._id);
            }
            return cs;
          }).filter(id => id && mongoose.Types.ObjectId.isValid(id));
          
          const countSizes = await CountSize.find({ _id: { $in: countSizeIds } });
          const countSizeMap = new Map();
          countSizes.forEach(cs => {
            countSizeMap.set(cs._id.toString(), {
              _id: cs._id,
              name: cs.name,
              status: cs.status,
            });
          });
          
          detail.countSize = countSizeIds.map((id) => {
            const idStr = id.toString();
            return countSizeMap.get(idStr) || {
              _id: id,
              name: 'Unknown',
              status: 'deleted',
            };
          });
        } catch (error) {
          console.error('Error converting countSize in post-find hook:', error);
        }
      }
    }
  }
});

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

// Wrap the plugin's transform to add our custom countSize formatting
const originalToJSON = yarnTypeSchema.options.toJSON;
if (originalToJSON && originalToJSON.transform) {
  const pluginTransform = originalToJSON.transform;
  yarnTypeSchema.set('toJSON', {
    ...originalToJSON,
    transform(doc, ret, options) {
      // Call plugin's transform first
      let result = pluginTransform(doc, ret, options);
      
      // Use result if plugin returned something, otherwise use modified ret
      const finalRet = result !== undefined ? result : ret;
      
      // Ensure finalRet is defined
      if (!finalRet) {
        return {};
      }
      
      // Format embedded countSize objects
      if (finalRet.details && Array.isArray(finalRet.details)) {
        finalRet.details = finalRet.details.map(detail => {
          if (detail && detail.countSize && Array.isArray(detail.countSize)) {
            detail.countSize = detail.countSize.map(cs => {
              // Format embedded object: convert _id to id
              if (cs && typeof cs === 'object' && cs.name) {
                return {
                  id: cs._id ? cs._id.toString() : (cs.id || null),
                  name: cs.name,
                  status: cs.status || 'active'
                };
              }
              return cs;
            });
          }
          return detail;
        });
      }
      
      return finalRet;
    }
  });
}

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

