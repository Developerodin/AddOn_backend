import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import CountSize from './countSize.model.js';
import Color from './color.model.js';
import YarnType from './yarnType.model.js';
import Blend from './blend.model.js';

// Embedded CountSize schema
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

// Embedded Color schema
const embeddedColorSchema = mongoose.Schema(
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
    colorCode: {
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

// Embedded YarnType schema
const embeddedYarnTypeSchema = mongoose.Schema(
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

// Embedded YarnSubtype schema (stores detail info from YarnType)
const embeddedYarnSubtypeSchema = mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    subtype: {
      type: String,
      required: true,
      trim: true,
    },
    countSize: {
      type: [mongoose.Schema.Types.Mixed], // Array of embedded countSize objects
      default: [],
    },
    tearWeight: {
      type: String,
      trim: true,
    },
  },
  { _id: true, timestamps: false }
);

// Embedded Blend schema
const embeddedBlendSchema = mongoose.Schema(
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
      type: embeddedYarnTypeSchema,
      required: true,
    },
    yarnSubtype: {
      type: embeddedYarnSubtypeSchema,
      required: false,
    },
    countSize: {
      type: embeddedCountSizeSchema,
      required: true,
    },
    blend: {
      type: embeddedBlendSchema,
      required: true,
    },
    colorFamily: {
      type: embeddedColorSchema,
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
    minQuantity: {
      type: Number,
      min: 0,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended'],
      default: 'active',
    },
  },
  { timestamps: true }
);

