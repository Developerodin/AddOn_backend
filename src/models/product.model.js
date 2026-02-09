import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';
import YarnCatalog from './yarnManagement/yarnCatalog.model.js';

const bomItemSchema = mongoose.Schema({
  yarnCatalogId: {
    type: mongoose.SchemaTypes.ObjectId,
    ref: 'YarnCatalog',
    required: false,
  },
  yarnName: {
    type: String,
    trim: true,
    required: false,
  },
  quantity: {
    type: Number,
    required: false,
    min: 0,
  },
});

const processItemSchema = mongoose.Schema({
  processId: {
    type: mongoose.SchemaTypes.ObjectId,
    ref: 'Process',
  },
});

const styleCodeItemSchema = mongoose.Schema({
  styleCode: {
    type: String,
    required: true,
    trim: true,
  },
  eanCode: {
    type: String,
    required: true,
    trim: true,
  },
  mrp: {
    type: Number,
    required: true,
    min: 0,
  },
  brand: {
    type: String,
    trim: true,
  },
  pack: {
    type: String,
    trim: true,
  },
});

const productSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    softwareCode: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    internalCode: {
      type: String,
      required: true,
      trim: true,
    },
    vendorCode: {
      type: String,
      required: true,
      trim: true,
    },
    factoryCode: {
      type: String,
      required: true,
      trim: true,
    },
    knittingCode: {
      type: String,
      required: false,
      trim: true,
      default: '',
    },
    styleCodes: [styleCodeItemSchema],
    description: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Category',
      required: true,
    },
    image: {
      type: String,
      trim: true,
    },
    attributes: {
      type: Map,
      of: String,
      default: {},
    },
    bom: [bomItemSchema],
    processes: [processItemSchema],
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save hook: Auto-populate yarnName from yarnCatalogId if not provided
productSchema.pre('save', async function (next) {
  if (this.bom && Array.isArray(this.bom)) {
    for (const bomItem of this.bom) {
      if (bomItem.yarnCatalogId && !bomItem.yarnName) {
        try {
          const yarnCatalog = await YarnCatalog.findById(bomItem.yarnCatalogId);
          if (yarnCatalog && yarnCatalog.yarnName) {
            bomItem.yarnName = yarnCatalog.yarnName;
          }
        } catch (error) {
          console.error('Error populating yarnName from yarnCatalogId:', error);
        }
      }
    }
  }
  next();
});

// add plugins
productSchema.plugin(toJSON);
productSchema.plugin(paginate);

const Product = mongoose.model('Product', productSchema);

export default Product; 