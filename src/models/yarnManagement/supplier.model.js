import mongoose from 'mongoose';
import validator from 'validator';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';
import YarnType from './yarnType.model.js';
import Color from './color.model.js';

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
    yarnType: {
      type: embeddedYarnTypeSchema,
      required: true,
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
supplierSchema.pre('save', async function (next) {
  if (this.isModified('yarnDetails')) {
    for (const detail of this.yarnDetails || []) {
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
      if (detail.color) {
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
              detail.color = {
                _id: color._id,
                name: color.name,
                colorCode: color.colorCode,
                status: color.status,
              };
            } else {
              detail.color = {
                _id: colorId,
                name: 'Unknown',
                colorCode: '#000000',
                status: 'deleted',
              };
            }
          } catch (error) {
            console.error('Error converting color to embedded object:', error);
            detail.color = {
              _id: mongoose.Types.ObjectId.isValid(detail.color) ? detail.color : new mongoose.Types.ObjectId(detail.color),
              name: 'Unknown',
              colorCode: '#000000',
              status: 'deleted',
            };
          }
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