// Post-find hook: Convert ObjectIds to embedded objects when reading (for backward compatibility)
yarnCatalogSchema.post(['find', 'findOne', 'findOneAndUpdate'], async function (docs) {
  if (!docs) return;
  
  const documents = Array.isArray(docs) ? docs : [docs];
  
  for (const doc of documents) {
    if (!doc) continue;
    
    // Convert yarnType ObjectId to embedded object
    if (doc.yarnType) {
      const isObjectId = mongoose.Types.ObjectId.isValid(doc.yarnType) || 
                        (typeof doc.yarnType === 'string' && mongoose.Types.ObjectId.isValid(doc.yarnType)) ||
                        (doc.yarnType && typeof doc.yarnType === 'object' && !doc.yarnType.name);
      
      if (isObjectId) {
        try {
          const yarnTypeId = mongoose.Types.ObjectId.isValid(doc.yarnType) 
            ? doc.yarnType 
            : new mongoose.Types.ObjectId(doc.yarnType);
          const yarnType = await YarnType.findById(yarnTypeId);
          
          if (yarnType) {
            doc.yarnType = {
              _id: yarnType._id,
              name: yarnType.name,
              status: yarnType.status,
            };
          } else {
            doc.yarnType = {
              _id: yarnTypeId,
              name: 'Unknown',
              status: 'deleted',
            };
          }
        } catch (error) {
          console.error('Error converting yarnType in post-find hook:', error);
        }
      }
    }
    
    // Convert countSize ObjectId to embedded object
    if (doc.countSize) {
      const isObjectId = mongoose.Types.ObjectId.isValid(doc.countSize) || 
                        (typeof doc.countSize === 'string' && mongoose.Types.ObjectId.isValid(doc.countSize)) ||
                        (doc.countSize && typeof doc.countSize === 'object' && !doc.countSize.name);
      
      if (isObjectId) {
        try {
          const countSizeId = mongoose.Types.ObjectId.isValid(doc.countSize) 
            ? doc.countSize 
            : new mongoose.Types.ObjectId(doc.countSize);
          const countSize = await CountSize.findById(countSizeId);
          
          if (countSize) {
            doc.countSize = {
              _id: countSize._id,
              name: countSize.name,
              status: countSize.status,
            };
          } else {
            doc.countSize = {
              _id: countSizeId,
              name: 'Unknown',
              status: 'deleted',
            };
          }
        } catch (error) {
          console.error('Error converting countSize in post-find hook:', error);
        }
      }
    }
    
    // Convert blend ObjectId to embedded object
    if (doc.blend) {
      const isObjectId = mongoose.Types.ObjectId.isValid(doc.blend) || 
                        (typeof doc.blend === 'string' && mongoose.Types.ObjectId.isValid(doc.blend)) ||
                        (doc.blend && typeof doc.blend === 'object' && !doc.blend.name);
      
      if (isObjectId) {
        try {
          const blendId = mongoose.Types.ObjectId.isValid(doc.blend) 
            ? doc.blend 
            : new mongoose.Types.ObjectId(doc.blend);
          const blend = await Blend.findById(blendId);
          
          if (blend) {
            doc.blend = {
              _id: blend._id,
              name: blend.name,
              status: blend.status,
            };
          } else {
            doc.blend = {
              _id: blendId,
              name: 'Unknown',
              status: 'deleted',
            };
          }
        } catch (error) {
          console.error('Error converting blend in post-find hook:', error);
        }
      }
    }
    
    // Convert colorFamily ObjectId to embedded object
    if (doc.colorFamily) {
      const isObjectId = mongoose.Types.ObjectId.isValid(doc.colorFamily) || 
                        (typeof doc.colorFamily === 'string' && mongoose.Types.ObjectId.isValid(doc.colorFamily)) ||
                        (doc.colorFamily && typeof doc.colorFamily === 'object' && !doc.colorFamily.name);
      
      if (isObjectId) {
        try {
          const colorId = mongoose.Types.ObjectId.isValid(doc.colorFamily) 
            ? doc.colorFamily 
            : new mongoose.Types.ObjectId(doc.colorFamily);
          const color = await Color.findById(colorId);
          
          if (color) {
            doc.colorFamily = {
              _id: color._id,
              name: color.name,
              colorCode: color.colorCode,
              status: color.status,
            };
          } else {
            doc.colorFamily = {
              _id: colorId,
              name: 'Unknown',
              colorCode: '#000000',
              status: 'deleted',
            };
          }
        } catch (error) {
          console.error('Error converting colorFamily in post-find hook:', error);
        }
      }
    }
    
    // Convert yarnSubtype ObjectId to embedded object
    if (doc.yarnSubtype && doc.yarnType) {
      const isObjectId = mongoose.Types.ObjectId.isValid(doc.yarnSubtype) || 
                        (typeof doc.yarnSubtype === 'string' && mongoose.Types.ObjectId.isValid(doc.yarnSubtype)) ||
                        (doc.yarnSubtype && typeof doc.yarnSubtype === 'object' && !doc.yarnSubtype.subtype);
      
      if (isObjectId) {
        try {
          const yarnTypeId = doc.yarnType._id || doc.yarnType;
          const yarnType = await YarnType.findById(yarnTypeId);
          
          if (yarnType && yarnType.details) {
            const subtypeId = mongoose.Types.ObjectId.isValid(doc.yarnSubtype) 
              ? doc.yarnSubtype 
              : new mongoose.Types.ObjectId(doc.yarnSubtype);
            
            const subtypeDetail = yarnType.details.find(d => d._id.toString() === subtypeId.toString());
            
            if (subtypeDetail) {
              doc.yarnSubtype = {
                _id: subtypeDetail._id,
                subtype: subtypeDetail.subtype,
                countSize: subtypeDetail.countSize || [],
                tearWeight: subtypeDetail.tearWeight || '',
              };
            } else {
              doc.yarnSubtype = {
                _id: subtypeId,
                subtype: 'Unknown',
                countSize: [],
                tearWeight: '',
              };
            }
          }
        } catch (error) {
          console.error('Error converting yarnSubtype in post-find hook:', error);
        }
      }
    }
  }
});

