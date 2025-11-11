import mongoose from 'mongoose';
import toJSON from '../plugins/toJSON.plugin.js';
import paginate from '../plugins/paginate.plugin.js';

const yarnTypeDetailSchema = mongoose.Schema(
  {
    subtype: {
      type: String,
      required: true,
      trim: true,
    },
    countSize: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'CountSize',
      default: [],
    },
    tearWeight: {
      type: String,
      trim: true,
    }
  },
  { _id: true }
);

const yarnTypeSchema = mongoose.Schema(
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
    details: {
      type: [yarnTypeDetailSchema],
      default: [],
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
yarnTypeSchema.plugin(toJSON);
yarnTypeSchema.plugin(paginate);

/**
 * Check if yarn type name is taken
 * @param {string} name - The yarn type name
 * @param {ObjectId} [excludeYarnTypeId] - The id of the yarn type to be excluded
 * @returns {Promise<boolean>}
 */
yarnTypeSchema.statics.isNameTaken = async function (name, excludeYarnTypeId) {
  const yarnType = await this.findOne({ name, _id: { $ne: excludeYarnTypeId } });
  return !!yarnType;
};

/**
 * @typedef YarnType
 */
const YarnType = mongoose.model('YarnType', yarnTypeSchema);

export default YarnType;

