import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';

/**
 * A batch groups linking/sampling floor issues for audit and per-batch yarn weight caps.
 * Each batch is scoped to one floor (linking or sampling tab).
 */
const yarnFloorIssueBatchSchema = mongoose.Schema(
  {
    issueBatchId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 64,
    },
    floor: {
      type: String,
      required: true,
      enum: ['linking', 'sampling'],
    },
    issuedByEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
  },
  {
    timestamps: true,
  }
);

yarnFloorIssueBatchSchema.index({ floor: 1, createdAt: -1 });

yarnFloorIssueBatchSchema.plugin(toJSON);

const YarnFloorIssueBatch = mongoose.model('YarnFloorIssueBatch', yarnFloorIssueBatchSchema);

export default YarnFloorIssueBatch;
