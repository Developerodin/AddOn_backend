import mongoose from 'mongoose';
import validator from 'validator';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import YarnType from './yarnType.model.js';
import Color from './color.model.js';
import YarnCatalog from './yarnCatalog.model.js';

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
    pantoneName: {
      type: String,
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
  },
  { _id: true, timestamps: false }
);

const yarnDetailsSchema = mongoose.Schema(
  {
    /** Reference to YarnCatalog; when set, links this detail to a catalog entry */
    yarnCatalogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YarnCatalog',
      required: false,
    },
    yarnName: {
      type: String,
      required: false,
      trim: true,
    },
    yarnType: {
      type: embeddedYarnTypeSchema,
      required: false, // Validated in pre-save hook and service layer
    },
    yarnsubtype: {
      type: embeddedYarnSubtypeSchema,
      required: false,
    },
    color: {
      type: embeddedColorSchema,
      required: true,
    },
    shadeNumber: {
      type: String,
      required: false,
      trim: true,
    },
    tearweight: {
      type: Number,
      required: true,
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
    city: {
      type: String,
      required: true,
      trim: true,
    },
    state: {
      type: String,
      required: true,
      trim: true,
    },
    pincode: {
      type: String,
      required: true,
      trim: true,
      validate(value) {
        if (!/^[0-9]{6}$/.test(value)) {
          throw new Error('Invalid pincode format. Must be 6 digits');
        }
      },
    },
    country: {
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

// Pre-save hook: Automatically converts IDs to embedded objects
// Frontend can send just IDs, and this hook will fetch and store full object data
// Also handles yarnName lookup from catalog to populate yarnType and yarnSubtype
// IMPORTANT: Preserves original yarnName and color name as provided - no modifications
supplierSchema.pre('save', async function (next) {
  if (this.isModified('yarnDetails')) {
    for (const detail of this.yarnDetails || []) {
      // Preserve original yarnName if provided (don't overwrite it)
      const originalYarnName = detail.yarnName ? String(detail.yarnName).trim() : null;
      
      // Validate that either yarnName, yarnType, or yarnCatalogId is provided
      if (!detail.yarnName && !detail.yarnType && !detail.yarnCatalogId) {
        return next(new Error('Either yarnName, yarnType, or yarnCatalogId must be provided in yarnDetails'));
      }

      // If yarnCatalogId is provided, fetch catalog and populate yarnName / yarnType / yarnsubtype from it
      if (detail.yarnCatalogId) {
        try {
          const catalogId = mongoose.Types.ObjectId.isValid(detail.yarnCatalogId)
            ? detail.yarnCatalogId
            : new mongoose.Types.ObjectId(detail.yarnCatalogId);
          const catalog = await YarnCatalog.findById(catalogId);
          if (catalog) {
            if (!detail.yarnName) detail.yarnName = catalog.yarnName;
            if (!detail.yarnType && catalog.yarnType) {
              detail.yarnType = {
                _id: catalog.yarnType._id,
                name: catalog.yarnType.name,
                status: catalog.yarnType.status,
              };
            }
            if (!detail.yarnsubtype && catalog.yarnSubtype) {
              detail.yarnsubtype = {
                _id: catalog.yarnSubtype._id,
                subtype: catalog.yarnSubtype.subtype,
                countSize: catalog.yarnSubtype.countSize || [],
              };
            }
          }
        } catch (error) {
          console.error('Error fetching yarn catalog by yarnCatalogId:', error);
          return next(error);
        }
      }
      
      // If yarnName is provided, optionally fetch from catalog and set yarnCatalogId (no error if not found)
      if (detail.yarnName && (!detail.yarnType || !detail.yarnsubtype || !detail.yarnCatalogId)) {
        try {
          const catalog = await YarnCatalog.findOne({
            yarnName: detail.yarnName.trim(),
            status: { $ne: 'deleted' },
          });
          if (catalog) {
            detail.yarnCatalogId = catalog._id;
            if (!detail.yarnType && catalog.yarnType) {
              detail.yarnType = {
                _id: catalog.yarnType._id,
                name: catalog.yarnType.name,
                status: catalog.yarnType.status,
              };
            }
            if (!detail.yarnsubtype && catalog.yarnSubtype) {
              detail.yarnsubtype = {
                _id: catalog.yarnSubtype._id,
                subtype: catalog.yarnSubtype.subtype,
                countSize: catalog.yarnSubtype.countSize || [],
              };
            }
          }
          // If no catalog found: allow save without yarnCatalogId (yarnName stored as-is)
        } catch (error) {
          console.error('Error fetching yarn catalog by yarnName:', error);
          // Don't fail save; continue without catalog link
        }
      }
      
      // Restore original yarnName to preserve it exactly as provided (no modifications)
      if (originalYarnName) {
        detail.yarnName = originalYarnName;
      }
      
      // Convert yarnType ID to embedded object
      if (detail.yarnType) {
        const isObjectId = mongoose.Types.ObjectId.isValid(detail.yarnType) || 
                          (typeof detail.yarnType === 'string' && mongoose.Types.ObjectId.isValid(detail.yarnType)) ||
                          (detail.yarnType && typeof detail.yarnType === 'object' && !detail.yarnType.name);
        
        if (isObjectId) {
          try {
            const yarnTypeId = mongoose.Types.ObjectId.isValid(detail.yarnType) 
              ? detail.yarnType 
              : new mongoose.Types.ObjectId(detail.yarnType);
            const yarnType = await YarnType.findById(yarnTypeId);
            
            if (yarnType) {
              detail.yarnType = {
                _id: yarnType._id,
                name: yarnType.name,
                status: yarnType.status,
              };
            } else {
              detail.yarnType = {
                _id: yarnTypeId,
                name: 'Unknown',
                status: 'deleted',
              };
            }
          } catch (error) {
            console.error('Error converting yarnType to embedded object:', error);
            detail.yarnType = {
              _id: mongoose.Types.ObjectId.isValid(detail.yarnType) ? detail.yarnType : new mongoose.Types.ObjectId(detail.yarnType),
              name: 'Unknown',
              status: 'deleted',
            };
          }
        }
      }
      
      // Convert color ID to embedded object
      // IMPORTANT: Preserve original color name if provided as object (don't overwrite with DB value)
      if (detail.color) {
        const originalColorName = (detail.color && typeof detail.color === 'object' && detail.color.name) 
          ? String(detail.color.name).trim() 
          : null;
        
        const isObjectId = mongoose.Types.ObjectId.isValid(detail.color) || 
                          (typeof detail.color === 'string' && mongoose.Types.ObjectId.isValid(detail.color)) ||
                          (detail.color && typeof detail.color === 'object' && !detail.color.name);
        
        if (isObjectId) {
          try {
            const colorId = mongoose.Types.ObjectId.isValid(detail.color) 
              ? detail.color 
              : new mongoose.Types.ObjectId(detail.color);
            const color = await Color.findById(colorId);
            
            if (color) {
              // Use original color name if provided, otherwise use DB value
              const colorNameToUse = originalColorName || color.name;
              detail.color = {
                _id: color._id,
                name: colorNameToUse, // Preserve original name if provided
                colorCode: color.colorCode,
                pantoneName: color.pantoneName,
                status: color.status,
              };
            } else {
              detail.color = {
                _id: colorId,
                name: originalColorName || 'Unknown',
                colorCode: '#000000',
                pantoneName: undefined,
                status: 'deleted',
              };
            }
          } catch (error) {
            console.error('Error converting color to embedded object:', error);
            detail.color = {
              _id: mongoose.Types.ObjectId.isValid(detail.color) ? detail.color : new mongoose.Types.ObjectId(detail.color),
              name: originalColorName || 'Unknown',
              colorCode: '#000000',
              pantoneName: undefined,
              status: 'deleted',
            };
          }
        } else if (originalColorName && detail.color && typeof detail.color === 'object') {
          // If color is already an object with a name, preserve it exactly
          detail.color.name = originalColorName;
        }
      }
      
      // Convert yarnsubtype ID to embedded object (from YarnType details)
      if (detail.yarnsubtype && detail.yarnType) {
        const isObjectId = mongoose.Types.ObjectId.isValid(detail.yarnsubtype) || 
                          (typeof detail.yarnsubtype === 'string' && mongoose.Types.ObjectId.isValid(detail.yarnsubtype)) ||
                          (detail.yarnsubtype && typeof detail.yarnsubtype === 'object' && !detail.yarnsubtype.subtype);
        
        if (isObjectId) {
          try {
            const yarnTypeId = detail.yarnType._id || detail.yarnType;
            const yarnType = await YarnType.findById(yarnTypeId);
            
            if (yarnType && yarnType.details) {
              const subtypeId = mongoose.Types.ObjectId.isValid(detail.yarnsubtype) 
                ? detail.yarnsubtype 
                : new mongoose.Types.ObjectId(detail.yarnsubtype);
              
              const subtypeDetail = yarnType.details.find(d => d._id.toString() === subtypeId.toString());
              
              if (subtypeDetail) {
                detail.yarnsubtype = {
                  _id: subtypeDetail._id,
                  subtype: subtypeDetail.subtype,
                  countSize: subtypeDetail.countSize || [],
                };
              } else {
                detail.yarnsubtype = {
                  _id: subtypeId,
                  subtype: 'Unknown',
                  countSize: [],
                };
              }
            }
          } catch (error) {
            console.error('Error converting yarnsubtype to embedded object:', error);
            detail.yarnsubtype = {
              _id: mongoose.Types.ObjectId.isValid(detail.yarnsubtype) ? detail.yarnsubtype : new mongoose.Types.ObjectId(detail.yarnsubtype),
              subtype: 'Unknown',
              countSize: [],
            };
          }
        }
      }
    }

    // Validate uniqueness: yarnName + color + tearweight + shadeNumber
    // Allow same yarnName, color, and tearweight only if shadeNumber is different
    if (this.yarnDetails && this.yarnDetails.length > 0) {
      const seen = new Map();
      for (let i = 0; i < this.yarnDetails.length; i++) {
        const detail = this.yarnDetails[i];
        
        // Get yarnName (use yarnType.name as fallback if yarnName is not provided)
        const yarnName = detail.yarnName || (detail.yarnType?.name || '');
        
        // Get color ID
        const colorId = detail.color?._id?.toString() || 
                       (typeof detail.color === 'string' ? detail.color : 
                       (detail.color && typeof detail.color === 'object' && detail.color._id ? detail.color._id.toString() : ''));
        
        // Get tearweight
        const tearweight = detail.tearweight;
        
        // Get shadeNumber (can be empty/null)
        const shadeNumber = detail.shadeNumber || '';
        
        // Create unique key: yarnName + colorId + tearweight + shadeNumber
        const uniqueKey = `${yarnName}|${colorId}|${tearweight}|${shadeNumber}`;
        
        if (seen.has(uniqueKey)) {
          return next(new Error(
            `Duplicate yarn detail found. A yarn with the same name (${yarnName}), color, tear weight (${tearweight}), and shade number (${shadeNumber || 'empty'}) already exists. Only shade number can differ for entries with the same name, color, and tear weight.`
          ));
        }
        
        seen.set(uniqueKey, i);
      }
    }
  }
  next();
});

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

