import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

const colorSchema = mongoose.Schema(
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
    colorCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      validate(value) {
        if (!/^#[0-9A-F]{6}$/i.test(value)) {
          throw new Error('Invalid color code format. Must be a valid hex color (e.g., #FF5733)');
        }
      },
    },
    pantoneName: {
      type: String,
      trim: true,
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
colorSchema.plugin(toJSON);
colorSchema.plugin(paginate);

/**
 * Check if color name is taken
 * @param {string} name - The color name
 * @param {ObjectId} [excludeColorId] - The id of the color to be excluded
 * @returns {Promise<boolean>}
 */
colorSchema.statics.isNameTaken = async function (name, excludeColorId) {
  const color = await this.findOne({ name, _id: { $ne: excludeColorId } });
  return !!color;
};

/**
 * Check if color code is taken
 * @param {string} colorCode - The color code
 * @param {ObjectId} [excludeColorId] - The id of the color to be excluded
 * @returns {Promise<boolean>}
 */
colorSchema.statics.isColorCodeTaken = async function (colorCode, excludeColorId) {
  const color = await this.findOne({ colorCode, _id: { $ne: excludeColorId } });
  return !!color;
};

/**
 * @typedef Color
 */
const Color = mongoose.model('Color', colorSchema);

export default Color;

