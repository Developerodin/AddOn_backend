import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import CountSize from './countSize.model.js';
import Color from './color.model.js';
import YarnType from './yarnType.model.js';

const yarnCatalogSchema = mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      auto: true,
    },
    yarnName: {
      type: String,
      required: false,
      trim: true,
    },
    yarnType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnType',
      required: true,
    },
    yarnSubtype: {
        type: mongoose.Schema.Types.ObjectId,
        required: false,
    },
    countSize: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CountSize',
      required: true,
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
    },
    colorFamily: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Color',
      required: false,
    },
    pantonShade: {
      type: String,
      trim: true,
    },
    pantonName: {
      type: String,
      trim: true,
    },
    season: {
      type: String,
      trim: true,
    },
    gst: {
      type: Number,
      min: 0,
      max: 100,
    },
    remark: {
      type: String,
      trim: true,
    },
    hsnCode: {
      type: String,
      trim: true,
      uppercase: true,
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
yarnCatalogSchema.plugin(toJSON);
yarnCatalogSchema.plugin(paginate);

/**
 * Pre-save hook to auto-generate yarnName in format: count/size-colour-type/sub-type
 */
yarnCatalogSchema.pre('save', async function (next) {
  // Only generate if yarnName is not provided or if relevant fields have changed
  if (!this.yarnName || this.isModified('countSize') || this.isModified('colorFamily') || 
      this.isModified('yarnType') || this.isModified('yarnSubtype')) {
    
    try {
      const parts = [];
      
      // Get countSize name
      if (this.countSize) {
        const countSizeDoc = await CountSize.findById(this.countSize);
        if (countSizeDoc) {
          parts.push(countSizeDoc.name);
        }
      }
      
      // Get colorFamily name (optional)
      if (this.colorFamily) {
        const colorDoc = await Color.findById(this.colorFamily);
        if (colorDoc) {
          parts.push(colorDoc.name);
        }
      }
      
      // Get yarnType name
      if (this.yarnType) {
        const yarnTypeDoc = await YarnType.findById(this.yarnType);
        if (yarnTypeDoc) {
          let typePart = yarnTypeDoc.name;
          
          // Handle yarnSubtype - check if it's an ObjectId that references a detail
          if (this.yarnSubtype) {
            // Check if yarnSubtype matches any detail _id in yarnType
            const subtypeDetail = yarnTypeDoc.details.find(
              detail => detail._id && detail._id.toString() === this.yarnSubtype.toString()
            );
            if (subtypeDetail && subtypeDetail.subtype) {
              typePart += `/${subtypeDetail.subtype}`;
            }
          }
          
          parts.push(typePart);
        }
      }
      
      // Generate yarnName: count/size-colour-type/sub-type
      if (parts.length > 0) {
        this.yarnName = parts.join('-');
      }
    } catch (error) {
      return next(error);
    }
  }
  
  next();
});

/**
 * Check if yarn name is taken
 * @param {string} yarnName - The yarn catalog name
 * @param {ObjectId} [excludeYarnCatalogId] - The id of the yarn catalog to be excluded
 * @returns {Promise<boolean>}
 */
yarnCatalogSchema.statics.isYarnNameTaken = async function (yarnName, excludeYarnCatalogId) {
  const yarnCatalog = await this.findOne({ yarnName, _id: { $ne: excludeYarnCatalogId } });
  return !!yarnCatalog;
};

/**
 * @typedef YarnCatalog
 */
const YarnCatalog = mongoose.model('YarnCatalog', yarnCatalogSchema);

export default YarnCatalog;

