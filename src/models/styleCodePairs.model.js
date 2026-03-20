import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const styleCodePairsSchema = mongoose.Schema(
  {
    pairStyleCode: {
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
    pack: {
      type: Number,
      required: true,
      integer: true,
      min: 1,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    styleCodes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'StyleCode' }],
    bom: [
      {
        rawMaterial: { type: mongoose.Schema.Types.ObjectId, ref: 'RawMaterial', required: false },
        quantity: { type: Number, required: false, min: 0 },
      },
    ],
  },
  {
    timestamps: true,
  }
);

styleCodePairsSchema.plugin(toJSON);
styleCodePairsSchema.plugin(paginate);

const StyleCodePairs = mongoose.model('StyleCodePairs', styleCodePairsSchema);

export default StyleCodePairs;