// Pre-save hook: Automatically converts IDs to embedded objects
// Frontend can send just IDs, and this hook will fetch and store full object data
yarnCatalogSchema.pre('save', async function (next) {
  // Convert yarnType ID to embedded object
  if (this.yarnType) {
    const isObjectId = mongoose.Types.ObjectId.isValid(this.yarnType) || 
                      (typeof this.yarnType === 'string' && mongoose.Types.ObjectId.isValid(this.yarnType)) ||
                      (this.yarnType && typeof this.yarnType === 'object' && !this.yarnType.name);
    
    if (isObjectId) {
      try {
        const yarnTypeId = mongoose.Types.ObjectId.isValid(this.yarnType) 
          ? this.yarnType 
          : new mongoose.Types.ObjectId(this.yarnType);
        const yarnType = await YarnType.findById(yarnTypeId);
        
        if (yarnType) {
          this.yarnType = {
            _id: yarnType._id,
            name: yarnType.name,
            status: yarnType.status,
          };
        } else {
          this.yarnType = {
            _id: yarnTypeId,
            name: 'Unknown',
            status: 'deleted',
          };
        }
      } catch (error) {
        console.error('Error converting yarnType to embedded object:', error);
        this.yarnType = {
          _id: mongoose.Types.ObjectId.isValid(this.yarnType) ? this.yarnType : new mongoose.Types.ObjectId(this.yarnType),
          name: 'Unknown',
          status: 'deleted',
        };
      }
    }
  }
  
  // Convert countSize ID to embedded object
  if (this.countSize) {
    const isObjectId = mongoose.Types.ObjectId.isValid(this.countSize) || 
                      (typeof this.countSize === 'string' && mongoose.Types.ObjectId.isValid(this.countSize)) ||
                      (this.countSize && typeof this.countSize === 'object' && !this.countSize.name);
    
    if (isObjectId) {
      try {
        const countSizeId = mongoose.Types.ObjectId.isValid(this.countSize) 
          ? this.countSize 
          : new mongoose.Types.ObjectId(this.countSize);
        const countSize = await CountSize.findById(countSizeId);
        
        if (countSize) {
          this.countSize = {
            _id: countSize._id,
            name: countSize.name,
            status: countSize.status,
          };
        } else {
          this.countSize = {
            _id: countSizeId,
            name: 'Unknown',
            status: 'deleted',
          };
        }
      } catch (error) {
        console.error('Error converting countSize to embedded object:', error);
        this.countSize = {
          _id: mongoose.Types.ObjectId.isValid(this.countSize) ? this.countSize : new mongoose.Types.ObjectId(this.countSize),
          name: 'Unknown',
          status: 'deleted',
        };
      }
    }
  }
  
  // Convert blend ID to embedded object
  if (this.blend) {
    const isObjectId = mongoose.Types.ObjectId.isValid(this.blend) || 
                      (typeof this.blend === 'string' && mongoose.Types.ObjectId.isValid(this.blend)) ||
                      (this.blend && typeof this.blend === 'object' && !this.blend.name);
    
    if (isObjectId) {
      try {
        const blendId = mongoose.Types.ObjectId.isValid(this.blend) 
          ? this.blend 
          : new mongoose.Types.ObjectId(this.blend);
        const blend = await Blend.findById(blendId);
        
        if (blend) {
          this.blend = {
            _id: blend._id,
            name: blend.name,
            status: blend.status,
          };
        } else {
          this.blend = {
            _id: blendId,
            name: 'Unknown',
            status: 'deleted',
          };
        }
      } catch (error) {
        console.error('Error converting blend to embedded object:', error);
        this.blend = {
          _id: mongoose.Types.ObjectId.isValid(this.blend) ? this.blend : new mongoose.Types.ObjectId(this.blend),
          name: 'Unknown',
          status: 'deleted',
        };
      }
    }
  }
  
  // Convert colorFamily ID to embedded object
  if (this.colorFamily) {
    const isObjectId = mongoose.Types.ObjectId.isValid(this.colorFamily) || 
                      (typeof this.colorFamily === 'string' && mongoose.Types.ObjectId.isValid(this.colorFamily)) ||
                      (this.colorFamily && typeof this.colorFamily === 'object' && !this.colorFamily.name);
    
    if (isObjectId) {
      try {
        const colorId = mongoose.Types.ObjectId.isValid(this.colorFamily) 
          ? this.colorFamily 
          : new mongoose.Types.ObjectId(this.colorFamily);
        const color = await Color.findById(colorId);
        
        if (color) {
          this.colorFamily = {
            _id: color._id,
            name: color.name,
            colorCode: color.colorCode,
            status: color.status,
          };
        } else {
          this.colorFamily = {
            _id: colorId,
            name: 'Unknown',
            colorCode: '#000000',
            status: 'deleted',
          };
        }
      } catch (error) {
        console.error('Error converting colorFamily to embedded object:', error);
        this.colorFamily = {
          _id: mongoose.Types.ObjectId.isValid(this.colorFamily) ? this.colorFamily : new mongoose.Types.ObjectId(this.colorFamily),
          name: 'Unknown',
          colorCode: '#000000',
          status: 'deleted',
        };
      }
    }
  }
  
  // Convert yarnSubtype ID to embedded object (from YarnType details)
  if (this.yarnSubtype && this.yarnType) {
    const isObjectId = mongoose.Types.ObjectId.isValid(this.yarnSubtype) || 
                      (typeof this.yarnSubtype === 'string' && mongoose.Types.ObjectId.isValid(this.yarnSubtype)) ||
                      (this.yarnSubtype && typeof this.yarnSubtype === 'object' && !this.yarnSubtype.subtype);
    
    if (isObjectId) {
      try {
        const yarnTypeId = this.yarnType._id || this.yarnType;
        const yarnType = await YarnType.findById(yarnTypeId);
        
        if (yarnType && yarnType.details) {
          const subtypeId = mongoose.Types.ObjectId.isValid(this.yarnSubtype) 
            ? this.yarnSubtype 
            : new mongoose.Types.ObjectId(this.yarnSubtype);
          
          const subtypeDetail = yarnType.details.find(d => d._id.toString() === subtypeId.toString());
          
          if (subtypeDetail) {
            this.yarnSubtype = {
              _id: subtypeDetail._id,
              subtype: subtypeDetail.subtype,
              countSize: subtypeDetail.countSize || [],
              tearWeight: subtypeDetail.tearWeight || '',
            };
          } else {
            this.yarnSubtype = {
              _id: subtypeId,
              subtype: 'Unknown',
              countSize: [],
              tearWeight: '',
            };
          }
        }
      } catch (error) {
        console.error('Error converting yarnSubtype to embedded object:', error);
        this.yarnSubtype = {
          _id: mongoose.Types.ObjectId.isValid(this.yarnSubtype) ? this.yarnSubtype : new mongoose.Types.ObjectId(this.yarnSubtype),
          subtype: 'Unknown',
          countSize: [],
          tearWeight: '',
        };
      }
    }
  }
  
  // Generate yarnName if needed
  if (!this.yarnName || this.isModified('countSize') || this.isModified('colorFamily') || 
      this.isModified('yarnType') || this.isModified('yarnSubtype')) {
    
    try {
      const parts = [];
      
      // Get countSize name (now embedded object)
      if (this.countSize && this.countSize.name) {
        parts.push(this.countSize.name);
      }
      
      // Get colorFamily name (optional, now embedded object)
      if (this.colorFamily && this.colorFamily.name) {
        parts.push(this.colorFamily.name);
      }
      
      // Get yarnType name (now embedded object)
      if (this.yarnType && this.yarnType.name) {
        let typePart = this.yarnType.name;
        
        // Handle yarnSubtype (now embedded object)
        if (this.yarnSubtype && this.yarnSubtype.subtype) {
          typePart += `/${this.yarnSubtype.subtype}`;
        }
        
        parts.push(typePart);
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

// Add plugins for converting MongoDB document to JSON and pagination support
yarnCatalogSchema.plugin(toJSON);
yarnCatalogSchema.plugin(paginate);

// Wrap the plugin's transform to add our custom formatting
const originalToJSON = yarnCatalogSchema.options.toJSON;
if (originalToJSON && originalToJSON.transform) {
  const pluginTransform = originalToJSON.transform;
  yarnCatalogSchema.set('toJSON', {
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
      
      // Format embedded objects: convert _id to id
      if (finalRet.yarnType && typeof finalRet.yarnType === 'object') {
        finalRet.yarnType = {
          id: finalRet.yarnType._id ? finalRet.yarnType._id.toString() : (finalRet.yarnType.id || null),
          name: finalRet.yarnType.name,
          status: finalRet.yarnType.status || 'active'
        };
      }
      
      if (finalRet.countSize && typeof finalRet.countSize === 'object') {
        finalRet.countSize = {
          id: finalRet.countSize._id ? finalRet.countSize._id.toString() : (finalRet.countSize.id || null),
          name: finalRet.countSize.name,
          status: finalRet.countSize.status || 'active'
        };
      }
      
      if (finalRet.blend && typeof finalRet.blend === 'object') {
        finalRet.blend = {
          id: finalRet.blend._id ? finalRet.blend._id.toString() : (finalRet.blend.id || null),
          name: finalRet.blend.name,
          status: finalRet.blend.status || 'active'
        };
      }
      
      if (finalRet.colorFamily && typeof finalRet.colorFamily === 'object') {
        finalRet.colorFamily = {
          id: finalRet.colorFamily._id ? finalRet.colorFamily._id.toString() : (finalRet.colorFamily.id || null),
          name: finalRet.colorFamily.name,
          colorCode: finalRet.colorFamily.colorCode,
          status: finalRet.colorFamily.status || 'active'
        };
      }
      
      if (finalRet.yarnSubtype && typeof finalRet.yarnSubtype === 'object') {
        finalRet.yarnSubtype = {
          id: finalRet.yarnSubtype._id ? finalRet.yarnSubtype._id.toString() : (finalRet.yarnSubtype.id || null),
          subtype: finalRet.yarnSubtype.subtype,
          countSize: finalRet.yarnSubtype.countSize || [],
          tearWeight: finalRet.yarnSubtype.tearWeight || ''
        };
      }
      
      return finalRet;
    }
  });
}

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

