import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const rawMaterialSchema = mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    groupName: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    brand: { type: String, required: true, trim: true },
    countSize: { type: String, required: true, trim: true },
    material: { type: String, required: true, trim: true },
    color: { type: String, required: true, trim: true },
    shade: { type: String, required: true, trim: true },
    unit: { type: String, required: true, trim: true },
    mrp: { type: String, required: true, trim: true },
    hsnCode: { type: String, required: true, trim: true },
    gst: { type: String, required: true, trim: true },
    articleNo: { type: String, required: true, trim: true },
    image: { type: String, trim: true, default: null },
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