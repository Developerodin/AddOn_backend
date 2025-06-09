import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const bomItemSchema = mongoose.Schema({
  materialId: {
    type: mongoose.SchemaTypes.ObjectId,
    ref: 'RawMaterial',
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 0,
  },
});

const processItemSchema = mongoose.Schema({
  processId: {
    type: mongoose.SchemaTypes.ObjectId,
    ref: 'Process',
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

// add plugins
productSchema.plugin(toJSON);
productSchema.plugin(paginate);

const Product = mongoose.model('Product', productSchema);

export default Product; 