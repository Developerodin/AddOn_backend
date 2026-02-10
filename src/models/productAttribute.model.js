import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const optionValueSchema = mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  image: {
    type: String,
    trim: true,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
});

const productAttributeSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    attributeType: {
      type: String,
      enum: ['Manufacturing', 'Warehouse'],
      default: 'Manufacturing',
    },
    type: {
      type: String,
      required: true,
      enum: ['select', 'radio', 'checkbox', 'text', 'textarea'],
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    optionValues: [optionValueSchema],
  },
  {
    timestamps: true,
  }
);

// add plugins
productAttributeSchema.plugin(toJSON);
productAttributeSchema.plugin(paginate);

const ProductAttribute = mongoose.model('ProductAttribute', productAttributeSchema);

export default ProductAttribute; 