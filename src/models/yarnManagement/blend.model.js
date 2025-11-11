import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

const blendSchema = mongoose.Schema(
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
blendSchema.plugin(toJSON);
blendSchema.plugin(paginate);

/**
 * Check if blend name is taken
 * @param {string} name - The blend name
 * @param {ObjectId} [excludeBlendId] - The id of the blend to be excluded
 * @returns {Promise<boolean>}
 */
blendSchema.statics.isNameTaken = async function (name, excludeBlendId) {
  const blend = await this.findOne({ name, _id: { $ne: excludeBlendId } });
  return !!blend;
};

/**
 * @typedef Blend
 */
const Blend = mongoose.model('Blend', blendSchema);

export default Blend;

