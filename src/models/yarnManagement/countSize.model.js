import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

const countSizeSchema = mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      auto: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  { timestamps: true }
);

// Add plugins for converting MongoDB document to JSON and pagination support
countSizeSchema.plugin(toJSON);
countSizeSchema.plugin(paginate);

/**
 * Check if count size name is taken
 * @param {string} name - The count size name
 * @param {ObjectId} [excludeCountSizeId] - The id of the count size to be excluded
 * @returns {Promise<boolean>}
 */
countSizeSchema.statics.isNameTaken = async function (name, excludeCountSizeId) {
  const countSize = await this.findOne({ name, _id: { $ne: excludeCountSizeId } });
  return !!countSize;
};

/**
 * @typedef CountSize
 */
const CountSize = mongoose.model('CountSize', countSizeSchema);

export default CountSize;

