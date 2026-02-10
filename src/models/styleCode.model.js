import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const styleCodeSchema = mongoose.Schema(
  {
    styleCode: {
      type: String,
      required: true,
      trim: true,
      unique: true,
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

styleCodeSchema.plugin(toJSON);
styleCodeSchema.plugin(paginate);

const StyleCode = mongoose.model('StyleCode', styleCodeSchema);

export default StyleCode;
