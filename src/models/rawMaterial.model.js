import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const rawMaterialSchema = mongoose.Schema(
  {
    itemName: {
      type: String,
      required: true,
      trim: true,
    },
    printName: {
      type: String,
      required: true,
      trim: true,
    },
    color: {
      type: String,
      required: true,
      trim: true,
    },
    unit: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      trim: true,
    }
  },
  {
    timestamps: true,
  }
);

// add plugins
rawMaterialSchema.plugin(toJSON);
rawMaterialSchema.plugin(paginate);

const RawMaterial = mongoose.model('RawMaterial', rawMaterialSchema);

export default RawMaterial; 